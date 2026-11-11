import type { Env } from "./env";
import { InteractionResponseType, type Interaction } from "./discord/types";
import { botApi } from "./discord/rest";
import { createManageToken } from "./manage-token";
import { listGuildApiKeys } from "./guild-secrets";
import { listModelChannels } from "./model-channels";
import { runAgent } from "./agent";
import { applyGuildApiKeys } from "./guild-secrets";
import { v2Health, V2_BETA_FOOTER } from "./v2-agent";
import { InteractionStream } from "./discord/stream";
import {
  compactAgentMemory,
  getAgentState,
  setAgentEnabled,
} from "./agent-memory";
import {
  issueBindCode,
  latestTokenForUser,
  sendAgentDm,
} from "./agent-relay";
import {
  clearGithubAuth,
  fetchGithubLogin,
  getGithubAuth,
  migrateUserHistory,
  pollDeviceFlow,
  saveGithubAuth,
  startDeviceFlow,
} from "./github-auth";

interface SubCommandOption {
  name: string;
  description: string;
  type: 1 | 2;
  options?: Array<{ type: 3 | 4 | 5 | 6 | 10; name: string; description: string; required?: boolean; choices?: Array<{ name: string; value: string }> }>;
}

interface CommandDefinition {
  name: string;
  description: string;
  default_member_permissions?: string;
  dm_permission?: boolean;
  options?: Array<
    | SubCommandOption
    | { type: 3 | 4 | 5 | 10; name: string; description: string; required?: boolean; choices?: Array<{ name: string; value: string }> }
  >;
}

export const DEFAULT_COMMANDS: CommandDefinition[] = [
  {
    name: "v2",
    description: "theaichatbot v2 beta test — the agent runs on the owner's real machine.",
    options: [
      { type: 3, name: "prompt", description: "What should v2 do on the machine?", required: true }
    ],
  },
  {
    name: "agent",
    description: "theAIagent — turn on your personal agent in DMs.",
    options: [
      { type: 1, name: "start", description: "Enable agent mode; the agent will talk to you in DMs." },
      { type: 1, name: "stop", description: "Disable agent mode." },
      { type: 1, name: "status", description: "Show agent mode and memory state." },
      { type: 1, name: "compact", description: "Compact the agent memory now." },
      { type: 1, name: "relay", description: "Generate a one-time code that the agentrelay Python app uses to bind your device." },
    ],
  },
  {
    name: "github",
    description: "Connect your GitHub account so the agent's terminal runs commands as you.",
    options: [
      { type: 1, name: "login", description: "Start linking — you'll get a one-time code for github.com/login/device." },
      { type: 1, name: "finish", description: "Finish linking after entering your code." },
      { type: 1, name: "status", description: "Show which GitHub account is linked." },
      { type: 1, name: "logout", description: "Unlink your GitHub account and wipe the token." },
    ],
  },
  { name: "help", description: "Show this bot's built-in commands." },
  { name: "manage", description: "Manage this server's bot.", default_member_permissions: "32", dm_permission: false, options: [
    { type: 1, name: "dashboard", description: "Open this server's bot dashboard." },
    { type: 1, name: "models", description: "List current model channels." },
    { type: 1, name: "keys", description: "List provider API keys." },
    { type: 1, name: "status", description: "Show gateway status." },
    { type: 1, name: "restart", description: "Restart the gateway." },
  ] },
  { name: "models", description: "List the available model channels." },
];

export const DEFAULT_COMMAND_NAMES = new Set(DEFAULT_COMMANDS.map((c) => c.name));

export function isDefaultCommand(name: string | undefined): boolean {
  return Boolean(name && DEFAULT_COMMAND_NAMES.has(name.toLowerCase()));
}

