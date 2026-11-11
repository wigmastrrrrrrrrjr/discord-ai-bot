import { decryptText, encryptText } from "./crypto";
import type { Env } from "./env";
import {
  PROVIDER_IDS,
  PROVIDERS,
  isKeyProviderId,
  type ProviderId,
} from "./model-catalog";

export const KEY_PROVIDERS = PROVIDER_IDS.filter(
  (provider) => PROVIDERS[provider].requiresKey,
) as Array<Exclude<ProviderId, "workers-ai">>;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

interface StoredGuildKey {
  encrypted: string;
  updatedAt: number;
}

export interface GuildKeySummary {
  provider: KeyProvider;
  updatedAt: number;
}

export function isKeyProvider(value: string): value is KeyProvider {
  return isKeyProviderId(value) && value !== "workers-ai";
}

function keyFor(guildId: string, provider: KeyProvider): string {
  return `guild-api-key:${guildId}:${provider}`;
}

function envKeyFor(provider: KeyProvider): keyof Env | undefined {
  return PROVIDERS[provider].keyEnv;
}

export async function saveGuildApiKey(
  env: Env,
  guildId: string,
  provider: KeyProvider,
  apiKey: string,
): Promise<GuildKeySummary> {
  const updatedAt = Date.now();
  const encrypted = await encryptText(env, apiKey);
  const stored: StoredGuildKey = { encrypted, updatedAt };
  await env.CONVERSATIONS.put(keyFor(guildId, provider), JSON.stringify(stored), {
    metadata: { updatedAt },
  });
  return { provider, updatedAt };
}

export async function listGuildApiKeys(
  env: Env,
  guildId: string,
): Promise<GuildKeySummary[]> {
  const prefix = `guild-api-key:${guildId}:`;
  const listed = await env.CONVERSATIONS.list({ prefix, limit: 50 });
  const keys: GuildKeySummary[] = [];
  for (const key of listed.keys) {
    const provider = key.name.slice(prefix.length);
    if (!isKeyProvider(provider)) continue;
    const metadata = key.metadata as { updatedAt?: unknown } | null;
    keys.push({
      provider,
      updatedAt:
        typeof metadata?.updatedAt === "number" ? metadata.updatedAt : 0,
    });
  }
  return keys.sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function deleteGuildApiKey(
  env: Env,
  guildId: string,
  provider: KeyProvider,
): Promise<void> {
  await env.CONVERSATIONS.delete(keyFor(guildId, provider));
}

export async function getGuildApiKey(
  env: Env,
  guildId: string,
  provider: KeyProvider,
): Promise<string | null> {
  const raw = await env.CONVERSATIONS.get(keyFor(guildId, provider));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredGuildKey;
    if (!stored.encrypted) return null;
    return await decryptText(env, stored.encrypted);
  } catch (error) {
    console.error("Could not decrypt guild API key", error);
    return null;
  }
}

export async function applyGuildApiKeys(
  env: Env,
  guildId: string,
): Promise<Env> {
  const keys = await listGuildApiKeys(env, guildId).catch(() => []);
  if (!keys.length) return env;

  const next = { ...env } as Env;
  await Promise.all(
    keys.map(async ({ provider }) => {
      const envKey = envKeyFor(provider);
      if (!envKey) return;
      const apiKey = await getGuildApiKey(env, guildId, provider).catch(
        () => null,
      );
      if (!apiKey) return;
      (next as unknown as Record<string, unknown>)[envKey] = apiKey;
    }),
  );
  return next;
}

export async function scopedEnvForGuild(
  env: Env,
  guildId: string,
  provider: string,
): Promise<Env> {
  if (!isKeyProvider(provider)) return env;
  const apiKey = await getGuildApiKey(env, guildId, provider);
  if (!apiKey) return env;
  const envKey = envKeyFor(provider);
  if (!envKey) return env;
  const next = { ...env } as Env;
  (next as unknown as Record<string, unknown>)[envKey] = apiKey;
  return next;
}
