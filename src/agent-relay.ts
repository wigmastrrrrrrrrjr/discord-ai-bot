import { botApi } from "./discord/rest";
import type { Env } from "./env";

// The mirrored half lives in scripts/agentrelay.py on the user's device.
// Tokens last two hours; while the agent works inside the window the client
// can refresh transparently. If the window lapses the agent is halted until
// the user refreshes — then its pending work continues untouched.

export const RELAY_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export interface RelayTokenStatus {
  token: string;
  expiresAt: number;
}

export interface RelayBindOutcome
  extends RelayTokenStatus {
  halted: boolean;
}

function randomHex(bytes = 24): string {
  let out = "";
  const chunkSource = new Uint8Array(bytes);
  crypto.getRandomValues(chunkSource);
  for (const byte of chunkSource) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function createToken(
  env: Env,
  userId: string,
): Promise<RelayTokenStatus> {
  const token = `arl_${randomHex()}`;
  const expiresAt = Date.now() + RELAY_TOKEN_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO relay_tokens (token, user_id, status, expires_at)
     VALUES (?, ?, 'active', ?)`,
  )
    .bind(token, userId, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function issueBindCode(
  env: Env,
  userId: string,
): Promise<string> {
  const code = `bind_${randomHex(6)}`;
  await env.CONVERSATIONS.put(
    `agentrelay:bindcode:${code}`,
    JSON.stringify({ userId }),
    { expirationTtl: 600 },
  );
  return code;
}

export async function resolveBindCode(
  env: Env,
  code: string,
): Promise<RelayBindOutcome> {
  const raw = await env.CONVERSATIONS.get(`agentrelay:bindcode:${code}`);
  if (!raw) throw new Error("Bind code unknown or already used.");
  let userId = "";
  try {
    const payload = JSON.parse(raw) as { userId?: string };
    userId = payload.userId ?? "";
  } catch {
    userId = raw;
  }
  if (!userId) throw new Error("Bind code is empty.");
  await env.CONVERSATIONS.delete(`agentrelay:bindcode:${code}`);
  await closeStaleTokens(env, userId);
  const created = await createToken(env, userId);
  return { ...created, halted: false };
}

async function closeStaleTokens(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE relay_tokens SET status = 'expired' WHERE user_id = ? AND status = 'active'`,
  )
    .bind(userId)
    .run();
}

export async function latestTokenForUser(
  env: Env,
  userId: string,
  allowExpired = false,
): Promise<RelayTokenStatus | null> {
  const row = allowExpired
    ? await env.DB.prepare(
        `SELECT token, expires_at FROM relay_tokens
          WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1`,
      )
        .bind(userId)
        .first<{ token: string; expires_at: number }>()
    : await env.DB.prepare(
        `SELECT token, expires_at FROM relay_tokens
          WHERE user_id = ? AND status = 'active' AND expires_at > ?
          ORDER BY expires_at DESC LIMIT 1`,
      )
        .bind(userId, Date.now())
        .first<{ token: string; expires_at: number }>();
  if (!row) return null;
  return { token: row.token, expiresAt: row.expires_at };
}

/**
 * The client-side swap: when the two-hour window is over, the user's
 * agentrelay client calls refresh with the old token. Pending work is moved
 * to a fresh token so the agent can resume mid-action.
 */
export async function refreshToken(
  env: Env,
  oldToken: string,
): Promise<RelayBindOutcome> {
  const row = await env.DB.prepare(
    `SELECT user_id, status FROM relay_tokens WHERE token = ?`,
  )
    .bind(oldToken)
    .first<{ user_id: string; status: string }>();
  if (!row) throw new Error("Relay session unknown. Run `agentrelay bind`.");
  await env.DB.prepare(
    `UPDATE relay_tokens SET status = 'rotated' WHERE token = ?`,
  )
    .bind(oldToken)
    .run();
  await env.DB.prepare(
    `UPDATE relay_cmds SET token = ? WHERE token = ? AND status = 'pending'`,
  )
    .bind("pending-migration", oldToken)
    .run();
  await closeStaleTokens(env, row.user_id);
  const created = await createToken(env, row.user_id);
  await env.DB.prepare(
    `UPDATE relay_cmds SET token = ? WHERE token = 'pending-migration' AND user_id = ?`,
  )
    .bind(created.token, row.user_id)
    .run();
  return { ...created, halted: false };
}

export interface RelayCommand { id: string; command: string }

/** Queues a command for the user's device; returns whether it was halted. */
export async function queueRelayCommand(
  env: Env,
  userId: string,
  command: string,
): Promise<{ id?: string; halted?: boolean; reason?: string }> {
  const active = await latestTokenForUser(env, userId);
  if (!active) {
    // Still safe: existing halted/pending commands keep their ids so a
    // later bind/refresh can pick them up, but the agent must pause now.
    return { halted: true, reason: "no active relay session" };
  }
  const id = `cmd_${Date.now().toString(36)}_${randomHex(4)}`;
  await env.DB.prepare(
    `INSERT INTO relay_cmds (id, token, user_id, command, status, output, created_at)
     VALUES (?, ?, ?, ?, 'pending', '', ?)`,
  )
    .bind(id, active.token, userId, command.slice(0, 2000), Date.now())
    .run();
  return { id };
}

export async function relayCommandResult(
  env: Env,
  token: string,
  commandId: string,
  output: string,
): Promise<boolean> {
  const updated = await env.DB.prepare(
    `UPDATE relay_cmds
        SET status = 'done', output = ?
      WHERE id = ? AND token = ? AND status = 'pending'`,
  )
    .bind(output.slice(0, 20000), commandId, token)
    .run();
  return Boolean(updated.meta.changes);
}

export async function nextPendingCommand(
  env: Env,
  token: string,
): Promise<RelayCommand | null> {
  const row = await env.DB.prepare(
    `SELECT id, command FROM relay_cmds
      WHERE token = ? AND status = 'pending'
      ORDER BY created_at LIMIT 1`,
  )
    .bind(token)
    .first<{ id: string; command: string }>();
  if (!row) return null;
  return { id: row.id, command: row.command };
}

export async function tokenStatus(
  env: Env,
  token: string,
): Promise<{ valid: boolean; userId?: string; msLeft?: number }> {
  const row = await env.DB.prepare(
    `SELECT user_id, status, expires_at FROM relay_tokens WHERE token = ?`,
  )
    .bind(token)
    .first<{ user_id: string; status: string; expires_at: number }>();
  if (!row || row.status !== "active") return { valid: false };
  return { valid: true, userId: row.user_id, msLeft: row.expires_at - Date.now() };
}

/** Waits up to the timeout for the device result. */
export async function awaitCommandResult(
  env: Env,
  commandId: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await env.DB.prepare(
      `SELECT status, output FROM relay_cmds WHERE id = ?`,
    )
      .bind(commandId)
      .first<{ status: string; output: string }>();
    if (row?.status === "done") return row.output;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function sendAgentDm(
  env: Env,
  userId: string,
  content: string,
): Promise<void> {
  const dm = await botApi(env, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dm.ok) return;
  const channel = (await dm.json()) as { id?: string };
  if (!channel.id) return;
  await botApi(env, `/channels/${channel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: content.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
}
