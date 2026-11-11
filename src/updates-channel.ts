import { botApi } from "./discord/rest";
import type { Env } from "./env";

export const UPDATES_CHANNEL_NAME = "ai-chatbot-announcements";

export interface UpdatesChannelConfig {
  guildId: string;
  channelId: string | null;
  optedIn: boolean;
  created: boolean;
}

interface UpdatesRow {
  channel_id: string;
  opted_in: number;
}

interface DiscordChannel {
  id: string;
  name?: string;
}

interface DiscordGuild {
  owner_id?: string;
}

async function loadRow(env: Env, guildId: string): Promise<UpdatesRow | null> {
  return env.DB.prepare(
    `SELECT channel_id, opted_in FROM guild_updates WHERE guild_id = ?`,
  )
    .bind(guildId)
    .first<UpdatesRow>();
}

/**
 * Finds or creates the read-only announcements channel for a guild.
 * Everyone can see it, but only the bot and the server owner can speak in it.
 * Plain channel creation — the verification flow is never involved.
 */
export async function ensureUpdatesChannel(
  env: Env,
  guildId: string,
): Promise<UpdatesChannelConfig> {
  const existing = await loadRow(env, guildId);
  if (existing) {
    return {
      guildId,
      channelId: existing.channel_id,
      optedIn: Boolean(existing.opted_in),
      created: false,
    };
  }

  const channelsResponse = await botApi(
    env,
    `/guilds/${encodeURIComponent(guildId)}/channels`,
  );
  if (!channelsResponse.ok) {
    throw new Error(
      `Could not list channels: ${await channelsResponse.text()}`,
    );
  }
  const channels = (await channelsResponse.json()) as DiscordChannel[];
  let channel = channels.find((item) => item.name === UPDATES_CHANNEL_NAME);
  let created = false;

  if (!channel) {
    const guildResponse = await botApi(
      env,
      `/guilds/${encodeURIComponent(guildId)}`,
    );
    if (!guildResponse.ok) {
      throw new Error(
        `Could not load server owner: ${await guildResponse.text()}`,
      );
    }
    const guild = (await guildResponse.json()) as DiscordGuild;
    const ownerId = guild.owner_id ?? "";

    // ViewChannel 1024, SendMessages 4096, ReadMessageHistory 65536
    const overwrites = [
      {
        id: guildId, // @everyone role
        type: 0,
        allow: "1024", // can read, cannot send
        deny: "4096",
      },
      {
        id: env.DISCORD_CLIENT_ID ?? "", // the bot itself
        type: 1,
        allow: "60672", // view + send + history
        deny: "0",
      },
    ];
    if (ownerId && ownerId !== env.DISCORD_CLIENT_ID) {
      overwrites.push({ id: ownerId, type: 1, allow: "4096", deny: "0" });
    }

    const createResponse = await botApi(
      env,
      `/guilds/${encodeURIComponent(guildId)}/channels`,
      {
        method: "POST",
        body: JSON.stringify({
          name: UPDATES_CHANNEL_NAME,
          type: 0,
          topic: "Update announcements from the AI chatbot. Only the bot and the server owner can post here.",
          permission_overwrites: overwrites,
        }),
      },
    );
    if (!createResponse.ok) {
      throw new Error(
        `Could not create ${UPDATES_CHANNEL_NAME}: ${await createResponse.text()}`,
      );
    }
    channel = (await createResponse.json()) as DiscordChannel;
    created = true;
  }

  await env.DB.prepare(
    `INSERT INTO guild_updates (guild_id, channel_id, opted_in, updated_at)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       updated_at = excluded.updated_at`,
  )
    .bind(guildId, channel.id, Date.now())
    .run();

  return {
    guildId,
    channelId: channel.id,
    optedIn: false,
    created,
  };
}

export async function setUpdatesOptIn(
  env: Env,
  guildId: string,
  optedIn: boolean,
): Promise<UpdatesChannelConfig> {
  const channel = await ensureUpdatesChannel(env, guildId);
  await env.DB.prepare(
    `UPDATE guild_updates SET opted_in = ?, updated_at = ? WHERE guild_id = ?`,
  )
    .bind(optedIn ? 1 : 0, Date.now(), guildId)
    .run();
  return { ...channel, optedIn };
}

export interface BroadcastTarget {
  guildId: string;
  channelId: string;
}

export async function listOptedInTargets(
  env: Env,
): Promise<BroadcastTarget[]> {
  const result = await env.DB.prepare(
    `SELECT guild_id, channel_id FROM guild_updates WHERE opted_in = 1`,
  )
    .all<{ guild_id: string; channel_id: string }>();
  return (result.results ?? []).map((row) => ({
    guildId: row.guild_id,
    channelId: row.channel_id,
  }));
}

/**
 * Sends an update announcement to every server that has opted in.
 * Opted-in servers get the @everyone ping; nothing is sent to the rest.
 */
export async function broadcastUpdate(
  env: Env,
  message: string,
): Promise<{ sent: number; failed: number }> {
  const targets = await listOptedInTargets(env);
  let sent = 0;
  let failed = 0;

  const text = `📌 **AI chatbot update**\n${message.trim()}`;
  for (const target of targets) {
    try {
      const response = await botApi(
        env,
        `/channels/${encodeURIComponent(target.channelId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content: `${text}\n\n@everyone`,
            allowed_mentions: { parse: ["everyone"] },
          }),
        },
      );
      if (response.ok) {
        sent++;
      } else {
        // A deleted channel or missing permissions should not break the rest.
        failed++;
      }
    } catch {
      failed++;
    }
  }

  await saveLatestUpdate(env, message);
  return { sent, failed };
}

export async function saveLatestUpdate(
  env: Env,
  message: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO global_updates (id, latest_message, posted_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       latest_message = excluded.latest_message,
       posted_at = excluded.posted_at`,
  )
    .bind(message.slice(0, 1800), Date.now())
    .run();
}
