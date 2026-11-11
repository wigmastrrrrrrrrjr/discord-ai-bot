import type { Env } from "./env";

const SESSION_KEY_PREFIX = "session:";
const STATE_KEY_PREFIX = "oauth:state:";

interface D1State {
  payload: string;
  expiresAt: number;
}

function d1Key(kind: "session" | "state", id: string): string {
  return `${kind}:${id}`;
}

function expiresInSecondsFromKey(key: string): number {
  return key === "session" ? 7 * 24 * 60 * 60 : 10 * 60;
}

export async function loadState(
  env: Env,
  kind: "session" | "state",
  id: string,
): Promise<{ payload: string; expiresAt: number } | null> {
  const key = d1Key(kind, id);
  try {
    const row = await env.DB.prepare(
      `SELECT payload, expires_at AS expiresAt
         FROM dashboard_state
        WHERE kind = ? AND key = ?`,
    )
      .bind(kind, key)
      .first<D1State | null>();
    if (row) {
      if (typeof row.payload === "string") {
        return { payload: row.payload, expiresAt: row.expiresAt };
      }
      await deleteState(env, kind, id);
      return null;
    }
  } catch {
    // Fall back to KV below.
  }

  const stored = await env.CONVERSATIONS.get(key);
  if (!stored) return null;
  try {
    return { payload: stored, expiresAt: Date.now() / 1000 };
  } catch {
    return null;
  }
}

export async function saveState(
  env: Env,
  kind: "session" | "state",
  id: string,
  payload: string,
): Promise<void> {
  const key = d1Key(kind, id);
  const expiresAt = Date.now() / 1000 + expiresInSecondsFromKey(kind);
  try {
    await env.DB.prepare(
      `INSERT INTO dashboard_state (kind, key, payload, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, key) DO UPDATE
          SET payload = excluded.payload,
              expires_at = excluded.expires_at`,
    )
      .bind(kind, key, payload, expiresAt)
      .run();
  } catch {
    await env.CONVERSATIONS.put(key, payload, {
      expirationTtl: expiresInSecondsFromKey(kind),
    });
  }
}

export async function deleteState(
  env: Env,
  kind: "session" | "state",
  id: string,
): Promise<void> {
  const key = d1Key(kind, id);
  try {
    await env.DB.prepare(
      `DELETE FROM dashboard_state
        WHERE kind = ? AND key = ?`,
    )
      .bind(kind, key)
      .run();
  } catch {
    await env.CONVERSATIONS.delete(key);
  }
}
