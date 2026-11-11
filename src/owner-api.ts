import type { Env } from "./env";
import {
  decryptText,
  encryptText,
  isEncryptedText,
} from "./crypto";
import { loadWebSession } from "./web-agent-auth";
import { decryptPayload } from "./web-agent-auth";
import { listUserBans, unbanUser, getUserBan } from "./tos-moderation";
import { getAgentState } from "./agent-memory";
import {
  listSessions as listWebSessions,
  loadSession,
  getJob,
  putJob,
  deleteSession as deleteWebSession,
} from "./web-agent-store";

export const OWNER_USER_ID = "1536981526451982431";

const D1_TABLES = new Set([
  "agent_state",
  "user_bans",
  "webagent_index",
  "webagent_sessions",
  "webagent_jobs",
  "infra_log",
  "guild_config",
  "model_channels",
  "custom_commands",
  "blob_files",
  "updates_channel",
  "agent_relay_tokens",
]);

async function isOwner(
  env: Env,
  request: Request,
): Promise<{ ok: boolean; via: string }> {
  const token = request.headers.get("x-update-token") ?? "";
  if (env.BOT_UPDATE_TOKEN && token === env.BOT_UPDATE_TOKEN) {
    return { ok: true, via: "token" };
  }
  const session = await loadWebSession(env, request).catch(() => null);
  if (session && session.sub === OWNER_USER_ID) {
    return { ok: true, via: "discord" };
  }
  return { ok: false, via: "" };
}

export async function isOwnerRequest(
  env: Env,
  request: Request,
): Promise<boolean> {
  return (await isOwner(env, request)).ok;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// Show any stored value: decrypt AES blobs when possible, pass legacy
// plaintext through untouched.
async function revealValue(env: Env, raw: string): Promise<{
  encrypted: boolean;
  text: string;
}> {
  if (isEncryptedText(raw)) {
    try {
      return { encrypted: true, text: await decryptText(env, raw) };
    } catch {
      return { encrypted: true, text: "(decryption failed)" };
    }
  }
  return { encrypted: false, text: raw };
}

async function revealKvValue(
  env: Env,
  key: string,
): Promise<{ encrypted: boolean; text: string } | null> {
  const raw = await env.CONVERSATIONS.get(key);
  if (raw == null) return null;
  return revealValue(env, raw);
}

function gatewayStub(env: Env): { fetch(url: string): Promise<Response> } {
  const namespace = env.GATEWAY as unknown as {
    get(id: unknown): { fetch(url: string): Promise<Response> };
    idFromName(name: string): unknown;
  };
  return namespace.get(namespace.idFromName("main"));
}

async function countQuery(
  env: Env,
  table: string,
): Promise<number> {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return -1;
  }
}

