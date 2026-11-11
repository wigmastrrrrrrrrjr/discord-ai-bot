import type { Env } from "./env";
import { encryptText, decryptText } from "./crypto";

// gh CLI's well-known device-flow OAuth client id — lets users link GitHub
// without the bot owner registering an app or ever seeing a token.
const GH_CLIENT_ID = "178c6fc778ccc68e1d6a";
const DEVICE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GH_SCOPES = "repo read:user";

const KV_PREFIX = "github-auth:";
const MIGRATED_PREFIX = "ghconv:";

interface StoredAuth {
  token: string;
  login: string;
}

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  interval: number;
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const response = await fetch(DEVICE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({ client_id: GH_CLIENT_ID, scope: GH_SCOPES }),
  });
  if (!response.ok) {
    throw new Error(`GitHub device flow failed (${response.status})`);
  }
  const data = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
  };
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("GitHub device flow returned an unexpected response");
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verifyUrl: data.verification_uri,
    interval: data.interval ?? 5,
  };
}

export type DeviceFlowResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "done"; token: string };

export async function pollDeviceFlow(
  deviceCode: string,
): Promise<DeviceFlowResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    interval?: number;
  };
  if (data.access_token) return { status: "done", token: data.access_token };
  if (data.error === "slow_down") {
    return { status: "slow_down", interval: data.interval ?? 10 };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  return { status: "expired" };
}

export async function fetchGithubLogin(token: string): Promise<string | null> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      "authorization": `Bearer ${token}`,
      "user-agent": "discord-ai-bot",
      "accept": "application/vnd.github+json",
    },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { login?: string };
  return data.login ?? null;
}

export async function getGithubAuth(
  env: Env,
  userId: string,
): Promise<StoredAuth | null> {
  if (!userId) return null;
  try {
    const raw = await env.CONVERSATIONS.get(`${KV_PREFIX}${userId}`);
    if (!raw) return null;
    const plain = await decryptText(env, raw);
    const parsed = JSON.parse(plain) as StoredAuth;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveGithubAuth(
  env: Env,
  userId: string,
  token: string,
  login: string,
): Promise<void> {
  const encrypted = await encryptText(
    env,
    JSON.stringify({ token, login } satisfies StoredAuth),
  );
  await env.CONVERSATIONS.put(`${KV_PREFIX}${userId}`, encrypted);
}

export async function clearGithubAuth(env: Env, userId: string): Promise<void> {
  await env.CONVERSATIONS.delete(`${KV_PREFIX}${userId}`);
}

// After a user links GitHub their conversations live under a fresh
// ghconv: namespace (still AES-GCM encrypted at rest).
export function githubHistoryKey(baseKey: string): string {
  return baseKey.startsWith("conv:")
    ? `${MIGRATED_PREFIX}${baseKey.slice("conv:".length)}`
    : baseKey;
}

export async function userHistoryKey(
  env: Env,
  baseKey: string,
  userId: string,
): Promise<string> {
  if (!baseKey.startsWith("conv:")) return baseKey;
  const auth = await getGithubAuth(env, userId);
  return auth ? githubHistoryKey(baseKey) : baseKey;
}

// One-time move: copy the user's existing conversation keys into the new
// ghconv: namespace and delete the originals.
export async function migrateUserHistory(
  env: Env,
  userId: string,
): Promise<number> {
  let moved = 0;
  let cursor: string | undefined;
  const dmKey = `conv:dm:${userId}`;
  do {
    const page = await env.CONVERSATIONS.list({
      prefix: "conv:",
      cursor,
      limit: 100,
    });
    for (const key of page.keys) {
      if (!key.name.startsWith("conv:")) continue;
      const isUserKey =
        key.name === dmKey || key.name.endsWith(`:u${userId}`);
      if (!isUserKey) continue;
      const value = await env.CONVERSATIONS.get(key.name);
      if (value == null) continue;
      await env.CONVERSATIONS.put(githubHistoryKey(key.name), value, {
        expirationTtl: 7 * 24 * 60 * 60,
      });
      await env.CONVERSATIONS.delete(key.name);
      moved += 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return moved;
}
