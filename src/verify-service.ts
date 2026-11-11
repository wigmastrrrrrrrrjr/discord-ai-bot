import type { Env } from "./env";

export interface VerificationIdentity {
  ipHash: string;
  fingerprintHash: string;
  identityHash: string;
  userAgent: string;
  createdAt: number;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function getIdentity(
  env: Env,
  userId: string,
): Promise<VerificationIdentity | null> {
  const raw = await env.CONVERSATIONS.get(`verify:identity:${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VerificationIdentity;
  } catch {
    return null;
  }
}

export async function storeIdentity(
  env: Env,
  userId: string,
  identity: VerificationIdentity,
): Promise<void> {
  await env.CONVERSATIONS.put(
    `verify:identity:${userId}`,
    JSON.stringify(identity),
  );
}

export async function isBannedIdentity(
  env: Env,
  guildId: string,
  identityHash: string,
): Promise<{ userId: string; createdAt: number } | null> {
  const raw = await env.CONVERSATIONS.get(
    `verify:banned:${guildId}:${identityHash}`,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { userId: string; createdAt: number };
  } catch {
    return null;
  }
}

export async function recordBannedIdentity(
  env: Env,
  guildId: string,
  identityHash: string,
  userId: string,
): Promise<void> {
  await env.CONVERSATIONS.put(
    `verify:banned:${guildId}:${identityHash}`,
    JSON.stringify({ userId, createdAt: Date.now() }),
  );
}

export async function markVerified(
  env: Env,
  guildId: string,
  userId: string,
  identityHash: string,
): Promise<void> {
  await env.CONVERSATIONS.put(
    `verify:guild:${guildId}:${userId}`,
    JSON.stringify({ identityHash, verifiedAt: Date.now() }),
  );
}

export async function recordBanForUser(
  env: Env,
  guildId: string,
  userId: string,
): Promise<void> {
  const identity = await getIdentity(env, userId);
  if (!identity) return;
  await recordBannedIdentity(env, guildId, identity.identityHash, userId);
}

export async function assignUnverifiedRoleOnJoin(
  env: Env,
  guildId: string,
  userId: string,
  currentRoles: string[],
): Promise<void> {
  const rolesResponse = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    {
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    },
  );
  if (!rolesResponse.ok) return;
  const roles = (await rolesResponse.json()) as Array<{ id: string; name: string }>;
  const unverifiedRole = roles.find((role) => role.name === "Unverified");
  const verifiedRole = roles.find((role) => role.name === "Verified");
  if (!unverifiedRole) return;
  if (verifiedRole && currentRoles.includes(verifiedRole.id)) return;
  if (currentRoles.includes(unverifiedRole.id)) return;

  await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${unverifiedRole.id}`,
    {
      method: "PUT",
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    },
  ).catch(() => undefined);
}

export async function isVerified(
  env: Env,
  guildId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(await env.CONVERSATIONS.get(`verify:guild:${guildId}:${userId}`));
}
