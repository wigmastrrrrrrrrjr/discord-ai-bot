import type { Env } from "./env";
import { encryptPayload, decryptPayload } from "./web-agent-auth";

// Every web-agent session payload is AES-GCM encrypted before storage.
// D1 is the primary store; Workers KV is a fallback only (used when D1
// fails, and read when a record exists in KV but not yet in D1 — legacy
// values are then migrated into D1).

export interface WebAgentMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
}

export interface WebAgentSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: WebAgentMessage[];
}

function secret(env: Env): string {
  return env.WEB_SESSION_SECRET ?? "unconfigured";
}

// Auto-reset guard: a web session that grows past this char budget
// (~75k tokens, well inside every model's context) drops its oldest
// messages instead of failing the run with a too-long-context error.
const DEFAULT_MAX_HISTORY_CHARS = 300000;
const MAX_MESSAGE_CHARS = 8000;

function historyMaxChars(env: Env): number {
  const configured = Number(env.WEB_HISTORY_MAX_CHARS);
  return configured > 0 ? configured : DEFAULT_MAX_HISTORY_CHARS;
}

function trimSession(env: Env, session: WebAgentSession): WebAgentSession {
  const budget = historyMaxChars(env);
  const messages = session.messages
    .slice(-200)
    .map((message) => ({
      ...message,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }));
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    total += messages[i].content.length;
    if (total > budget) break;
    start = i;
  }
  return { ...session, messages: messages.slice(start) };
}

function indexKey(userId: string): string {
  return `webagent-idx:${userId}`;
}

function dataKey(userId: string, sessionId: string): string {
  return `webagent:${userId}:${sessionId}`;
}

function d1Ready(env: Env): boolean {
  return Boolean(env.DB?.prepare);
}

// --- raw payload accessors: D1 primary, KV fallback ---

async function kvGet(env: Env, key: string): Promise<string | null> {
  try {
    return await env.CONVERSATIONS.get(key);
  } catch {
    return null;
  }
}

async function kvPut(env: Env, key: string, value: string, ttl?: number): Promise<void> {
  try {
    await env.CONVERSATIONS.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
  } catch {
    // KV is best-effort
  }
}

async function kvDelete(env: Env, key: string): Promise<void> {
  try {
    await env.CONVERSATIONS.delete(key);
  } catch {
    // best-effort
  }
}

interface PayloadRef {
  d1Sql: string;
  d1Binds: unknown[];
  kvKey: string;
  kvTtl?: number;
}

async function getPayload(env: Env, ref: PayloadRef): Promise<string | null> {
  if (d1Ready(env)) {
    try {
      const row = await env.DB.prepare(ref.d1Sql).bind(...(ref.d1Binds as never[])).first<{ data: string }>();
      if (row?.data) return row.data;
    } catch {
      // fall through to KV
    }
    // Legacy record living only in KV: surface it and migrate to D1.
    const legacy = await kvGet(env, ref.kvKey);
    if (legacy) {
      void putPayload(env, ref, legacy);
      return legacy;
    }
    return null;
  }
  return kvGet(env, ref.kvKey);
}

async function putPayload(
  env: Env,
  ref: PayloadRef,
  value: string,
): Promise<void> {
  let d1Ok = false;
  if (d1Ready(env)) {
    try {
      await env.DB.prepare(ref.d1Sql)
        .bind(...(ref.d1Binds as never[]))
        .run();
      d1Ok = true;
    } catch {
      // fall back to KV
    }
  }
  if (!d1Ok) {
    await kvPut(env, ref.kvKey, value, ref.kvTtl);
  }
}

async function deletePayload(env: Env, ref: PayloadRef): Promise<void> {
  if (d1Ready(env)) {
    try {
      await env.DB.prepare(ref.d1Sql)
        .bind(...(ref.d1Binds as never[]))
        .run();
    } catch {
      // best-effort
    }
  }
  await kvDelete(env, ref.kvKey);
}

// --- sessions ---

function sessionRef(env: Env, userId: string, sessionId: string): PayloadRef {
  return {
    d1Sql: `INSERT INTO webagent_sessions (user_id, session_id, data, updated_at)
            VALUES (?, ?, ?, strftime('%s','now') * 1000)
            ON CONFLICT(user_id, session_id) DO UPDATE SET
              data = excluded.data, updated_at = excluded.updated_at`,
    d1Binds: [userId, sessionId, ""],
    kvKey: dataKey(userId, sessionId),
    kvTtl: 180 * 24 * 3600,
  };
}

