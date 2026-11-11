import type { Env } from "../env";
import { splitMessage } from "./api";

const DISCORD_API = "https://discord.com/api/v10";

export interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface BotChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

export class DiscordRestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordRestError";
  }
}

function botToken(env: Env): string {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new DiscordRestError(500, "DISCORD_BOT_TOKEN is not configured");
  }
  return env.DISCORD_BOT_TOKEN;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function botApi(
  env: Env,
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bot ${botToken(env)}`);
  if (!headers.has("content-type") && init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 429 && attempt < 3) {
    const retry = (await response
      .clone()
      .json()
      .catch(() => null)) as { retry_after?: number } | null;
    await sleep(Math.min(5000, Math.max(250, (retry?.retry_after ?? 1) * 1000)));
    return botApi(env, path, init, attempt + 1);
  }

  return response;
}

export async function listBotGuilds(env: Env): Promise<BotGuild[]> {
  const response = await botApi(env, "/users/@me/guilds");
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not list bot guilds: ${await response.text()}`,
    );
  }
  return (await response.json()) as BotGuild[];
}

export async function listGuildChannels(
  env: Env,
  guildId: string,
): Promise<BotChannel[]> {
  const response = await botApi(
    env,
    `/guilds/${encodeURIComponent(guildId)}/channels`,
  );
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not list guild channels: ${await response.text()}`,
    );
  }
  return (await response.json()) as BotChannel[];
}

export async function sendChannelMessage(
  env: Env,
  channelId: string,
  text: string,
): Promise<{ id: string }> {
  let firstId = "";

  for (const chunk of splitMessage(text)) {
    const response = await botApi(
      env,
      `/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: chunk,
          allowed_mentions: { parse: [] },
        }),
      },
    );

    if (!response.ok) {
      throw new DiscordRestError(
        response.status,
        `Could not send channel message: ${await response.text()}`,
      );
    }

    if (!firstId) {
      const message = (await response.json().catch(() => null)) as {
        id?: string;
      } | null;
      firstId = message?.id ?? "";
    }
  }

  return { id: firstId };
}

export async function reactToMessage(
  env: Env,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const encoded = encodeURIComponent(emoji);
  const response = await botApi(
    env,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encoded}/%40me`,
    { method: "PUT" },
  );
  if (!response.ok && response.status !== 204) {
    throw new DiscordRestError(
      response.status,
      `Could not react: ${await response.text()}`,
    );
  }
}

export async function editChannelMessage(
  env: Env,
  channelId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const response = await botApi(
    env,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content: text,
        allowed_mentions: { parse: [] },
      }),
    },
  );

  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not edit channel message: ${await response.text()}`,
    );
  }
}


export async function deleteChannelMessage(
  env: Env,
  channelId: string,
  messageId: string,
): Promise<void> {
  const response = await botApi(
    env,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 204) {
    throw new DiscordRestError(
      response.status,
      `Could not delete message: ${await response.text()}`,
    );
  }
}