async function registerDefaults(env: Env): Promise<void> {
  if (!env.DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is not configured");
  }
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not configured");
  }
  const body = JSON.stringify(DEFAULT_COMMANDS.map((command) => ({
    name: command.name,
    description: command.description,
    dm_permission: command.dm_permission ?? false,
    default_member_permissions: command.default_member_permissions ?? "0",
  })));

  const response = await fetch(
    `https://discord.com/api/v10/applications/${encodeURIComponent(env.DISCORD_CLIENT_ID)}/commands`,
    {
      method: "PUT",
      headers: {
        "authorization": `Bot ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Could not sync default commands (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
}


function ephemeral(content: string): Response {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content, flags: 64 },
    }),
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function permissionAllows(permissionBits: string, wanted: bigint): boolean {
  try {
    return (BigInt(permissionBits ?? "0") & wanted) === wanted;
  } catch {
    return false;
  }
}

function gatewayStub(env: Env) {
  const namespace = env.GATEWAY as unknown as {
    get(id: string): { fetch(url: string): Promise<Response> };
    idFromName(name: string): string;
  };
  return namespace.get(namespace.idFromName("main"));
}

async function gatewayStatus(env: Env): Promise<{ connected?: boolean; sequence?: number | null; lastEventAt?: number | null; lastError?: string | null }> {
  try {
    const response = await gatewayStub(env).fetch("https://gateway.internal/status");
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return { lastError: error instanceof Error ? error.message : String(error) };
  }
}

async function gatewayRestart(env: Env): Promise<void> {
  const stub = gatewayStub(env);
  await stub.fetch("https://gateway.internal/restart");
}

async function canManageServer(env: Env, interaction: Interaction): Promise<boolean> {
  const member = interaction.member;
  const directPermissions = member?.permissions;
  if (
    permissionAllows(directPermissions ?? "", 0x20n) ||
    permissionAllows(directPermissions ?? "", 0x8n)
  ) {
    return true;
  }

  const roleIds = member?.roles ?? [];
  if (!interaction.guild_id || !roleIds.length) return false;

  const response = await botApi(env, `/guilds/${interaction.guild_id}/roles`);
  if (!response.ok) return false;
  const roles = (await response.json()) as Array<{ id: string; permissions?: string }>;
  const wanted = 0x20n | 0x8n;
  return roles.some(
    (role) =>
      roleIds.includes(role.id) &&
      permissionAllows(role.permissions ?? "", wanted),
  );
}

async function helpResponse(interaction: Interaction): Promise<Response> {
  const username = interaction.member?.user.global_name || interaction.member?.user.username || interaction.user?.global_name || interaction.user?.username || "user";
  return ephemeral(
    `Hello ${username}, here are the built-in commands:
- /help
- /manage dashboard
- /manage models
- /manage keys
- /manage status
- /manage restart`,
  );
}

function manageToken(env: Env, interaction: Interaction): Promise<string | null> {
  if (!interaction.guild_id) return Promise.resolve(null);
  const userId = interaction.member?.user.id ?? interaction.user?.id ?? "";
  if (!userId) return Promise.resolve(null);
  return createManageToken(env, {
    guildId: interaction.guild_id,
    userId,
    guildName: interaction.member?.user.global_name ?? interaction.member?.user.username ?? interaction.user?.global_name ?? interaction.user?.username,
  }).then((token) => token);
}

async function manageDashboardResponse(env: Env, interaction: Interaction, request: Request): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/manage` in a server.");
  const origin = new URL(request.url).origin;
  const token = await manageToken(env, interaction) ?? "";
  const link = `${origin}/dashboard?token=${encodeURIComponent(token)}&guild=${encodeURIComponent(interaction.guild_id)}`;
  return ephemeral(`Manage this server here: ${link}`);
}

async function modelsResponse(env: Env, interaction: Interaction): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/models` in a server.");
  const channels = await listModelChannels(env, interaction.guild_id);
  if (!channels.length) return ephemeral("No model channels are set up yet. Use `/manage dashboard` to add some.");
  const lines: string[] = [];
  for (const row of channels) {
    const state = row.available ? "ready" : (row.lastError ?? "unavailable");
    lines.push(`<#${row.channelId}> - ${row.provider} / ${row.model} (${state})`);
  }
  return ephemeral("Model channels:\n" + lines.join("\n"));
}