// The same ref works for reads (SELECT) — swap the SQL per operation.
export async function listSessions(
  env: Env,
  userId: string,
): Promise<WebAgentSessionMeta[]> {
  try {
    if (d1Ready(env)) {
      const result = await env.DB.prepare(
        `SELECT data FROM webagent_index WHERE user_id = ?`,
      )
        .bind(userId)
        .first<{ data: string }>();
      if (result?.data) {
        const json = await decryptPayload(secret(env), result.data);
        const parsed = json ? (JSON.parse(json) as WebAgentSessionMeta[]) : [];
        return Array.isArray(parsed) ? parsed : [];
      }
    }
    const blob = await kvGet(env, indexKey(userId));
    if (!blob) return [];
    const json = await decryptPayload(secret(env), blob);
    if (!json) return [];
    const parsed = JSON.parse(json) as WebAgentSessionMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveIndex(
  env: Env,
  userId: string,
  sessions: WebAgentSessionMeta[],
): Promise<void> {
  const blob = await encryptPayload(secret(env), JSON.stringify(sessions));
  let ok = false;
  if (d1Ready(env)) {
    try {
      await env.DB.prepare(
        `INSERT INTO webagent_index (user_id, data, updated_at)
         VALUES (?, ?, strftime('%s','now') * 1000)
         ON CONFLICT(user_id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at`,
      )
        .bind(userId, blob)
        .run();
      ok = true;
    } catch {
      // fall back to KV
    }
  }
  if (!ok) {
    await kvPut(env, indexKey(userId), blob);
  }
}

export async function loadSession(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<WebAgentSession | null> {
  try {
    const blob = await getPayload(env, {
      d1Sql: `SELECT data FROM webagent_sessions WHERE user_id = ? AND session_id = ?`,
      d1Binds: [userId, sessionId],
      kvKey: dataKey(userId, sessionId),
    });
    if (!blob) return null;
    const json = await decryptPayload(secret(env), blob);
    if (!json) return null;
    return JSON.parse(json) as WebAgentSession;
  } catch {
    return null;
  }
}

export async function saveSession(
  env: Env,
  userId: string,
  session: WebAgentSession,
): Promise<void> {
  const blob = await encryptPayload(
    secret(env),
    JSON.stringify(trimSession(env, session)),
  );
  const ref = sessionRef(env, userId, session.id);
  ref.d1Binds = [userId, session.id, blob];
  await putPayload(env, ref, blob);
  const index = await listSessions(env, userId);
  const meta: WebAgentSessionMeta = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  const withoutOld = index.filter((item) => item.id !== session.id);
  const next = [meta, ...withoutOld].sort((a, b) => b.updatedAt - a.updatedAt);
  await saveIndex(env, userId, next.slice(0, 50));
}

export async function createSession(
  env: Env,
  userId: string,
  title = "New chat",
): Promise<WebAgentSession> {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: title.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export async function deleteSession(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const index = await listSessions(env, userId);
  if (!index.some((item) => item.id === sessionId)) return false;
  await deletePayload(env, {
    d1Sql: `DELETE FROM webagent_sessions WHERE user_id = ? AND session_id = ?`,
    d1Binds: [userId, sessionId],
    kvKey: dataKey(userId, sessionId),
  });
  await saveIndex(
    env,
    userId,
    index.filter((item) => item.id !== sessionId),
  );
  return true;
}

// --- run jobs (live status while the agent works server-side) ---

export async function getJob(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await getPayload(env, {
    d1Sql: `SELECT data FROM webagent_jobs WHERE user_id = ? AND session_id = ?`,
    d1Binds: [userId, sessionId],
    kvKey: `webagent-job:${userId}:${sessionId}`,
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function putJob(
  env: Env,
  userId: string,
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(payload);
  await putPayload(
    env,
    {
      d1Sql: `INSERT INTO webagent_jobs (user_id, session_id, data, updated_at)
              VALUES (?, ?, ?, strftime('%s','now') * 1000)
              ON CONFLICT(user_id, session_id) DO UPDATE SET
                data = excluded.data, updated_at = excluded.updated_at`,
      d1Binds: [userId, sessionId, json],
      kvKey: `webagent-job:${userId}:${sessionId}`,
      kvTtl: 3600,
    },
    json,
  );
}

export function titleFromPrompt(prompt: string): string {
  return (
    prompt.replace(/\s+/g, " ").trim().slice(0, 60) ||
    "New chat"
  );
}