export async function getGuildBasics(
  env: Env,
  guildId: string,
): Promise<{ name?: string; member_count?: number; timer?: unknown }> {
  const response = await botApi(env, `/guilds/${guildId}?with_counts=true`);
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not load the server: ${await response.text()}`,
    );
  }
  return (await response.json()) as { name?: string; member_count?: number };
}

// ---- Per-server identity webhooks -----------------------------------------
// Discord bots have one global username/avatar. To give the bot a per-server
// name + avatar, replies in that server are sent through a dedicated webhook
// whose profile is customized for the guild.

const IDENTITY_WEBHOOK_NAME = "ai-identity";

export interface IdentityWebhook {
  id: string;
  token: string;
  name?: string;
  avatar?: string;
}

export async function getIdentityWebhook(
  env: Env,
  channelId: string,
  displayName: string,
  avatarDataUrl?: string,
): Promise<IdentityWebhook> {
  const channelPath = `/channels/${encodeURIComponent(channelId)}`;

  const listResponse = await botApi(env, `${channelPath}/webhooks`);
  if (!listResponse.ok) {
    throw new DiscordRestError(
      listResponse.status,
      `Could not list webhooks: ${await listResponse.text()}`,
    );
  }
  const webhooks = (await listResponse.json()) as Array<{
    id?: string;
    name?: string | null;
    token?: string | null;
    user?: { id?: string };
  }>;

  // The bot's own webhook in this channel, created on first use. Matching on
  // ownership instead of the name keeps renames from spawning new webhooks.
  const botId = env.DISCORD_CLIENT_ID;
  let webhook = webhooks.find(
    (item) => item.user?.id && botId && item.user.id === botId,
  )
    ?? webhooks.find((item) => item.name === IDENTITY_WEBHOOK_NAME);
  if (!webhook || !webhook.id) {
    const createResponse = await botApi(env, `${channelPath}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ name: IDENTITY_WEBHOOK_NAME }),
    });
    if (!createResponse.ok) {
      throw new DiscordRestError(
        createResponse.status,
        `Could not create identity webhook: ${await createResponse.text()}`,
      );
    }
    webhook = (await createResponse.json()) as { id?: string };
  }

  const id = webhook?.id ?? "";
  if (!id) {
    throw new DiscordRestError(500, "Webhook id missing");
  }

  const patch: Record<string, unknown> = {
    name: displayName || IDENTITY_WEBHOOK_NAME,
  };
  if (avatarDataUrl !== undefined) {
    patch.avatar = avatarDataUrl || null;
  }
  const patchResponse = await botApi(env, `/webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!patchResponse.ok) {
    throw new DiscordRestError(
      patchResponse.status,
      `Could not customize webhook identity: ${await patchResponse.text()}`,
    );
  }
  const patched = (await patchResponse.json()) as { token?: string | null };
  if (!patched.token) {
    throw new DiscordRestError(500, "Webhook token missing");
  }

  return { id, token: patched.token };
}

export interface OutgoingFile {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}

export async function sendChannelAttachment(
  env: Env,
  channelId: string,
  content: string,
  files: OutgoingFile[],
): Promise<{ id: string }> {
  const form = new FormData();
  form.append(
    "payload_json",
    new Blob(
      [
        JSON.stringify({
          content: content.slice(0, 1900),
          allowed_mentions: { parse: [] },
          attachments: files.map((file, index) => ({
            id: index,
            filename: file.filename,
          })),
        }),
      ],
      { type: "application/json" },
    ),
  );
  files.forEach((file, index) => {
    const view = new Uint8Array(file.bytes);
    form.append(
      `files[${index}]`,
      new Blob([view], { type: file.contentType || "application/octet-stream" }),
      file.filename,
    );
  });
  const response = await botApi(
    env,
    `/channels/${encodeURIComponent(channelId)}/messages`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not post attachment: ${await response.text()}`,
    );
  }
  const message = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  return { id: message?.id ?? "" };
}

export async function sendWebhookAttachment(
  env: Env,
  webhook: IdentityWebhook,
  content: string,
  files: OutgoingFile[],
): Promise<{ id: string }> {
  const form = new FormData();
  form.append(
    "payload_json",
    new Blob(
      [
        JSON.stringify({
          content: content.slice(0, 1900),
          username: webhook.name,
          avatar_url: webhook.avatar || undefined,
          attachments: files.map((file, index) => ({
            id: index,
            filename: file.filename,
          })),
        }),
      ],
      { type: "application/json" },
    ),
  );
  files.forEach((file, index) => {
    const view = new Uint8Array(file.bytes);
    form.append(
      `files[${index}]`,
      new Blob([view], { type: file.contentType || "application/octet-stream" }),
      file.filename,
    );
  });
  const response = await fetch(
    `${DISCORD_API}/webhooks/${encodeURIComponent(webhook.id)}/${encodeURIComponent(webhook.token)}?wait=true`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not post webhook attachment: ${await response.text()}`,
    );
  }
  const message = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  return { id: message?.id ?? "" };
}

export async function sendWebhookMessage(
  env: Env,
  webhook: IdentityWebhook,
  content: string,
): Promise<{ id: string }> {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${encodeURIComponent(webhook.id)}/${encodeURIComponent(webhook.token)}?wait=true`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not send webhook message: ${await response.text()}`,
    );
  }
  const message = (await response.json()) as { id?: string };
  return { id: message.id ?? "" };
}

export async function editWebhookMessage(
  env: Env,
  webhook: IdentityWebhook,
  messageId: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${encodeURIComponent(webhook.id)}/${encodeURIComponent(webhook.token)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) {
    throw new DiscordRestError(
      response.status,
      `Could not edit webhook message: ${await response.text()}`,
    );
  }
}
