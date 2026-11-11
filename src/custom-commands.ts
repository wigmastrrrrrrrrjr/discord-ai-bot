import { encryptText } from "./crypto";
import { botApi } from "./discord/rest";
import type { Env } from "./env";
import { decryptStoredText } from "./guild-config";

interface CommandRow {
  guild_id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface GuildCommand {
  guildId: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GuildCommandInput {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

const MAX_DESCRIPTION = 100;
const MAX_PROMPT = 8000;

export function normalizeCommandName(input: string): string {
  const name = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 32);
  if (!name || !/^[-_\p{L}\p{N}]{1,32}$/u.test(name)) {
    throw new Error(
      "Command name must be 1-32 lowercase letters, numbers, hyphens, or underscores",
    );
  }
  return name;
}

async function toGuildCommand(
  env: Env,
  row: CommandRow,
): Promise<GuildCommand> {
  return {
    guildId: row.guild_id,
    name: row.name,
    description: (await decryptStoredText(env, row.description)) ?? "",
    prompt: (await decryptStoredText(env, row.prompt)) ?? "",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listGuildCommands(
  env: Env,
  guildId: string,
): Promise<GuildCommand[]> {
  const result = await env.DB.prepare(
    `SELECT guild_id, name, description, prompt, enabled, created_at, updated_at
       FROM guild_commands
      WHERE guild_id = ?
      ORDER BY name`,
  )
    .bind(guildId)
    .all<CommandRow>();

  const commands: GuildCommand[] = [];
  for (const row of result.results) {
    commands.push(await toGuildCommand(env, row));
  }
  return commands;
}

export async function getGuildCommand(
  env: Env,
  guildId: string,
  name: string,
): Promise<GuildCommand | null> {
  const row = await env.DB.prepare(
    `SELECT guild_id, name, description, prompt, enabled, created_at, updated_at
       FROM guild_commands
      WHERE guild_id = ? AND name = ?`,
  )
    .bind(guildId, name)
    .first<CommandRow>();

  return row ? toGuildCommand(env, row) : null;
}

export async function saveGuildCommand(
  env: Env,
  guildId: string,
  input: GuildCommandInput,
): Promise<GuildCommand> {
  const name = normalizeCommandName(input.name);
  const description = input.description.trim();
  const prompt = input.prompt.trim();

  if (!description) throw new Error("Command description is required");
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(
      `Command description is too long (max ${MAX_DESCRIPTION} characters)`,
    );
  }
  if (!prompt) throw new Error("Command prompt is required");
  if (prompt.length > MAX_PROMPT) {
    throw new Error(`Command prompt is too long (max ${MAX_PROMPT} characters)`);
  }

  const now = Date.now();
  const encryptedDescription = await encryptText(env, description);
  const encryptedPrompt = await encryptText(env, prompt);

  await env.DB.prepare(
    `INSERT INTO guild_commands
       (guild_id, name, description, prompt, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, name) DO UPDATE SET
       description = excluded.description,
       prompt = excluded.prompt,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      name,
      encryptedDescription,
      encryptedPrompt,
      input.enabled ? 1 : 0,
      now,
      now,
    )
    .run();

  const saved = await getGuildCommand(env, guildId, name);
  if (!saved) throw new Error("Could not save command");
  return saved;
}

export async function deleteGuildCommand(
  env: Env,
  guildId: string,
  name: string,
): Promise<boolean> {
  const normalized = normalizeCommandName(name);
  const result = await env.DB.prepare(
    `DELETE FROM guild_commands WHERE guild_id = ? AND name = ?`,
  )
    .bind(guildId, normalized)
    .run();
  return Boolean(result.meta.changes);
}

export async function syncGuildCommands(
  env: Env,
  guildId: string,
): Promise<{ count: number; status: number }> {
  if (!env.DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is not configured");
  }

  const commands = (await listGuildCommands(env, guildId)).filter(
    (command) => command.enabled,
  );
  const payload = commands.map((command) => ({
    name: command.name,
    description:
      command.description.slice(0, MAX_DESCRIPTION) || `Run ${command.name}`,
    type: 1,
    options: [
      {
        type: 3,
        name: "input",
        description: "Input for this command",
        required: false,
        max_length: 2000,
      },
    ],
  }));

  const response = await botApi(
    env,
    `/applications/${encodeURIComponent(env.DISCORD_CLIENT_ID)}/guilds/${encodeURIComponent(guildId)}/commands`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Discord rejected command sync (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }

  return { count: payload.length, status: response.status };
}

function replacePlaceholder(
  template: string,
  name: string,
  value: string,
): string {
  return template
    .replaceAll(`{{${name}}}`, value)
    .replaceAll(`{${name}}`, value);
}

export function renderCommandPrompt(
  template: string,
  values: {
    input: string;
    user: string;
    username: string;
    channel: string;
    command: string;
  },
): string {
  let prompt = template;
  for (const [name, value] of Object.entries(values)) {
    prompt = replacePlaceholder(prompt, name, value);
  }

  const usedInput = template.includes("{input}") || template.includes("{{input}}");
  if (values.input && !usedInput) {
    prompt = `${prompt}\n\nInput: ${values.input}`;
  }

  return prompt.trim();
}