export async function handleOwnerApi(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const auth = await isOwner(env, request);
  if (!auth.ok) return fail("Owner access required", 403);
  const pathname = url.pathname.replace(/^\/api\/owner/, "");
  const method = request.method;

  // ---- overview ----
  if (pathname === "/overview" && method === "GET") {
    const prefixes = [
      "conv:", "ghconv:", "webagent:", "webagent-idx:", "webagent-job:",
      "tos:", "provider-cooldown:", "websess:", "github-auth:", "blob:",
      "gw:", "guildcfg:", "session:",
    ];
    const kvCounts: Record<string, number> = {};
    for (const prefix of prefixes) {
      let count = 0;
      let cursor: string | undefined;
      do {
        const page = await env.CONVERSATIONS.list({ prefix, cursor, limit: 200 });
        count += page.keys.length;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      kvCounts[prefix] = count;
    }
    const tables: Record<string, number> = {};
    for (const table of D1_TABLES) {
      tables[table] = await countQuery(env, table);
    }
    let gateway: Record<string, unknown> = {};
    try {
      const response = await gatewayStub(env).fetch("https://gateway.internal/status");
      gateway = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      gateway = { lastError: error instanceof Error ? error.message : String(error) };
    }
    const cooldowns: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.CONVERSATIONS.list({ prefix: "provider-cooldown:", cursor, limit: 50 });
      for (const key of page.keys) {
        const value = await env.CONVERSATIONS.get(key.name);
        cooldowns.push(`${key.name.replace("provider-cooldown:", "")}: ${value ?? ""}`);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const recentLogs = await env.DB.prepare(
      `SELECT at, guild_id, kind, message FROM infra_log ORDER BY at DESC LIMIT 20`,
    ).all().then((r) => r.results).catch(() => []);
    return json({ kvCounts, tables, gateway, cooldowns, recentLogs });
  }

  // ---- conversations (KV histories) ----
  if (pathname === "/kv/list" && method === "GET") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const cursorIn = url.searchParams.get("cursor") ?? undefined;
    const page = await env.CONVERSATIONS.list({
      prefix,
      cursor: cursorIn || undefined,
      limit: 100,
    });
    const keys = page.keys.map((key) => ({
      name: key.name,
      size: (key.metadata as { size?: number } | null)?.size ?? null,
      expires: key.expiration ?? null,
    }));
    return json({ keys, cursor: page.list_complete ? null : page.cursor });
  }

  if (pathname === "/kv/value" && method === "GET") {
    const key = url.searchParams.get("key") ?? "";
    if (!key.startsWith("conv:") && !key.startsWith("ghconv:") && !key.startsWith("webagent") &&
        !key.startsWith("tos:") && !key.startsWith("github-auth:") && !key.startsWith("provider-cooldown:") &&
        !key.startsWith("websess:")) {
      return fail("Unsupported key");
    }
    const revealed = await revealKvValue(env, key);
    if (!revealed) return fail("Key not found", 404);
    let parsed: unknown = null;
    try { parsed = JSON.parse(revealed.text); } catch { parsed = null; }
    return json({ key, encrypted: revealed.encrypted, parsed, text: parsed ? undefined : revealed.text });
  }

  if (pathname === "/kv/value" && method === "DELETE") {
    const key = url.searchParams.get("key") ?? "";
    await env.CONVERSATIONS.delete(key);
    return json({ deleted: key });
  }

  if (pathname === "/kv/value" && method === "POST") {
    let body: { key?: unknown; value?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const key = typeof body.key === "string" ? body.key : "";
    const value = typeof body.value === "string" ? body.value : "";
    if (!key) return fail("key required");
    await env.CONVERSATIONS.put(key, value);
    return json({ saved: key });
  }

  // ---- decrypt helper for any encrypted-looking value ----
  if (pathname === "/decrypt" && method === "POST") {
    let body: { value?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const value = typeof body.value === "string" ? body.value : "";
    if (!isEncryptedText(value)) return json({ encrypted: false, text: value });
    try {
      return json({ encrypted: true, text: await decryptText(env, value) });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "decrypt failed", 400);
    }
  }

  // ---- agent memory (D1, encrypted) ----
  if (pathname === "/memory" && method === "GET") {
    const userId = url.searchParams.get("userId") ?? "";
    if (!userId) return fail("userId required");
    const state = await getAgentState(env, userId);
    return json({ userId, enabled: state.enabled, memory: state.memory, chars: state.memory.length });
  }

  if (pathname === "/memory" && method === "POST") {
    let body: { userId?: unknown; memory?: unknown; enabled?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const userId = typeof body.userId === "string" ? body.userId : "";
    const memory = typeof body.memory === "string" ? body.memory : "";
    const enabled = Boolean(body.enabled);
    if (!userId) return fail("userId required");
    await env.DB.prepare(
      `INSERT INTO agent_state (user_id, enabled, memory, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled, memory = excluded.memory, updated_at = excluded.updated_at`,
    )
      .bind(userId, enabled ? 1 : 0, await encryptText(env, memory), Date.now())
      .run();
    return json({ saved: userId, chars: memory.length });
  }

  // ---- web agent sessions (D1, encrypted) ----
  if (pathname === "/webagent/sessions" && method === "GET") {
    const userId = url.searchParams.get("userId") ?? "";
    if (userId) {
      const sessions = await listWebSessions(env, userId);
      return json({ sessions });
    }
    const rows = await env.DB.prepare(
      `SELECT user_id, session_id, updated_at, length(data) AS bytes FROM webagent_sessions ORDER BY updated_at DESC LIMIT 100`,
    ).all().then((r) => r.results).catch(() => []);
    return json({ rows });
  }

  if (pathname === "/webagent/session" && method === "GET") {
    const userId = url.searchParams.get("userId") ?? "";
    const sessionId = url.searchParams.get("session") ?? "";
    if (!userId || !sessionId) return fail("userId and session required");
    const session = await loadSession(env, userId, sessionId);
    if (!session) return fail("Session not found", 404);
    return json({ session });
  }

  if (pathname === "/webagent/session" && method === "DELETE") {
    const userId = url.searchParams.get("userId") ?? "";
    const sessionId = url.searchParams.get("session") ?? "";
    const deleted = await deleteWebSession(env, userId, sessionId);
    return json({ deleted });
  }

  if (pathname === "/webagent/job" && method === "GET") {
    const userId = url.searchParams.get("userId") ?? "";
    const sessionId = url.searchParams.get("session") ?? "";
    if (!userId || !sessionId) return fail("userId and session required");
    const job = await getJob(env, userId, sessionId);
    return json(job ?? { status: "none" });
  }

  if (pathname === "/webagent/job" && method === "POST") {
    let body: { userId?: unknown; session?: unknown; job?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const userId = typeof body.userId === "string" ? body.userId : "";
    const sessionId = typeof body.session === "string" ? body.session : "";
    const job = body.job && typeof body.job === "object" ? body.job as Record<string, unknown> : {};
    if (!userId || !sessionId) return fail("userId and session required");
    await putJob(env, userId, sessionId, job);
    return json({ saved: true });
  }

  // ---- bans ----
  if (pathname === "/bans" && method === "GET") {
    const bans = await listUserBans(env);
    const detailed = await Promise.all(
      bans.map(async (ban) => ({
        ...ban,
        active: await getUserBan(env, ban.user_id).then((b) => Boolean(b)).catch(() => false),
      })),
    );
    return json({ bans: detailed });
  }

  if (pathname === "/bans/unban" && method === "POST") {
    let body: { userId?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) return fail("userId required");
    if (!userId) return fail("userId required");
    const removed = await unbanUser(env, userId);
    return json({ removed, userId });
  }

  // ---- generic D1 table browser (whitelisted tables, read-only) ----
  if (pathname.startsWith("/d1/") && method === "GET") {
    const table = pathname.slice("/d1/".length);
    if (!D1_TABLES.has(table)) return fail("Unknown table");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const search = (url.searchParams.get("q") ?? "").trim();
    let sql = `SELECT * FROM ${table}`;
    const binds: unknown[] = [];
    if (search) {
      sql += ` WHERE CAST(rowid AS TEXT) = ? OR TRUE`;
      binds.push(search);
    }
    sql += ` ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`;
    try {
      const rows = await env.DB.prepare(sql).bind(...(binds as never[])).all();
      const count = await countQuery(env, table);
      return json({ table, rows: rows.results, count });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "query failed", 500);
    }
  }

  // ---- gateway control ----
  if (pathname === "/gateway/restart" && method === "POST") {
    await gatewayStub(env).fetch("https://gateway.internal/restart");
    return json({ restarted: true });
  }

  if (pathname === "/cooldowns/clear" && method === "POST") {
    const page = await env.CONVERSATIONS.list({ prefix: "provider-cooldown:", limit: 50 });
    for (const key of page.keys) await env.CONVERSATIONS.delete(key.name);
    return json({ cleared: page.keys.length });
  }

  // ---- AI chain test ----
  if (pathname === "/complete" && method === "POST") {
    let body: { prompt?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return fail("Invalid JSON"); }
    const prompt = typeof body.prompt === "string" ? body.prompt : "Reply with the single word OK.";
    const { completeWithFallback } = await import("./ai/router");
    const started = Date.now();
    try {
      const response = await completeWithFallback(env, {
        messages: [{ role: "user", content: prompt }],
        maxTokens: 60,
        temperature: 0,
      });
      return json({ ok: true, provider: response.provider, model: response.model, ms: Date.now() - started, content: response.content.slice(0, 300) });
    } catch (error) {
      return json({ ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // ---- websess (login sessions) ----
  if (pathname === "/websess" && method === "GET") {
    const page = await env.CONVERSATIONS.list({ prefix: "websess:", limit: 100 });
    const out = [];
    for (const key of page.keys) {
      const blob = await env.CONVERSATIONS.get(key.name);
      let session: Record<string, unknown> | null = null;
      const secretValue = env.WEB_SESSION_SECRET ?? "";
      if (blob && secretValue) {
        try {
          const plain = await decryptPayload(secretValue, String(blob));
          if (plain) session = JSON.parse(plain) as Record<string, unknown>;
        } catch {
          session = { parseError: true };
        }
      }
      out.push({ key: key.name, expires: key.expiration ?? null, session });
    }
    return json({ sessions: out });
  }

  if (pathname === "/websess" && method === "DELETE") {
    const key = url.searchParams.get("key") ?? "";
    await env.CONVERSATIONS.delete(key);
    return json({ deleted: key });
  }

  return fail(`Unknown owner route: ${method} ${pathname}`, 404);
}
