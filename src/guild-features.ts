import { botApi } from "./discord/rest";
import type { Env } from "./env";

export interface AutomodConfig {
  guildId: string;
  enabled: boolean;
  bannedWords: string[];
  notice: string;
}

export interface WelcomeConfig {
  guildId: string;
  channelId: string;
  messageText: string;
  dmEnabled: boolean;
  dmText: string;
  goodbyeChannelId: string;
  goodbyeText: string;
}

interface AutomodRow {
  enabled: number;
  banned_words: string;
  notice: string;
}

interface WelcomeRow {
  channel_id: string;
  message_text: string;
  dm_enabled: number;
  dm_text: string;
  goodbye_channel_id: string;
  goodbye_text: string;
}

export async function loadAutomod(
  env: Env,
  guildId: string,
): Promise<AutomodConfig | null> {
  const row = await env.DB.prepare(
    `SELECT enabled, banned_words, notice FROM guild_automod WHERE guild_id = ?`,
  )
    .bind(guildId)
    .first<AutomodRow>();
  if (!row) return null;
  let words: string[] = [];
  try {
    const parsed = JSON.parse(row.banned_words) as unknown;
    if (Array.isArray(parsed)) {
      words = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
    }
  } catch {
    words = [];
  }
  return {
    guildId,
    enabled: Boolean(row.enabled),
    bannedWords: words,
    notice: row.notice,
  };
}

export async function saveAutomod(
  env: Env,
  guildId: string,
  config: { enabled: boolean; bannedWords: string[]; notice: string },
): Promise<void> {
  const words = Array.from(
    new Set(
      config.bannedWords
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO guild_automod (guild_id, enabled, banned_words, notice, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       enabled = excluded.enabled,
       banned_words = excluded.banned_words,
       notice = excluded.notice,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      config.enabled ? 1 : 0,
      JSON.stringify(words),
      config.notice.slice(0, 200),
      Date.now(),
    )
    .run();
}

export async function loadWelcome(
  env: Env,
  guildId: string,
): Promise<WelcomeConfig | null> {
  const row = await env.DB.prepare(
    `SELECT channel_id, message_text, dm_enabled, dm_text, goodbye_channel_id, goodbye_text
       FROM guild_welcome WHERE guild_id = ?`,
  )
    .bind(guildId)
    .first<WelcomeRow>();
  if (!row) return null;
  return {
    guildId,
    channelId: row.channel_id,
    messageText: row.message_text,
    dmEnabled: Boolean(row.dm_enabled),
    dmText: row.dm_text,
    goodbyeChannelId: row.goodbye_channel_id,
    goodbyeText: row.goodbye_text,
  };
}

export async function saveWelcome(
  env: Env,
  guildId: string,
  config: {
    channelId: string;
    messageText: string;
    dmEnabled: boolean;
    dmText: string;
    goodbyeChannelId: string;
    goodbyeText: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO guild_welcome
       (guild_id, channel_id, message_text, dm_enabled, dm_text, goodbye_channel_id, goodbye_text, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_text = excluded.message_text,
       dm_enabled = excluded.dm_enabled,
       dm_text = excluded.dm_text,
       goodbye_channel_id = excluded.goodbye_channel_id,
       goodbye_text = excluded.goodbye_text,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      config.channelId,
      config.messageText.slice(0, 1000),
      config.dmEnabled ? 1 : 0,
      config.dmText.slice(0, 1000),
      config.goodbyeChannelId,
      config.goodbyeText.slice(0, 1000),
      Date.now(),
    )
    .run();
}

export type LogKind =
  | "automod-delete"
  | "welcome"
  | "goodbye"
  | "identity"
  | "announce";

export async function logEvent(
  env: Env,
  guildId: string,
  kind: LogKind,
  message: string,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO infra_log (guild_id, at, kind, message) VALUES (?, ?, ?, ?)`,
    )
      .bind(guildId, Date.now(), kind, message.slice(0, 300))
      .run();
  } catch {
    // Logging is best effort.
  }
}

export async function listEvents(
  env: Env,
  guildId: string,
  limit = 50,
): Promise<Array<{ at: number; kind: string; message: string }>> {
  const result = await env.DB.prepare(
    `SELECT at, kind, message FROM infra_log
      WHERE guild_id = ?
      ORDER BY at DESC
      LIMIT ?`,
  )
    .bind(guildId, Math.min(200, Math.max(1, limit)))
    .all<{ at: number; kind: string; message: string }>();
  return (result.results ?? []).map((row) => ({
    at: Number(row.at),
    kind: row.kind,
    message: row.message,
  }));
}

export async function clearEvents(env: Env, guildId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM infra_log WHERE guild_id = ?`)
    .bind(guildId)
    .run();
}

export async function sendDm(
  env: Env,
  userId: string,
  content: string,
): Promise<void> {
  const channel = await botApi(env, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!channel.ok) return;
  const dm = (await channel.json().catch(() => null)) as { id?: string } | null;
  if (!dm?.id) return;
  void channel;
  await botApi(env, `/channels/${dm.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

export function automodViolation(
  config: AutomodConfig,
  content: string,
): string | null {
  if (!config.enabled) return null;
  const lower = content.toLowerCase();
  for (const word of config.bannedWords) {
    if (!word) continue;
    if (lower.includes(word)) return word;
  }
  return null;
}