async function keysResponse(env: Env, interaction: Interaction): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/manage` in a server.");
  const keys = await listGuildApiKeys(env, interaction.guild_id);
  if (!keys.length) return ephemeral("No provider API keys saved yet. Use `/manage dashboard` to add one.");
  const lines = keys.map((key) => `${key.provider}: updated ${new Date(key.updatedAt * 1000).toISOString()}`);
  return ephemeral("Provider keys:\n" + lines.join("\n"));
}

async function statusResponse(env: Env, interaction: Interaction): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/manage` in a server.");
  const status = await gatewayStatus(env);
  if (status.lastError) return ephemeral(`Gateway status: error (${status.lastError}).`);
  const connected = status.connected ? "connected" : "disconnected";
  return ephemeral(`Gateway status: ${connected}. Sequence: ${status.sequence ?? "n/a"}.`);
}

async function restartResponse(env: Env, interaction: Interaction): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/manage` in a server.");
  await gatewayRestart(env);
  return ephemeral("Gateway restart requested.");
}

async function manageResponse(env: Env, interaction: Interaction, request: Request): Promise<Response> {
  if (!interaction.guild_id) return ephemeral("Use `/manage` in a server.");
  if (!(await canManageServer(env, interaction))) {
    return ephemeral("You need a high-level role such as Manage Server, Manage Roles, Manage Channels, or Administrator to manage this bot.");
  }
  const sub = (interaction.data?.options as Array<{ type: number; name?: string }> | undefined)?.[0]?.name?.toLowerCase();
  switch (sub) {
    case "dashboard":
      return manageDashboardResponse(env, interaction, request);
    case "models":
      return modelsResponse(env, interaction);
    case "keys":
      return keysResponse(env, interaction);
    case "status":
      return statusResponse(env, interaction);
    case "restart":
      return restartResponse(env, interaction);
    default:
      return manageDashboardResponse(env, interaction, request);
  }
}


function interactionUser(interaction: Interaction): { id: string; name: string } {
  const user = interaction.member?.user ?? interaction.user;
  return {
    id: user?.id ?? "",
    name: user?.global_name ?? user?.username ?? "user",
  };
}

async function editInteractionOriginal(
  env: Env,
  interaction: Interaction,
  content: string,
): Promise<void> {
  const appId = env.DISCORD_CLIENT_ID;
  const token = interaction.token;
  if (!appId || !token) return;
  await botApi(
    env,
    `/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/@original`,
    { method: "PATCH", body: JSON.stringify({ content }) },
  ).catch(() => undefined);
}

const DEVICE_FLOW_URL = "https://github.com/login/device";
const FLOW_TTL_MS = 15 * 60 * 1000;

function githubFlowKey(userId: string): string {
  return `github-flow:${userId}`;
}

async function storePendingFlow(
  env: Env,
  userId: string,
  deviceCode: string,
): Promise<void> {
  await env.CONVERSATIONS.put(githubFlowKey(userId), deviceCode, {
    expirationTtl: 900,
  });
}

async function takePendingFlow(
  env: Env,
  userId: string,
): Promise<string | null> {
  const value = await env.CONVERSATIONS.get(githubFlowKey(userId));
  if (!value) return null;
  await env.CONVERSATIONS.delete(githubFlowKey(userId));
  return value;
}

async function finishGithubLink(
  env: Env,
  interaction: Interaction,
  deviceCode: string,
): Promise<void> {
  const user = interactionUser(interaction);
  const result = await pollDeviceFlow(deviceCode).catch(() => null);
  if (!result || result.status === "pending") {
    await editInteractionOriginal(
      env,
      interaction,
      "GitHub linking is not complete yet. Enter the code at " + DEVICE_FLOW_URL + " and run `/github finish` again.",
    );
    return;
  }
  if (result.status !== "done") {
    await editInteractionOriginal(
      env,
      interaction,
      "The link code expired. Run `/github login` to get a fresh one.",
    );
    return;
  }
  const login = (await fetchGithubLogin(result.token).catch(() => null)) ?? "github";
  await saveGithubAuth(env, user.id, result.token, login);
  const moved = await migrateUserHistory(env, user.id).catch(() => 0);
  await editInteractionOriginal(
    env,
    interaction,
    `GitHub linked as **${login}** (${user.name}).\n\n` +
      (moved > 0
        ? `Your past conversation history (${moved} session${moved === 1 ? "" : "s"}) was moved into a new encrypted history that only you can reach.\n`
        : "") +
      `In the agent terminal your GitHub identity is injected fresh per command — it never lives in a shared shell. Run \`gh auth status\` through the agent to try it.`,
  );
}

