import { completeWithModel } from "./ai/router";
import type { Env } from "./env";
import { botApi, listGuildChannels, sendChannelMessage } from "./discord/rest";
import { applyGuildApiKeys } from "./guild-secrets";
import type { FreeModel } from "./model-catalog";
import { PROVIDERS } from "./model-catalog";

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_CHANNELS = 1n << 4n;
export const UNAVAILABLE_MESSAGE =
  "This model is temporarily unavailable at the moment.";
export const AVAILABLE_MESSAGE = "This model is available again.";

export interface ModelChannelRow {
  guildId: string;
  channelId: string;
  provider: string;
  model: string;
  displayName: string;
  available: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface DbRow {
  guild_id: string;
  channel_id: string;
  provider: string;
  model: string;
  display_name: string;
  available: number;
  last_checked_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface DiscordRole {
  id: string;
  name: string;
  permissions?: string;
  position?: number;
}

interface PermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

interface ProvisionResult {
  channelId: string;
  created: boolean;
  row: ModelChannelRow;
}

function toRow(row: DbRow): ModelChannelRow {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    provider: row.provider,
    model: row.model,
    displayName: row.display_name,
    available: Boolean(row.available),
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function providerName(provider: string): string {
  return PROVIDERS[provider as keyof typeof PROVIDERS]?.name ?? provider;
}

function isStaffRole(role: DiscordRole): boolean {
  const permissions = BigInt(role.permissions || "0");
  return (
    (permissions & ADMINISTRATOR) !== 0n ||
    (permissions & MANAGE_CHANNELS) !== 0n ||
    /admin|mod|staff|manager/i.test(role.name)
  );
}

async function listRoles(env: Env, guildId: string): Promise<DiscordRole[]> {
  const response = await botApi(env, `/guilds/${guildId}/roles`);
  if (!response.ok) {
    throw new Error(`Could not list roles: ${await response.text()}`);
  }
  return (await response.json()) as DiscordRole[];
}

async function ensureVerifiedRole(
  env: Env,
  guildId: string,
  roles: DiscordRole[],
): Promise<DiscordRole> {
  const existing = roles.find((role) => role.name === "Verified");
  if (existing) return existing;

  const response = await botApi(env, `/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify({
      name: "Verified",
      color: 0x57f287,
      hoist: false,
      mentionable: false,
      permissions: "0",
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create Verified role: ${await response.text()}`);
  }
  const role = (await response.json()) as DiscordRole;
  roles.push(role);
  return role;
}

function baseOverwrites(
  guildId: string,
  everyoneId: string,
  verifiedRoleId: string,
  staffRoleIds: string[],
  botId: string | undefined,
  locked: boolean,
): PermissionOverwrite[] {
  const view = VIEW_CHANNEL.toString();
  const viewSend = (VIEW_CHANNEL | SEND_MESSAGES).toString();
  const denyAll = (VIEW_CHANNEL | SEND_MESSAGES).toString();
  const sendDeny = SEND_MESSAGES.toString();

  const overwrites: PermissionOverwrite[] = [
    {
      id: everyoneId,
      type: 0,
      allow: "0",
      deny: locked ? denyAll : view,
    },
    {
      id: verifiedRoleId,
      type: 0,
      allow: locked ? view : viewSend,
      deny: locked ? sendDeny : "0",
    },
  ];

  for (const roleId of staffRoleIds) {
    if (roleId === verifiedRoleId) continue;
    overwrites.push({
      id: roleId,
      type: 0,
      allow: locked ? view : viewSend,
      deny: locked ? sendDeny : "0",
    });
  }

  if (botId) {
    overwrites.push({
      id: botId,
      type: 1,
      allow: viewSend,
      deny: "0",
    });
  }

  return overwrites;
}

async function ensureCategory(
  env: Env,
  guildId: string,
  name: string,
  overwrites: PermissionOverwrite[],
): Promise<string> {
  const channels = await listGuildChannels(env, guildId);
  const existing = channels.find(
    (channel) => channel.type === 4 && channel.name === name,
  );
  if (existing) return existing.id;

  const response = await botApi(env, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 4,
      permission_overwrites: overwrites,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create category: ${await response.text()}`);
  }
  const created = (await response.json()) as { id: string };
  return created.id;
}

async function uniqueChannelName(
  env: Env,
  guildId: string,
  parentId: string,
  base: string,
  provider: string,
): Promise<string> {
  const channels = await listGuildChannels(env, guildId);
  const names = new Set(
    channels
      .filter((channel) => channel.parent_id === parentId)
      .map((channel) => channel.name),
  );
  let candidate = base || slugify(provider);
  if (names.has(candidate)) candidate = `${slugify(provider)}-${candidate}`;
  let suffix = 2;
  while (names.has(candidate)) {
    candidate = `${base}-${suffix}`.slice(0, 100);
    suffix += 1;
  }
  return candidate.slice(0, 100);
}

export async function listModelChannels(
  env: Env,
  guildId: string,
): Promise<ModelChannelRow[]> {
  const result = await env.DB.prepare(
    `SELECT guild_id, channel_id, provider, model, display_name, available,
            last_checked_at, last_error, created_at, updated_at
       FROM model_channels
      WHERE guild_id = ?
      ORDER BY provider ASC, display_name ASC`,
  )
    .bind(guildId)
    .all<DbRow>();
  return (result.results ?? []).map(toRow);
}

export async function getModelChannelForChannel(
  env: Env,
  guildId: string,
  channelId: string,
): Promise<ModelChannelRow | null> {
  const row = await env.DB.prepare(
    `SELECT guild_id, channel_id, provider, model, display_name, available,
            last_checked_at, last_error, created_at, updated_at
       FROM model_channels
      WHERE guild_id = ? AND channel_id = ?`,
  )
    .bind(guildId, channelId)
    .first<DbRow>();
  return row ? toRow(row) : null;
}

export async function createModelChannel(
  env: Env,
  guildId: string,
  model: FreeModel,
): Promise<ProvisionResult> {
  if (!env.DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is required to create model channels");
  }

  const existing = await env.DB.prepare(
    `SELECT guild_id, channel_id, provider, model, display_name, available,
            last_checked_at, last_error, created_at, updated_at
       FROM model_channels
      WHERE guild_id = ? AND provider = ? AND model = ?`,
  )
    .bind(guildId, model.provider, model.id)
    .first<DbRow>();
  if (existing) {
    const channels = await listGuildChannels(env, guildId);
    if (channels.some((channel) => channel.id === existing.channel_id)) {
      return { channelId: existing.channel_id, created: false, row: toRow(existing) };
    }
  }

  const guildResponse = await botApi(env, `/guilds/${guildId}`);
  if (!guildResponse.ok) {
    throw new Error(`Could not load guild: ${await guildResponse.text()}`);
  }
  const guild = (await guildResponse.json()) as { id: string };
  const everyoneId = guild.id;
  const roles = await listRoles(env, guildId);
  const verifiedRole = await ensureVerifiedRole(env, guildId, roles);
  const staffRoleIds = roles.filter(isStaffRole).map((role) => role.id);
  const overwrites = baseOverwrites(
    guildId,
    everyoneId,
    verifiedRole.id,
    staffRoleIds,
    env.DISCORD_CLIENT_ID,
    false,
  );

  const categoryName = `🤖 ${providerName(model.provider)}`;
  const categoryId = await ensureCategory(
    env,
    guildId,
    categoryName,
    overwrites,
  );
  const name = await uniqueChannelName(
    env,
    guildId,
    categoryId,
    slugify(model.name) || slugify(model.id),
    model.provider,
  );

  const response = await botApi(env, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 0,
      parent_id: categoryId,
      topic: `Free model: ${model.name} (${model.provider}). Messages here go directly to this model.`,
      permission_overwrites: overwrites,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not create model channel: ${await response.text()}`);
  }
  const channel = (await response.json()) as { id: string; name: string };
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO model_channels
       (guild_id, channel_id, provider, model, display_name, available,
        last_checked_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)
     ON CONFLICT(guild_id, provider, model) DO UPDATE SET
       channel_id = excluded.channel_id,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      channel.id,
      model.provider,
      model.id,
      model.name,
      now,
      now,
    )
    .run();

