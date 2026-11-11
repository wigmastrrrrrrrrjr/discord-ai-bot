import { decryptText, encryptText, isEncryptedText } from "./crypto";
import type { Env } from "./env";

interface GuildConfigRow {
  channel_id: string | null;
  auto_reply: number;
  system_prompt: string | null;
  bot_nickname: string | null;
  use_emojis: number;
  reaction_emoji: string | null;
  reply_emoji: string | null;
  persona: string | null;
  respond_bots: string | null;
  respond_name: string | null;
  respond_avatar: string | null;
}

export interface GuildConfig {
  channelId: string | null;
  autoReply: boolean;
  systemPrompt: string | null;
  botNickname: string | null;
  useEmojis: boolean;
  reactionEmoji: string;
  replyEmoji: string;
  persona: string | null;
  respondBots: string[];
  respondName: string;
  respondAvatar: string;
}

export async function decryptStoredText(
  env: Env,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (!isEncryptedText(value)) return value;
  try {
    return await decryptText(env, value);
  } catch (error) {
    console.error("Could not decrypt stored text", error);
    return null;
  }
}

export async function loadGuildConfig(
  env: Env,
  guildId: string,
): Promise<GuildConfig | null> {
  const row = await env.DB.prepare(
    `SELECT channel_id, auto_reply, system_prompt, bot_nickname,
            use_emojis, reaction_emoji, reply_emoji, persona, respond_bots,
            respond_name, respond_avatar
       FROM guild_configs
      WHERE guild_id = ?`,
  )
    .bind(guildId)
    .first<GuildConfigRow>();

  if (!row) return null;

  return {
    channelId: row.channel_id,
    autoReply: Boolean(row.auto_reply),
    systemPrompt: await decryptStoredText(env, row.system_prompt),
    botNickname: row.bot_nickname,
    useEmojis: row.use_emojis == null ? true : Boolean(row.use_emojis),
    reactionEmoji: row.reaction_emoji || "✅",
    replyEmoji: row.reply_emoji || "",
    persona: await decryptStoredText(env, row.persona),
    respondBots: parseRespondBots(row.respond_bots),
    respondName: row.respond_name || "",
    respondAvatar: row.respond_avatar || "",
  };
}

function parseRespondBots(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && /^\d+$/.test(item))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export async function saveRespondBots(
  env: Env,
  guildId: string,
  guildName: string | null,
  botIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(botIds.filter((id) => /^\d+$/.test(id)))).slice(0, 50);
  await env.DB.prepare(
    `INSERT INTO guild_configs
       (guild_id, guild_name, updated_at, respond_bots)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       guild_name = COALESCE(excluded.guild_name, guild_name),
       respond_bots = excluded.respond_bots,
       updated_at = excluded.updated_at`,
  )
    .bind(guildId, guildName, Date.now(), JSON.stringify(unique))
    .run();
}

export interface GuildPersona {
  botNickname?: string;
  useEmojis?: boolean;
  reactionEmoji?: string;
  replyEmoji?: string;
  persona?: string;
  respondName?: string;
  respondAvatar?: string;
}



export async function saveGuildPersona(
  env: Env,
  guildId: string,
  guildName: string | null,
  persona: GuildPersona,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO guild_configs
       (guild_id, guild_name, updated_at, bot_nickname, use_emojis,
        reaction_emoji, reply_emoji, persona, respond_name, respond_avatar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       guild_name = COALESCE(excluded.guild_name, guild_name),
       bot_nickname = excluded.bot_nickname,
       use_emojis = excluded.use_emojis,
       reaction_emoji = excluded.reaction_emoji,
       reply_emoji = excluded.reply_emoji,
       persona = excluded.persona,
       respond_name = excluded.respond_name,
       respond_avatar = excluded.respond_avatar,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      guildName,
      Date.now(),
      persona.botNickname || null,
      persona.useEmojis === false ? 0 : 1,
      persona.reactionEmoji || "",
      persona.replyEmoji || "",
      persona.persona ? await encryptText(env, persona.persona) : null,
      (persona.respondName ?? "").slice(0, 80),
      persona.respondAvatar ?? "",
    )
    .run();
}