// Device-flow token storage helper (kept local so the flow code stays readable).
async function githubResponse(
  env: Env,
  interaction: Interaction,
  ctx?: ExecutionContext,
): Promise<Response> {
  const user = interactionUser(interaction);
  if (!user.id) return ephemeral("Could not identify you.");
  const sub = (interaction.data?.options as Array<{ name?: string }> | undefined)?.[0]?.name?.toLowerCase() ?? "status";

  if (sub === "status") {
    const auth = await getGithubAuth(env, user.id).catch(() => null);
    return ephemeral(
      auth
        ? `GitHub linked as **${auth.login}**. Your conversation history lives in your own encrypted namespace, and the agent terminal uses your GitHub identity.`
        : "No GitHub account linked. Run `/github login` to connect one.",
    );
  }

  if (sub === "logout") {
    await clearGithubAuth(env, user.id).catch(() => undefined);
    return ephemeral("GitHub unlinked. The stored token was deleted.");
  }

  if (sub === "finish") {
    const deviceCode = await takePendingFlow(env, user.id).catch(() => null);
    if (!deviceCode) {
      return ephemeral("No pending link. Run `/github login` first.");
    }
    if (ctx) {
      ctx.waitUntil(
        finishGithubLink(env, interaction, deviceCode).catch(() => undefined),
      );
      return ephemeral("Checking GitHub… this message will update in a moment.");
    }
    const result = await pollDeviceFlow(deviceCode).catch(() => null);
    if (!result || result.status !== "done") {
      return ephemeral("Link not complete yet. Enter your code at " + DEVICE_FLOW_URL + ", then run `/github finish` again.");
    }
    const login = (await fetchGithubLogin(result.token).catch(() => null)) ?? "github";
    await saveGithubAuth(env, user.id, result.token, login);
    const moved = await migrateUserHistory(env, user.id).catch(() => 0);
    return ephemeral(
      `GitHub linked as **${login}**.` +
        (moved > 0 ? ` Moved ${moved} conversation session${moved === 1 ? "" : "s"} into your new encrypted history.` : ""),
    );
  }

  // login
  const flow = await startDeviceFlow().catch(() => null);
  if (!flow) {
    return ephemeral("Could not reach GitHub to start linking. Try again shortly.");
  }
  await storePendingFlow(env, user.id, flow.deviceCode).catch(() => undefined);
  return ephemeral(
    `Linking your GitHub — this runs in its own isolated flow, never inside a shared terminal session.\n\n` +
      `1. Open ${DEVICE_FLOW_URL}\n` +
      `2. Enter this one-time code: **${flow.userCode}**\n` +
      `3. Run \`/github finish\` here to complete the link.\n\n` +
      `The code expires in about 15 minutes. Your token is stored encrypted and only used for commands you ask the agent to run.`,
  );
}

export async function runDefaultCommand(env: Env, interaction: Interaction, request: Request, ctx?: ExecutionContext): Promise<Response> {
  const name = interaction.data?.name?.toLowerCase() ?? "";
  if (name === "help") return helpResponse(interaction);
  if (name === "manage") return manageResponse(env, interaction, request);
  if (name === "models") return modelsResponse(env, interaction);
  if (name === "agent") return agentResponse(env, interaction, request);
  if (name === "v2") return v2Response(env, interaction);
  if (name === "github") return githubResponse(env, interaction, ctx);
  return ephemeral("Unknown command. Custom commands are disabled.");
}

export async function ensureDefaultCommands(env: Env): Promise<void> {
  try {
    await registerDefaults(env);
  } catch (error) {
    console.error("default commands registration failed", error);
  }
}