  const row = await getModelChannelForChannel(env, guildId, channel.id);
  if (!row) throw new Error("Model channel was created but not saved");

  return { channelId: channel.id, created: true, row };
}

export async function deleteModelChannel(
  env: Env,
  guildId: string,
  channelId: string,
): Promise<void> {
  const response = await botApi(env, `/channels/${channelId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not delete channel: ${await response.text()}`);
  }
  await env.DB.prepare(
    `DELETE FROM model_channels WHERE guild_id = ? AND channel_id = ?`,
  )
    .bind(guildId, channelId)
    .run();
}

export async function lockModelChannel(
  env: Env,
  row: ModelChannelRow,
  reason: string,
): Promise<boolean> {
  const wasAvailable = row.available;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE model_channels
        SET available = 0, last_checked_at = ?, last_error = ?, updated_at = ?
      WHERE guild_id = ? AND channel_id = ?`,
  )
    .bind(now, reason.slice(0, 500), now, row.guildId, row.channelId)
    .run();

  if (!env.DISCORD_CLIENT_ID) return wasAvailable;
  const roles = await listRoles(env, row.guildId);
  const verifiedRole = roles.find((role) => role.name === "Verified");
  if (!verifiedRole) return wasAvailable;
  const staffRoleIds = roles.filter(isStaffRole).map((role) => role.id);
  const overwrites = baseOverwrites(
    row.guildId,
    row.guildId,
    verifiedRole.id,
    staffRoleIds,
    env.DISCORD_CLIENT_ID,
    true,
  );
  await botApi(env, `/channels/${row.channelId}`, {
    method: "PATCH",
    body: JSON.stringify({
      permission_overwrites: overwrites,
      topic: `This model is temporarily unavailable at the moment. Last error: ${reason.slice(0, 120)}`,
    }),
  });
  return wasAvailable;
}

export async function unlockModelChannel(
  env: Env,
  row: ModelChannelRow,
): Promise<boolean> {
  const wasLocked = !row.available;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE model_channels
        SET available = 1, last_checked_at = ?, last_error = NULL, updated_at = ?
      WHERE guild_id = ? AND channel_id = ?`,
  )
    .bind(now, now, row.guildId, row.channelId)
    .run();

  if (!env.DISCORD_CLIENT_ID) return wasLocked;
  const roles = await listRoles(env, row.guildId);
  const verifiedRole = roles.find((role) => role.name === "Verified");
  if (!verifiedRole) return wasLocked;
  const staffRoleIds = roles.filter(isStaffRole).map((role) => role.id);
  const overwrites = baseOverwrites(
    row.guildId,
    row.guildId,
    verifiedRole.id,
    staffRoleIds,
    env.DISCORD_CLIENT_ID,
    false,
  );
  await botApi(env, `/channels/${row.channelId}`, {
    method: "PATCH",
    body: JSON.stringify({
      permission_overwrites: overwrites,
      topic: `Free model: ${row.displayName} (${row.provider}). Messages here go directly to this model.`,
    }),
  });
  return wasLocked;
}

export async function checkModelChannel(
  env: Env,
  row: ModelChannelRow,
  options: { notify?: boolean } = {},
): Promise<{ available: boolean; error?: string }> {
  const scoped = await applyGuildApiKeys(env, row.guildId);
  try {
    await completeWithModel(scoped, row.provider, row.model, {
      messages: [
        {
          role: "user",
          content: "Reply with exactly: OK",
        },
      ],
      maxTokens: 16,
      temperature: 0,
    });
    const wasLocked = await unlockModelChannel(scoped, row);
    if (wasLocked && options.notify) {
      await sendChannelMessage(
        scoped,
        row.channelId,
        AVAILABLE_MESSAGE,
      ).catch(() => undefined);
    }
    return { available: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wasAvailable = await lockModelChannel(scoped, row, message);
    if (wasAvailable && options.notify) {
      await sendChannelMessage(
        scoped,
        row.channelId,
        UNAVAILABLE_MESSAGE,
      ).catch(() => undefined);
    }
    return { available: false, error: message };
  }
}

export async function checkLockedModelChannels(
  env: Env,
  limit = 10,
): Promise<Array<{ channelId: string; available: boolean; error?: string }>> {
  const result = await env.DB.prepare(
    `SELECT guild_id, channel_id, provider, model, display_name, available,
            last_checked_at, last_error, created_at, updated_at
       FROM model_channels
      WHERE available = 0
      ORDER BY last_checked_at ASC
      LIMIT ?`,
  )
    .bind(limit)
    .all<DbRow>();

  const rows = (result.results ?? []).map(toRow);
  const outcomes: Array<{
    channelId: string;
    available: boolean;
    error?: string;
  }> = [];

  for (const row of rows) {
    const outcome = await checkModelChannel(env, row, { notify: true }).catch(
      (error) => ({
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    outcomes.push({ channelId: row.channelId, ...outcome });
  }
  return outcomes;
}

export async function provisionModelChannels(
  env: Env,
  guildId: string,
  models: FreeModel[],
  offset = 0,
  limit = 6,
): Promise<{
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ model: string; error: string }>;
  nextOffset: number | null;
}> {
  const slice = models.slice(offset, offset + limit);
  let created = 0;
  let skipped = 0;
  const errors: Array<{ model: string; error: string }> = [];

  for (const model of slice) {
    try {
      const result = await createModelChannel(env, guildId, model);
      if (result.created) created += 1;
      else skipped += 1;
    } catch (error) {
      errors.push({
        model: `${model.provider}/${model.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextOffset =
    offset + slice.length < models.length ? offset + slice.length : null;
  return { total: models.length, created, skipped, errors, nextOffset };
}