async function agentResponse(
  env: Env,
  interaction: Interaction,
  request: Request,
): Promise<Response> {
  void request;
  const sub = interaction.data?.options?.[0];
  const subName = sub && sub.type === 1 ? sub.name : "status";
  const userObj = interaction.member?.user ?? interaction.user;
  const userId = userObj?.id ?? "";
  if (!userId) return ephemeral("Could not identify the user.");
  const dmOnly = !interaction.guild_id;
  void dmOnly;

  if (subName === "start") {
    await setAgentEnabled(env, userId, true);
    try {
      await sendAgentDm(
        env,
        userId,
        [
          "Agent mode is on. DM me like a task and I'll act on it.",
          "",
          "I keep persistent memory (`agent memory`), manage my own",
          "compaction when close to the context limit, and can run",
          "commands on your real machine once you bind device relay:",
          "`/agent relay` → run `agentrelay bind <code>` in Python.",
        ].join("\n"),
      );
    } catch {
      // DMs may be closed; agent mode is still on.
    }
    return ephemeral(
      "Agent mode **enabled** (Agent V2 beta, bound to change). Open your DMs with me and describe a task.\n-# Agent V1 is getting sunset on June 1st 2027",
    );
  }

  if (subName === "stop") {
    await setAgentEnabled(env, userId, false);
    return ephemeral("Agent mode disabled.");
  }

  if (subName === "compact") {
    const result = await compactAgentMemory(env, userId).catch(() => null);
    if (!result) return ephemeral("Compaction failed — try again in a bit.");
    return ephemeral(
      `Memory compacted: ${result.before} chars → ${result.after} chars.`,
    );
  }

  if (subName === "relay") {
    const code = await issueBindCode(env, userId);
    return ephemeral(
      [
        "One-time bind code (valid 10 minutes):",
        "",
        `**${code}**`,
        "",
        "On your device run:",
        "```",
        `agentrelay bind ${code}`,
        "```",
        "The bridge token lasts 2 hours; refresh is automatic.",
      ].join("\n"),
    );
  }

  const state = await getAgentState(env, userId);
  const token = await latestTokenForUser(env, userId, true);
  return ephemeral(
    [
      state.enabled ? "Agent mode: **on**." : "Agent mode: **off**.",
      `Saved memory: ${state.memory.length} characters.`,
      token
        ? `Relay: last bind ${new Date(token.expiresAt).toISOString()}.`
        : "Relay: never bound. Use `/agent relay` to start.",
    ].join("\n"),
  );
}

async function v2Response(env: Env, interaction: Interaction): Promise<Response> {
  const promptOption = interaction.data?.options?.find(
    (option) => option.name === "prompt",
  );
  const prompt = promptOption?.value == null ? "" : String(promptOption.value).trim();
  if (!prompt) return ephemeral("Tell v2 what to do: use `/v2 prompt:<goal>`.");

  const healthy = await v2Health(env);
  if (!healthy) return ephemeral("v2 agent host is not reachable (tunnel down or token mismatch).");

  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "v2";
  const channelId = interaction.channel_id ?? "";
  const stream = new InteractionStream(interaction, false);
  await stream.start();
  const requestEnv = interaction.guild_id
    ? await applyGuildApiKeys(env, interaction.guild_id)
    : env;

  try {
    const result = await runAgent(requestEnv, {
      scope: `v2/${userId}`,
      userId,
      history: [],
      prompt,
      systemPrompt: [
        "You are theaichatbot v2 (beta) running as a command interface.",
        "You have direct tools (v2_exec, v2_write_file) to act on the owner's real machine.",
        "Behave like an agent: plan briefly, run the commands, verify the results, report.",
        "Keep replies compact. Any beta-test-related note goes only in the footer line.",
      ].join(" "),
      stream: {
        onDelta: (text) => stream.delta(text),
        onReasoning: (text) => stream.reasoning(text),
        onStatus: (status) => stream.setStatus(status),
      },
    });
    await stream.finish(`${result.text}\n\n-# ${V2_BETA_FOOTER}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await stream.fail(`v2 failed: ${text.slice(0, 400)}\n\n-# ${V2_BETA_FOOTER}`);
  }
  void channelId;
  return new Response("", { status: 204 });
}
