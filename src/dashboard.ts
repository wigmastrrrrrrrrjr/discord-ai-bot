import { executeTool } from "./ai/tools";
import { getServiceBinding } from "./ai/providers/openai-compatible";
import { jsonResponse } from "./discord/api";
import {
  getGuildBasics,
  sendChannelMessage,
} from "./discord/rest";
import {
  listSessions as listWebAgentSessions,
  loadSession as loadWebAgentSession,
} from "./web-agent-store";
import {
  startGoogleAuth,
  finishGoogleAuth,
  webSessionLogout,
} from "./web-agent-auth";
import { readManageToken } from "./manage-token";
import { listUserBans, unbanUser } from "./tos-moderation";
import {
  DiscordRestError,
  botApi,
  listBotGuilds,
  listGuildChannels,
} from "./discord/rest";
import { WEB_AGENT_HTML } from "./web-agent-page";
import { OWNER_HTML } from "./owner-page";
import { handleOwnerApi, isOwnerRequest } from "./owner-api";
import { LANDING_HTML } from "./landing-page";
import { DASHBOARD_HTML } from "./dashboard-page";
import { completeWithFallback } from "./ai/router";
import { v2Health } from "./v2-agent";
import type { Env } from "./env";
import {
  applyGuildApiKeys,
  deleteGuildApiKey,
  isKeyProvider,
  listGuildApiKeys,
  saveGuildApiKey,
} from "./guild-secrets";
import {
  PROVIDERS,
  isProviderId,
  loadFreeModels,
  type FreeModel,
  type ProviderId,
} from "./model-catalog";
import {
  checkModelChannel,
  createModelChannel,
  deleteModelChannel,
  listModelChannels,
  provisionModelChannels,
} from "./model-channels";
import {
  deleteGuildCommand,
  listGuildCommands,
  normalizeCommandName,
  saveGuildCommand,
  syncGuildCommands,
} from "./custom-commands";
import { decryptStoredText } from "./guild-config";
import {
  clearEvents,
  listEvents,
  loadAutomod,
  loadWelcome,
  logEvent,
  saveAutomod,
  saveWelcome,
} from "./guild-features";
import {
  resolveBindCode,
  refreshToken,
  relayCommandResult,
  nextPendingCommand,
  tokenStatus,
} from "./agent-relay";
import {
  broadcastUpdate,
  ensureUpdatesChannel,
  listOptedInTargets,
  saveLatestUpdate,
  setUpdatesOptIn,
  UPDATES_CHANNEL_NAME,
} from "./updates-channel";
import { encryptText } from "./crypto";
import {
  getBotProfile,
  getBotProfileCached,
  imageToDataUrl,
  setGuildBotNickname,
  updateBotProfile,
} from "./bot-profile";
import {
  loadGuildConfig,
  saveGuildPersona,
  saveRespondBots,
} from "./guild-config";
import {
  deleteState,
  loadState,
  saveState,
} from "./db-state";
import {
  clientIp,
  getIdentity,
  isBannedIdentity,
  isVerified,
  markVerified,
  recordBannedIdentity,
  sha256Hex,
  storeIdentity,
} from "./verify-service";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_COOKIE = "discord_ai_session";
const STATE_COOKIE = "discord_ai_oauth_state";
const SESSION_TTL = 7 * 24 * 60 * 60;
const OAUTH_STATE_TTL = 10 * 60;
const MANAGE_GUILD = 0x20n;

interface ManagedGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

interface Session {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  guilds: ManagedGuild[];
  createdAt: number;
}

interface GuildConfigRow {
  guild_id: string;
  guild_name: string | null;
  channel_id: string | null;
  auto_reply: number;
  auto_community: number;
  system_prompt: string | null;
  updated_at: number;
}

interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function cookie(
  name: string,
  value: string,
  maxAge: number,
  path = "/",
): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

function errorRedirect(message: string): Response {
  return redirect(
    `/dashboard?error=${encodeURIComponent(message)}`,
    [cookie(STATE_COOKIE, "", 0)],
  );
}

function apiError(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function isSameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("origin") === url.origin;
}

export async function loadSession(
  env: Env,
  request: Request,
): Promise<{ session: Session; token: string } | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const state = await loadState(env, "session", token);
  if (!state) return null;
  try {
    const session = JSON.parse(state.payload) as Session;
    if (!session.userId || !Array.isArray(session.guilds)) return null;
    return { session, token };
  } catch {
    return null;
  }
}

async function requireSession(
  env: Env,
  request: Request,
): Promise<{ session: Session; token: string } | Response> {
  const found = await loadSession(env, request);
  if (!found) return apiError("Not logged in", 401);
  return found;
}

function canManage(session: Session, guildId: string): boolean {
  return session.guilds.some((guild) => guild.id === guildId);
}

function gatewayStub(env: Env): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName("main"));
}

async function gatewayStatus(env: Env): Promise<Record<string, unknown>> {
  try {
    const response = await gatewayStub(env).fetch(
      "https://gateway.internal/status",
    );
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      connected: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function gatewayAction(
  env: Env,
  action: "ensure" | "restart",
): Promise<Record<string, unknown>> {
  try {
    const response = await gatewayStub(env).fetch(
      `https://gateway.internal/${action}`,
    );
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      connected: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleManageToken(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const manageToken = url.searchParams.get("token") ?? "";
  const payload = manageToken ? await readManageToken(env, manageToken) : null;
  if (!payload) {
    return redirect("/dashboard?error=" + encodeURIComponent("Manage token was invalid or expired."));
  }
  const userId = payload.userId;
  const session: Session = {
    userId,
    username: payload.guildName ?? "Discord user",
    globalName: payload.guildName ?? "Discord user",
    avatar: null,
    guilds: [
      {
        id: payload.guildId,
        name: payload.guildName ?? "Discord server",
        icon: null,
        owner: true,
        permissions: "8",
      },
    ],
    createdAt: Date.now(),
  };
  const sessionToken = randomToken(32);
  await saveState(env, "session", sessionToken, JSON.stringify(session));
  return redirect("/dashboard", [cookie(SESSION_COOKIE, sessionToken, SESSION_TTL)]);
}

export async function handleDashboard(
  request: Request,
  env: Env,
  url: URL,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(LANDING_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }

  if (request.method === "GET" && url.pathname === "/dashboard") {
    const manageToken = url.searchParams.get("token");
    if (manageToken) return handleManageToken(env, request, url);
    return new Response(DASHBOARD_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (request.method === "GET" && url.pathname === "/auth/discord") {
    return startOAuth(env, url);
  }

  if (request.method === "GET" && url.pathname === "/auth/callback") {
    return finishOAuth(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/auth/logout") {
    return logout(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    return apiSession(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/guilds") {
    return apiGuilds(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/bot/profile") {
    return apiBotProfileGet(env, request);
  }

  if (request.method === "POST" && url.pathname === "/api/bot/profile") {
    return apiError(
      "Global profile editing is disabled — the bot username/avatar apply to every server. Use the per-server appearance panel instead.",
      403,
    );
  }

  if (request.method === "GET" && url.pathname === "/api/bot/persona") {
    return apiBotPersonaGet(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/bot/persona") {
    return apiBotPersonaUpdate(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/server/stats") {
    return apiServerStats(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/server/announce") {
    return apiServerAnnounce(env, request, url);
  }

  if (url.pathname === "/api/server/automod") {
    if (request.method === "GET") return apiServerAutomod(env, request, url);
    if (request.method === "POST") return apiServerAutomod(env, request, url);
  }

  if (url.pathname === "/api/server/updates") {
    if (request.method === "GET") return apiServerUpdates(env, request, url);
    if (request.method === "POST") return apiServerUpdates(env, request, url);
  }

  if (url.pathname === "/api/server/welcome") {
    if (request.method === "GET") return apiServerWelcome(env, request, url);
    if (request.method === "POST") return apiServerWelcome(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/server/log") {
    return apiServerLog(env, request, url);
  }

  if (url.pathname === "/api/debug/cooldowns" && env.BOT_UPDATE_TOKEN && request.headers.get("x-update-token") === env.BOT_UPDATE_TOKEN) {
    const keys = await env.CONVERSATIONS.list({ prefix: "provider-cooldown:" });
    if (request.method === "POST") {
      for (const key of keys.keys) await env.CONVERSATIONS.delete(key.name);
      return jsonResponse({ cleared: keys.keys.map((k) => k.name) });
    }
    const states: Record<string, string> = {};
    for (const key of keys.keys) {
      states[key.name.replace("provider-cooldown:", "")] =
        (await env.CONVERSATIONS.get(key.name)) ?? "";
    }
    return jsonResponse(states);
  }

  if (request.method === "POST" && url.pathname === "/api/debug/complete" && env.BOT_UPDATE_TOKEN && request.headers.get("x-update-token") === env.BOT_UPDATE_TOKEN) {
    let body: { prompt?: unknown } = {};
    try { body = (await request.json()) as typeof body; } catch { return apiError("Invalid JSON"); }
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : "Reply with the single word OK.";
    const started = Date.now();
    try {
      const response = await completeWithFallback(env, {
        messages: [{ role: "user", content: prompt }],
        maxTokens: 60,
        temperature: 0,
      });
      return jsonResponse({
        ok: true,
        provider: response.provider,
        model: response.model,
        ms: Date.now() - started,
        content: response.content.slice(0, 300),
      });
    } catch (error) {
      return jsonResponse({
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/debug/tool") {
    const token = request.headers.get("x-update-token") ?? "";
    const expectedToken = env.BOT_UPDATE_TOKEN ?? "";
    if (!expectedToken || token !== expectedToken) {
      return apiError("Not authorized", 403);
    }
    let dbg: { tool?: unknown; args?: unknown; guildId?: unknown };
    try {
      dbg = (await request.json()) as typeof dbg;
    } catch { return apiError("Invalid JSON"); }
    const toolName = typeof dbg.tool === "string" ? dbg.tool : "";
    if (!["generate_img", "v2_exec", "v2_write_file", "v2_health"].includes(toolName)) {
      return apiError("unsupported tool");
    }
    const guildId = typeof dbg.guildId === "string" ? dbg.guildId : "";
    const args = dbg.args && typeof dbg.args === "object" ? dbg.args as Record<string, unknown> : {};
    const result = toolName === "v2_health"
      ? JSON.stringify({ ok: await v2Health(env) })
      : await executeTool(env, guildId ? `guilds/${guildId}` : "dashboard", {
        id: "debug_" + Date.now(),
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) },
      });
    return new Response(result, { headers: { "content-type": "application/json" } });
  }

  if (request.method === "GET" && url.pathname === "/api/debug/router-check") {
    const out: Record<string, unknown> = {};
    {
      const binding = getServiceBinding(env, "mrouter");
      out["hasBinding"] = Boolean(binding);
      out["envKeys"] = Object.keys(env as unknown as Record<string, unknown>)
        .filter((key) => /MR|AI/i.test(key))
        .join(",");
      if (binding) {
        try {
          const r = await binding.fetch(
            new Request("https://mrouter.csomeone301.workers.dev/health"),
          );
          out["binding-health"] = r.status;
        } catch (e) {
          out["binding-health"] = String(e);
        }
      }
    }
    {
      try {
        out["root-GET"] = (await fetch("https://mrouter.csomeone301.workers.dev/")).status;
      } catch (e) { out["root-GET"] = String(e); }
      try {
        const r = await fetch("https://mrouter.csomeone301.workers.dev/health", { headers: { "user-agent": "curl/8" } });
        out["health-ua"] = r.status;
      } catch (e) { out["health-ua"] = String(e); }
      try {
        const r2 = await fetch("http://mrouter.csomeone301.workers.dev/health", { redirect: "manual" });
        out["health-http"] = r2.status + " loc=" + (r2.headers.get("location") ?? "");
      } catch (e) { out["health-http"] = String(e); }
    }
    for (const [label, target] of [
      ["health", "https://mrouter.csomeone301.workers.dev/health"],
      ["models", "https://mrouter.csomeone301.workers.dev/v1/models"],
      ["images-root", "https://mrouter.csomeone301.workers.dev/images/generations"],
      ["images-v1", "https://mrouter.csomeone301.workers.dev/v1/images/generations"],
    ] as [string, string][]) {
      try {
        const response = await fetch(target);
        out[label] = response.status;
      } catch (error) {
        out[label] = error instanceof Error ? error.message : String(error);
      }
    }
    return jsonResponse(out);
  }

  if (url.pathname === "/api/mrouter/probe") {
    if (request.method === "GET") return apiMrouterProbeList(env, request);
    if (request.method === "POST") return apiMrouterProbeRun(env, request);
  }

  if (url.pathname === "/api/moderation/bans" && request.method === "GET") {
    const auth = await requireSession(env, request);
    if (auth instanceof Response) return auth;
    if (auth.session.userId !== (env.BOT_OWNER_ID ?? "")) {
      return apiError("Only the bot creator can manage bans", 403);
    }
    return jsonResponse({ bans: await listUserBans(env) });
  }

  if (url.pathname === "/api/moderation/unban" && request.method === "POST") {
    const auth = await requireSession(env, request);
    if (auth instanceof Response) return auth;
    if (auth.session.userId !== (env.BOT_OWNER_ID ?? "")) {
      return apiError("Only the bot creator can unban users", 403);
    }
    let body: { userId?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiError("Invalid JSON");
    }
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!/^\d{5,25}$/.test(userId)) return apiError("Invalid user id");
    const removed = await unbanUser(env, userId);
    return jsonResponse({ removed });
  }

  if (url.pathname === "/api/bot/update") {
    if (request.method === "GET") return apiBotUpdatePreview(env, request);
    if (request.method === "POST") return apiBotUpdatePost(env, request);
  }

  if (url.pathname === "/auth/google" && request.method === "GET") {
    return startGoogleAuth(env, request);
  }

  if (url.pathname === "/auth/google/callback" && request.method === "GET") {
    return finishGoogleAuth(env, request);
  }

  if (url.pathname === "/auth/google/logout" && request.method === "GET") {
    return webSessionLogout(env, request);
  }

  if (url.pathname === "/api/web/me" && request.method === "GET") {
    const { loadWebSession } = await import("./web-agent-auth");
    const session = await loadWebSession(env, request);
    if (!session) return apiError("Not logged in", 401);
    return jsonResponse({
      sub: session.sub,
      email: session.email,
      name: session.name,
      picture: session.picture,
    });
  }

  if (url.pathname === "/owner" && request.method === "GET") {
    return new Response(OWNER_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (url.pathname.startsWith("/api/owner/")) {
    return handleOwnerApi(env, request, url);
  }

  if (url.pathname === "/agent" && request.method === "GET") {
    return new Response(WEB_AGENT_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (url.pathname === "/api/web/me2" && request.method === "GET") {
    const { getWebIdentity } = await import("./web-agent-auth");
    const identity = await getWebIdentity(env, request);
    if (!identity) return apiError("Not logged in", 401);
    return jsonResponse({ identity });
  }

  if (url.pathname.startsWith("/api/web/agent/")) {
    const { getWebIdentity } = await import("./web-agent-auth");
    const identity = await getWebIdentity(env, request);
    if (!identity) return apiError("Not logged in", 401);
    try {
      return await handleWebAgentApi(env, request, url, identity, ctx);
    } catch (error) {
      console.error("Web agent API failed", error);
      return apiError(
        `web agent: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }
  if (request.method === "POST" && url.pathname === "/api/agent/test") {
    return apiAgentTest(env, request, url);
  }

  if (url.pathname === "/api/agent/relay") {
    if (request.method === "POST") return apiAgentRelay(env, request);
    return apiError("Use POST /api/agent/relay", 405);
  }

  if (request.method === "GET" && url.pathname === "/api/bots") {
    return apiGuildBots(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/bots/respond") {
    return apiGuildBotsSave(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/channels") {
    return apiChannels(env, request, url);
  }

  if (url.pathname === "/api/config") {
    if (request.method === "GET") return apiGetConfig(env, request, url);
    if (request.method === "POST") return apiSaveConfig(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/gateway/status") {
    return apiGatewayStatus(env, request);
  }

  if (request.method === "POST" && url.pathname === "/api/gateway/restart") {
    return apiGatewayRestart(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/commands/clear") {
    return apiClearCommands(env, request, url);
  }

  if (url.pathname === "/api/keys") {
    if (request.method === "GET") return apiGuildKeysList(env, request, url);
    if (request.method === "POST") return apiGuildKeysSave(env, request, url);
    if (request.method === "DELETE") return apiGuildKeysDelete(env, request, url);
  }

  if (url.pathname === "/api/commands") {
    if (request.method === "GET") return apiGuildCommandsList(env, request, url);
    if (request.method === "POST") return apiGuildCommandsSave(env, request, url);
    if (request.method === "DELETE") return apiGuildCommandsDelete(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/commands/sync") {
    return apiGuildCommandsSync(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/providers") {
    return apiProviders(env, request, url);
  }

  if (request.method === "GET" && url.pathname === "/api/models") {
    return apiModels(env, request, url);
  }

  if (url.pathname === "/api/model-channels") {
    if (request.method === "GET") {
      return apiModelChannelsList(env, request, url);
    }
    if (request.method === "POST") {
      return apiModelChannelsCreate(env, request, url);
    }
    if (request.method === "DELETE") {
      return apiModelChannelsDelete(env, request, url);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/model-channels/check") {
    return apiModelChannelsCheck(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/server/auto-community") {
    return apiAutoCommunity(env, request, url);
  }

  if (url.pathname === "/api/server/state") {
    if (request.method === "GET") return apiServerState(env, request, url);
  }

  if (url.pathname === "/api/server/bot-member") {
    if (request.method === "GET") return apiServerBotMember(env, request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/server/organize") {
    return apiServerOrganize(env, request);
  }

  if (request.method === "POST" && url.pathname === "/api/server/verify-setup") {
    return apiServerVerifySetup(env, request);
  }

  if (request.method === "POST" && url.pathname === "/api/verify/complete") {
    return apiVerifyComplete(env, request);
  }

  return new Response("Not found", { status: 404 });
}

async function startOAuth(env: Env, url: URL): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID) {
    return errorRedirect("DISCORD_CLIENT_ID is not configured");
  }

  const state = randomToken(16);
  const requestedNext = url.searchParams.get("next") || "/dashboard";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard";
  const redirectUri = `${url.origin}/auth/callback`;
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);

  await saveState(env, "state", state, JSON.stringify({ next }));

  return redirect(authorize.toString(), [
    cookie(STATE_COOKIE, state, OAUTH_STATE_TTL),
  ]);
}

async function finishOAuth(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const error = url.searchParams.get("error");
  if (error) return errorRedirect(`Discord login failed: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = getCookie(request, STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    // Stale or mismatched state most often means an old session cookie is
    // lingering around. Log the browser out so the next visit starts a
    // completely fresh OAuth flow instead of failing again.
    const stale = getCookie(request, SESSION_COOKIE);
    const cookies = [cookie(STATE_COOKIE, "", 0), cookie(SESSION_COOKIE, "", 0)];
    if (stale) await deleteState(env, "session", stale).catch(() => undefined);
    return redirect(
      `/auth/discord?error=${encodeURIComponent(
        "Login state was out of date. Please sign in again.",
      )}`,
      cookies,
    );
  }

  const stored = await loadState(env, "state", state);
  if (!stored) return errorRedirect("OAuth state expired");
  const storedState = stored.payload;

  let oauthNext = "/dashboard";
  try {
    const parsed = JSON.parse(storedState) as { next?: unknown };
    if (
      typeof parsed.next === "string" &&
      parsed.next.startsWith("/") &&
      !parsed.next.startsWith("//")
    ) {
      oauthNext = parsed.next;
    }
  } catch {
    // Older state values were stored as "1".
  }

  await deleteState(env, "state", state);

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return errorRedirect(
      "DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is not configured",
    );
  }

  const redirectUri = `${url.origin}/auth/callback`;
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return errorRedirect(
      `Discord token exchange failed (${tokenResponse.status})`,
    );
  }

  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return errorRedirect("Discord returned no token");

  const auth = { authorization: `Bearer ${token.access_token}` };
  const [userResponse, guildsResponse] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, { headers: auth }),
    fetch(`${DISCORD_API}/users/@me/guilds`, { headers: auth }),
  ]);

  if (!userResponse.ok || !guildsResponse.ok) {
    return errorRedirect("Could not load your Discord account");
  }

  const user = (await userResponse.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  const guilds = (await guildsResponse.json()) as OAuthGuild[];

  if (env.DASHBOARD_OWNER_ID && user.id !== env.DASHBOARD_OWNER_ID) {
    return errorRedirect("This dashboard is restricted to its owner");
  }

  const managed: ManagedGuild[] = guilds
    .filter((guild) => {
      if (guild.owner) return true;
      try {
        return (BigInt(guild.permissions ?? "0") & MANAGE_GUILD) === MANAGE_GUILD;
      } catch {
        return false;
      }
    })
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon ?? null,
      owner: Boolean(guild.owner),
      permissions: guild.permissions ?? "0",
    }));

  const session: Session = {
    userId: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    avatar: user.avatar ?? null,
    guilds: managed,
    createdAt: Date.now(),
  };

  const sessionToken = randomToken(32);
  await saveState(env, "session", sessionToken, JSON.stringify(session));

  return redirect(oauthNext, [
    cookie(SESSION_COOKIE, sessionToken, SESSION_TTL),
    cookie(STATE_COOKIE, "", 0),
  ]);
}

async function logout(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await loadSession(env, request);
  if (found) {
    await deleteState(env, "session", found.token);
  }
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function apiSession(env: Env, request: Request): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  return jsonResponse({
    user: {
      id: found.session.userId,
      username: found.session.username,
      globalName: found.session.globalName,
      avatar: found.session.avatar,
    },
    guilds: found.session.guilds,
  });
}

async function apiGuilds(env: Env, request: Request): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let botGuildIds = new Set<string>();
  let botError: string | null = null;

  try {
    const botGuilds = await listBotGuilds(env);
    botGuildIds = new Set(botGuilds.map((guild) => guild.id));
  } catch (error) {
    botError =
      error instanceof DiscordRestError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  }

  return jsonResponse({
    guilds: found.session.guilds.map((guild) => ({
      ...guild,
      installed: botGuildIds.has(guild.id),
    })),
    botError,
  });
}

async function apiServerStats(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  try {
    const info = await getGuildBasics(env, guildId);
    return jsonResponse({
      stats: {
        guildId,
        name: info.name ?? "",
        memberCount: info.member_count ?? null,
      },
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiServerAnnounce(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; channelId?: unknown; text?: unknown; mentionEveryone?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const mentionEveryone = body.mentionEveryone === true;
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (!text) return apiError("Write something to announce");
  if (text.length > 1800) return apiError("Announcements max out at 1800 characters");
  if (!channelId) return apiError("Pick a channel");
  if (mentionEveryone) {
    const roles = await botApi(env, `/guilds/${guildId}/roles`).catch(() => null);
    if (roles?.ok) {
      const list = (await roles.json().catch(() => null)) as Array<{ permissions?: string; name?: string }>;
      const everyone = list?.find((role) => role.name === "@everyone");
      try {
        await botApi(env, `/guilds/${guildId}/members/@me`, {
          method: "PATCH",
          body: JSON.stringify({
            permissions: (BigInt(everyone?.permissions ?? "0") | (1n << 2n) | (1n << 13n)).toString(),
          }),
        });
      } catch {
        return apiError("Discord would not grant @everyone mention rights to the bot");
      }
    }
  }
  await sendChannelMessage(
    env,
    channelId,
    `${mentionEveryone ? "@everyone\n\n" : ""}${text}`,
  );
  await logEvent(env, guildId, "announce", `Announcement posted (${text.slice(0, 80)}…).`);
  return jsonResponse({ sent: true });
}

async function apiServerAutomod(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  if (request.method === "GET") {
    const config = await loadAutomod(env, guildId).catch(() => null);
    return jsonResponse({
      automod: {
        guildId,
        enabled: config?.enabled ?? false,
        bannedWords: (config?.bannedWords ?? []).join(", "),
        notice: config?.notice ?? "",
      },
    });
  }

  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  let body: { guildId?: unknown; enabled?: unknown; bannedWords?: unknown; notice?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  await saveAutomod(env, guildId, {
    enabled: body.enabled === true,
    bannedWords:
      typeof body.bannedWords === "string"
        ? body.bannedWords.split(/[\n,]+/)
        : [],
    notice: typeof body.notice === "string" ? body.notice : "",
  });
  return jsonResponse({ saved: true });
}

async function apiServerWelcome(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  if (request.method === "GET") {
    const config = await loadWelcome(env, guildId).catch(() => null);
    return jsonResponse({
      welcome: {
        guildId,
        channelId: config?.channelId ?? "",
        messageText: config?.messageText ?? "",
        dmEnabled: config?.dmEnabled ?? false,
        dmText: config?.dmText ?? "",
        goodbyeChannelId: config?.goodbyeChannelId ?? "",
        goodbyeText: config?.goodbyeText ?? "",
      },
    });
  }

  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  let body: {
    guildId?: unknown;
    channelId?: unknown;
    messageText?: unknown;
    dmEnabled?: unknown;
    dmText?: unknown;
    goodbyeChannelId?: unknown;
    goodbyeText?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  const str = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  await saveWelcome(env, guildId, {
    channelId: str(body.channelId),
    messageText: str(body.messageText),
    dmEnabled: body.dmEnabled === true,
    dmText: str(body.dmText),
    goodbyeChannelId: str(body.goodbyeChannelId),
    goodbyeText: str(body.goodbyeText),
  });
  return jsonResponse({ saved: true });
}

async function apiServerUpdates(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  if (request.method === "GET") {
    try {
      const config = await ensureUpdatesChannel(env, guildId);
      return jsonResponse({
        updates: {
          guildId,
          channelId: config.channelId ?? "",
          optedIn: config.optedIn,
          created: config.created,
          channelName: UPDATES_CHANNEL_NAME,
        },
      });
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : "Could not open the channel",
        500,
      );
    }
  }

  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  let body: { guildId?: unknown; optedIn?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  if (typeof body.guildId !== "string" || body.guildId !== guildId) {
    return apiError("Guild mismatch");
  }
  try {
    const config = await setUpdatesOptIn(env, guildId, body.optedIn === true);
    return jsonResponse({
      updates: {
        guildId,
        channelId: config.channelId ?? "",
        optedIn: config.optedIn,
      },
    });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Could not update opt-in",
      500,
    );
  }
}

function routerFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const binding = getServiceBinding(env, "mrouter");
  if (binding) {
    return binding.fetch(
      new Request(`https://mrouter.csomeone301.workers.dev${path}`, init),
    );
  }
  return fetch(`https://mrouter.csomeone301.workers.dev${path}`, init);
}

async function apiMrouterProbeList(env: Env, request: Request): Promise<Response> {
  const apiKey = env.MRROUTER_API_KEY ?? "";
  if (!apiKey) return apiError("mrouter key missing", 400);
  const response = await routerFetch(env, "/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return apiError(`HTTP ${response.status}`, 502);
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; provider?: string }>;
  };
  return jsonResponse({
    models: (payload.data ?? []).filter((m) => m.id).map((m) => ({
      id: m.id,
      provider: m.provider ?? "",
    })),
  });
}

async function apiMrouterProbeRun(
  env: Env,
  request: Request,
): Promise<Response> {
  const apiKey = env.MRROUTER_API_KEY ?? "";
  if (!apiKey) return apiError("mrouter key missing", 400);
  if (!isSameOrigin(request, new URL(request.url))) {
    const token = request.headers.get("x-update-token") ?? "";
    const expected = env.BOT_UPDATE_TOKEN ?? "";
    if (!expected || token !== expected) {
      return apiError("Not authorized", 403);
    }
  } else {
    const found = await requireSession(env, request);
    if (found instanceof Response) return found;
  }

  let body: { models?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const requested = Array.isArray(body.models)
    ? body.models.filter((value): value is string => typeof value === "string")
    : [];

  if (!requested.length) {
    const listResponse = await routerFetch(env, "/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const payload = (await listResponse.json()) as {
      data?: Array<{ id?: string }>;
    };
    for (const item of payload.data ?? []) {
      if (item.id) requested.push(item.id);
    }
  }

  const results = [];
  for (const model of requested) {
    const started = Date.now();
    try {
      const call = await routerFetch(env, "/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with OK only." }],
          max_tokens: 200,
        }),
      });
      const payload = (await call.json().catch(() => null)) as {
        error?: string;
        choices?: Array<{ message?: { content?: string } }>;
      } | null;
      const threw = payload === null;
      if (threw) {
        results.push({ model, ok: false, ms: Date.now() - started, reply: "", error: "non-json response (HTTP " + call.status + ")" });
        continue;
      }
      const text = payload?.choices?.[0]?.message?.content ?? "";
      const ok = Boolean(text.trim()) && !payload?.error;
      results.push({
        model,
        ok,
        ms: Date.now() - started,
        reply: text.slice(0, 60),
        error: payload?.error ? String(payload.error).slice(0, 120) : "",
      });
    } catch (error) {
      results.push({
        model,
        ok: false,
        ms: Date.now() - started,
        reply: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return jsonResponse({ results });
}

async function apiBotUpdatePreview(env: Env, request: Request): Promise<Response> {
  // Status preview for the owner: how many servers currently get pings.
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;
  const targets = await listOptedInTargets(env);
  return jsonResponse({ optedInServers: targets.length });
}

async function apiBotUpdatePost(env: Env, request: Request): Promise<Response> {
  if (!isSameOrigin(request, new URL(request.url))) {
    const token = request.headers.get("x-update-token");
    const expected = env.BOT_UPDATE_TOKEN ?? "";
    if (!expected || token !== expected) {
      return apiError("Not authorized to post bot updates", 403);
    }
  } else {
    const found = await requireSession(env, request);
    if (found instanceof Response) return found;
  }

  let body: { message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return apiError("Message is required");

  await saveLatestUpdate(env, message);
  const result = await broadcastUpdate(env, message);
  return jsonResponse(result);
}

async function apiServerLog(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (url.searchParams.get("clear") === "1") {
    if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
    await clearEvents(env, guildId);
    return jsonResponse({ cleared: true });
  }
  return jsonResponse({ events: await listEvents(env, guildId) });
}

async function apiAgentRelay(env: Env, request: Request): Promise<Response> {
  let body: {
    action?: unknown;
    token?: unknown;
    code?: unknown;
    commandId?: unknown;
    output?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const token = typeof body.token === "string" ? body.token : "";

  if (action === "bind") {
    const code = typeof body.code === "string" ? body.code : "";
    if (!code) return apiError("code is required");
    try {
      const outcome = await resolveBindCode(env, code);
      return jsonResponse({
        token: outcome.token,
        expiresAt: outcome.expiresAt,
        ttlMs: outcome.expiresAt - Date.now(),
      });
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : "Bind failed",
        400,
      );
    }
  }

  if (action === "poll") {
    if (!token) return apiError("token is required");
    const status = await tokenStatus(env, token);
    if (!status.valid) return apiError("token invalid or expired", 401);
    const next = await nextPendingCommand(env, token);
    return jsonResponse({
      command: next?.command ?? null,
      commandId: next?.id ?? null,
      ttlMs: status.msLeft,
    });
  }

  if (action === "result") {
    const commandId = typeof body.commandId === "string" ? body.commandId : "";
    const output = typeof body.output === "string" ? body.output : "";
    if (!token || !commandId) return apiError("token and commandId required");
    const ok = await relayCommandResult(env, token, commandId, output);
    return jsonResponse({ accepted: ok });
  }

  if (action === "refresh") {
    if (!token) return apiError("token is required");
    try {
      const created = await refreshToken(env, token);
      return jsonResponse({
        token: created.token,
        expiresAt: created.expiresAt,
        ttlMs: created.expiresAt - Date.now(),
      });
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : "Refresh failed",
        400,
      );
    }
  }

  return apiError("Unknown relay action");
}

async function apiAgentTest(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; prompt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }
  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return apiError("Write something to test");
  if (prompt.length > 2000) return apiError("Keep the test message under 2000 characters");
  if (guildId && !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  const scopedEnv = guildId
    ? await applyGuildApiKeys(env, guildId)
    : env;
  const config = guildId
    ? await loadGuildConfig(env, guildId).catch(() => null)
    : null;
  const requestEnv: Env = {
    ...(scopedEnv as unknown as Record<string, unknown>),
    SYSTEM_PROMPT: composeAgentPrompt(env, config),
  } as unknown as Env;
  void prompt;
  const response = await completeWithFallback(requestEnv, {
    messages: [{ role: "user", content: prompt }],
    maxTokens: 900,
    temperature: 0.8,
  }).catch((error: unknown) => {
    throw new Error(
      error instanceof Error ? error.message : String(error),
    );
  });
  return jsonResponse({
    reply: response.content.trim(),
    provider: response.provider,
    model: response.model,
  });
}

function composeAgentPrompt(
  env: Env,
  config: {
    persona: string | null;
    botNickname: string | null;
    useEmojis: boolean;
    systemPrompt: string | null;
  } | null,
): string {
  const persona = config?.persona?.trim();
  const nickname = config?.botNickname?.trim();
  const useEmojis = config?.useEmojis !== false;
  const parts: string[] = [
    config?.systemPrompt?.trim() || env.SYSTEM_PROMPT || "",
  ].filter(Boolean);
  if (persona) parts.push(`[Your character] ${persona}`);
  if (nickname) parts.push(`You go by "${nickname}" in this server.`);
  parts.push(
    useEmojis
      ? "Talk like a person, not a support doc; emojis used sparingly are fine."
      : "Talk like a person, not a support doc; skip emojis entirely.",
  );
  return parts.join("\n\n");
}


async function apiBotProfileGet(
  env: Env,
  request: Request,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;
  try {
    return jsonResponse({ profile: await getBotProfile(env) });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiBotProfileUpdate(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { username?: unknown; avatarUrl?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  try {
    const profile = await updateBotProfile(env, {
      username: typeof body.username === "string" ? body.username : undefined,
      avatarInput:
        typeof body.avatarUrl === "string" ? body.avatarUrl : undefined,
    });
    return jsonResponse({ profile });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 400);
  }
}

async function apiBotPersonaGet(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  const config = await loadGuildConfig(env, guildId).catch(() => null);
  const memberResponse = await botApi(
    env,
    `/guilds/${guildId}/members/@me`,
  ).catch(() => null);
  const member =
    memberResponse && memberResponse.ok
      ? ((await memberResponse.json().catch(() => null)) as {
          nick?: string | null;
        } | null)
      : null;

  return jsonResponse({
    persona: {
      guildId,
      botNickname: member?.nick ?? config?.botNickname ?? "",
      useEmojis: config?.useEmojis !== false,
      reactionEmoji: config?.reactionEmoji || "✅",
      replyEmoji: config?.replyEmoji || "",
      persona: config?.persona ?? "",
      respondName: config?.respondName ?? "",
      hasRespondAvatar: Boolean(config?.respondAvatar),
    },
  });
}

async function apiBotPersonaUpdate(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: {
    guildId?: unknown;
    botNickname?: unknown;
    useEmojis?: unknown;
    reactionEmoji?: unknown;
    replyEmoji?: unknown;
    persona?: unknown;
    respondName?: unknown;
    respondAvatarUrl?: unknown;
    removeRespondAvatar?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  const botNickname =
    typeof body.botNickname === "string" ? body.botNickname.trim() : "";
  const useEmojis = body.useEmojis !== false;
  const reactionEmoji =
    typeof body.reactionEmoji === "string" ? body.reactionEmoji.trim() : "";
  const replyEmoji =
    typeof body.replyEmoji === "string" ? body.replyEmoji.trim() : "";
  const persona = typeof body.persona === "string" ? body.persona.trim() : "";
  const respondName =
    typeof body.respondName === "string" ? body.respondName.trim() : "";

  let respondAvatar: string | undefined;
  if (body.removeRespondAvatar === true) {
    respondAvatar = "";
  } else if (typeof body.respondAvatarUrl === "string" && body.respondAvatarUrl.trim()) {
    const input = body.respondAvatarUrl.trim();
    if (input.length > 12 * 1024 * 1024) {
      return apiError("Avatar image is too large (max ~8 MB encoded)");
    }
    if (/^data:image\//i.test(input)) {
      if (input.length > 2 * 1024 * 1024) {
        return apiError("Uploaded avatar is too large (max ~1.5 MB)");
      }
      respondAvatar = input;
    } else {
      respondAvatar = await imageToDataUrl(input).catch((error: unknown) => {
        throw new Error(
          error instanceof Error ? error.message : String(error),
        );
      });
    }
  }

  if (botNickname.length > 32) {
    return apiError("Nickname must be at most 32 characters");
  }
  if (respondName.length > 80) {
    return apiError("Display name must be at most 80 characters");
  }
  if (persona.length > 2000) {
    return apiError("Persona is too long (max 2000 characters)");
  }
  for (const [label, value] of [
    ["Reaction emoji", reactionEmoji],
    ["Reply emoji", replyEmoji],
  ] as const) {
    if (value.length > 24) {
      return apiError(`${label} must be a single emoji (max 24 characters)`);
    }
  }

  const guild = found.session.guilds.find((item) => item.id === guildId);
  const existing = await loadGuildConfig(env, guildId).catch(() => null);
  try {
    await saveGuildPersona(env, guildId, guild?.name ?? null, {
      botNickname,
      useEmojis,
      reactionEmoji,
      replyEmoji,
      persona,
      respondName,
      respondAvatar:
        respondAvatar ?? existing?.respondAvatar ?? "",
    });
    await setGuildBotNickname(env, guildId, botNickname);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 400);
  }

  return jsonResponse({
    persona: {
      guildId,
      botNickname,
      useEmojis,
      reactionEmoji,
      replyEmoji,
      persona,
    },
  });
}

async function apiGuildBots(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const membersResponse = await botApi(
      env,
      `/guilds/${guildId}/members?limit=1000`,
    );
    if (!membersResponse.ok) {
      return apiError(
        `Could not load server members: ${await membersResponse.text()}`,
        membersResponse.status,
      );
    }
    const members = (await membersResponse.json()) as Array<{
      user?: { id?: string; username?: string; global_name?: string | null; bot?: boolean; avatar?: string | null };
    }>;
    const selfId = env.DISCORD_CLIENT_ID;
    const bots = members
      .filter((member) => member.user?.bot && member.user.id && member.user.id !== selfId)
      .map((member) => ({
        id: member.user?.id ?? "",
        username: member.user?.username ?? "",
        displayName: member.user?.global_name || member.user?.username || "",
        avatarUrl:
          member.user?.avatar && member.user?.id
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=64`
            : null,
      }))
      .filter((bot) => bot.id);
    bots.sort((a, b) => a.username.localeCompare(b.username));

    const config = await loadGuildConfig(env, guildId).catch(() => null);
    const enabled = config?.respondBots ?? [];
    return jsonResponse({ bots, enabled });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiGuildBotsSave(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; botIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  const botIds = Array.isArray(body.botIds)
    ? body.botIds.filter((item): item is string => typeof item === "string")
    : [];
  if (botIds.length > 50) {
    return apiError("You can enable responses for at most 50 bots");
  }

  const guild = found.session.guilds.find((item) => item.id === guildId);
  try {
    await saveRespondBots(env, guildId, guild?.name ?? null, botIds);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }

  return jsonResponse({ guildId, botIds });
}

async function apiChannels(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const channels = await listGuildChannels(env, guildId);
    return jsonResponse({
      channels: channels
        .filter((channel) => channel.type === 0 || channel.type === 5)
        .sort((a, b) => a.position - b.position)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position,
          parentId: channel.parent_id,
        })),
    });
  } catch (error) {
    if (error instanceof DiscordRestError) {
      return apiError(error.message, error.status);
    }
    return apiError(error instanceof Error ? error.message : String(error));
  }
}

async function apiGetConfig(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  const row = await env.DB.prepare(
    `SELECT guild_id, guild_name, channel_id, auto_reply, auto_community, system_prompt, updated_at
       FROM guild_configs
      WHERE guild_id = ?`,
  )
    .bind(guildId)
    .first<GuildConfigRow>();

  return jsonResponse({
    config: {
      guildId,
      channelId: row?.channel_id ?? null,
      autoReply: Boolean(row?.auto_reply),
      autoCommunity: Boolean(row?.auto_community),
      systemPrompt: (await decryptStoredText(env, row?.system_prompt)) ?? "",
      updatedAt: row?.updated_at ?? null,
    },
  });
}

async function apiSaveConfig(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: {
    guildId?: unknown;
    channelId?: unknown;
    autoReply?: unknown;
    systemPrompt?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const channelId =
    typeof body.channelId === "string" && body.channelId
      ? body.channelId
      : null;
  const autoReply = body.autoReply === true;
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";

  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (systemPrompt.length > 4000) {
    return apiError("System prompt is too long (max 4000 characters)");
  }
  if (autoReply && !channelId) {
    return apiError("Choose a channel before enabling auto-replies");
  }

  if (channelId) {
    try {
      const channels = await listGuildChannels(env, guildId);
      const channel = channels.find((item) => item.id === channelId);
      if (!channel) return apiError("Channel not found in this guild");
      if (channel.type !== 0 && channel.type !== 5) {
        return apiError("Auto-replies require a text or announcement channel");
      }
    } catch (error) {
      if (error instanceof DiscordRestError) {
        return apiError(error.message, error.status);
      }
      return apiError(error instanceof Error ? error.message : String(error));
    }
  }

  const guild = found.session.guilds.find((item) => item.id === guildId);
  const now = Date.now();

  let encryptedPrompt: string | null = null;
  if (systemPrompt) {
    try {
      encryptedPrompt = await encryptText(env, systemPrompt);
    } catch (error) {
      return apiError(
        error instanceof Error ? error.message : String(error),
        500,
      );
    }
  }

  await env.DB.prepare(
    `INSERT INTO guild_configs
       (guild_id, guild_name, channel_id, auto_reply, system_prompt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       guild_name = excluded.guild_name,
       channel_id = excluded.channel_id,
       auto_reply = excluded.auto_reply,
       system_prompt = excluded.system_prompt,
       updated_at = excluded.updated_at`,
  )
    .bind(
      guildId,
      guild?.name ?? null,
      channelId,
      autoReply ? 1 : 0,
      encryptedPrompt,
      now,
    )
    .run();

  if (autoReply) {
    await gatewayAction(env, "ensure");
  }

  return jsonResponse({
    config: {
      guildId,
      channelId,
      autoReply,
      systemPrompt,
      updatedAt: now,
    },
  });
}

async function apiGatewayStatus(
  env: Env,
  request: Request,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  return jsonResponse({ status: await gatewayStatus(env) });
}

async function apiGatewayRestart(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  return jsonResponse({ status: await gatewayAction(env, "restart") });
}

async function apiGuildKeysList(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const keys = await listGuildApiKeys(env, guildId);
    return jsonResponse({ keys });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiGuildKeysSave(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; provider?: unknown; key?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  const key = typeof body.key === "string" ? body.key : "";

  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (!isKeyProvider(provider)) {
    return apiError("Unsupported provider");
  }
  if (!key || key.length < 10) {
    return apiError("API key must be at least 10 characters");
  }

  try {
    const summary = await saveGuildApiKey(env, guildId, provider, key);
    return jsonResponse({ success: true, key: summary });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiGuildKeysDelete(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  const provider = url.searchParams.get("provider") ?? "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (!isKeyProvider(provider)) {
    return apiError("Unsupported provider");
  }

  try {
    await deleteGuildApiKey(env, guildId, provider);
    return jsonResponse({ success: true });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiGuildCommandsList(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const commands = await listGuildCommands(env, guildId);
    return jsonResponse({ commands });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiGuildCommandsSave(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: {
    guildId?: unknown;
    name?: unknown;
    description?: unknown;
    prompt?: unknown;
    enabled?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const name = typeof body.name === "string" ? body.name : "";
  const description = typeof body.description === "string" ? body.description : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const enabled = body.enabled !== false;

  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const command = await saveGuildCommand(env, guildId, {
      name,
      description,
      prompt,
      enabled,
    });
    return jsonResponse({ command });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 400);
  }
}

async function apiGuildCommandsDelete(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  const name = url.searchParams.get("name") ?? "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const deleted = await deleteGuildCommand(env, guildId, name);
    return jsonResponse({ success: true, deleted });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 400);
  }
}

async function apiGuildCommandsSync(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const result = await syncGuildCommands(env, guildId);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiClearCommands(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CLIENT_ID) {
    return apiError("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required");
  }

  const targets: string[] = [];
  if (env.DASHBOARD_OWNER_ID === found.session.userId) {
    targets.push(
      `https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/commands`,
    );
  }
  for (const guild of found.session.guilds) {
    const isAdmin =
      guild.owner ||
      (BigInt(guild.permissions || "0") & MANAGE_GUILD) === MANAGE_GUILD;
    if (!isAdmin) continue;
    targets.push(
      `https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/guilds/${guild.id}/commands`,
    );
  }

  if (targets.length === 0) {
    return apiError("You need Manage Server or bot owner access", 403);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    const response = await fetch(target, {
      method: "PUT",
      headers: {
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "content-type": "application/json",
      },
      body: "[]",
    });
    results.push({
      target,
      status: response.status,
      ok: response.ok,
      body: (await response.text()).slice(0, 300),
    });
  }

  return jsonResponse({ results });
}



async function apiProviders(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  let guildKeys = new Set<string>();
  if (guildId) {
    if (!canManage(found.session, guildId)) {
      return apiError("Guild not found", 404);
    }
    try {
      guildKeys = new Set(
        (await listGuildApiKeys(env, guildId)).map((key) => key.provider),
      );
    } catch {
      // Provider status is best-effort.
    }
  }

  const providers = Object.values(PROVIDERS).map((provider) => {
    const globalKey = provider.keyEnv
      ? Boolean(env[provider.keyEnv as keyof Env])
      : Boolean(env.AI);
    return {
      id: provider.id,
      name: provider.name,
      keyLabel: provider.keyLabel,
      docsUrl: provider.docsUrl,
      freeNote: provider.freeNote,
      requiresKey: provider.requiresKey,
      configured: globalKey || guildKeys.has(provider.id),
    };
  });

  return jsonResponse({
    providers,
    keyProviders: providers.filter((provider) => provider.requiresKey),
  });
}

async function apiModels(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const providerParam = url.searchParams.get("provider") ?? "";
  const provider: ProviderId | undefined = isProviderId(providerParam)
    ? providerParam
    : undefined;
  const refresh = url.searchParams.get("refresh") === "1";
  const guildId = url.searchParams.get("guild_id");

  try {
    let scoped = env;
    if (guildId) {
      if (!canManage(found.session, guildId)) {
        return apiError("Guild not found", 404);
      }
      scoped = await applyGuildApiKeys(env, guildId);
    }
    const models = await loadFreeModels(scoped, { refresh, provider });
    return jsonResponse({ models, refreshedAt: Date.now() });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiModelChannelsList(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const channels = await listModelChannels(env, guildId);
    return jsonResponse({ channels });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiModelChannelsCreate(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; provider?: unknown; model?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  const modelId = typeof body.model === "string" ? body.model : "";

  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }
  if (!isProviderId(provider)) {
    return apiError("Unsupported provider");
  }

  try {
    const scoped = await applyGuildApiKeys(env, guildId);
    const models = await loadFreeModels(scoped);
    const model: FreeModel | undefined = models.find(
      (item) => item.provider === provider && item.id === modelId,
    );
    if (!model) {
      return apiError(
        "That model is not in the free catalog. Refresh models and try again.",
        404,
      );
    }
    const result = await createModelChannel(env, guildId, model);
    return jsonResponse({
      success: true,
      created: result.created,
      channelId: result.channelId,
      channel: result.row,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiModelChannelsDelete(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = url.searchParams.get("guild_id");
  const channelId = url.searchParams.get("channel_id");
  if (!guildId || !channelId || !canManage(found.session, guildId)) {
    return apiError("Guild or channel not found", 404);
  }

  try {
    await deleteModelChannel(env, guildId, channelId);
    return jsonResponse({ success: true });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiModelChannelsCheck(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; channelId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  try {
    const channels = await listModelChannels(env, guildId);
    const targets = channelId
      ? channels.filter((channel) => channel.channelId === channelId)
      : channels;
    if (!targets.length) return apiError("Model channel not found", 404);

    const results = [];
    for (const channel of targets) {
      const result = await checkModelChannel(env, channel, { notify: true });
      results.push({ channelId: channel.channelId, ...result });
    }
    return jsonResponse({ success: true, results });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiAutoCommunity(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  if (!isSameOrigin(request, url)) return apiError("Invalid origin", 403);

  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: {
    guildId?: unknown;
    enabled?: unknown;
    offset?: unknown;
    limit?: unknown;
    provider?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  if (!guildId || !canManage(found.session, guildId)) {
    return apiError("Guild not found", 404);
  }

  const guild = found.session.guilds.find((item) => item.id === guildId);
  const now = Date.now();

  if (body.enabled === false) {
    await env.DB.prepare(
      `INSERT INTO guild_configs
         (guild_id, guild_name, auto_community, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         auto_community = 0,
         updated_at = excluded.updated_at`,
    )
      .bind(guildId, guild?.name ?? null, now)
      .run();
    return jsonResponse({ success: true, enabled: false });
  }

  if (body.enabled !== true) {
    return apiError("enabled must be true or false");
  }

  const providerParam =
    typeof body.provider === "string" ? body.provider : "";
  const provider: ProviderId | undefined = isProviderId(providerParam)
    ? providerParam
    : undefined;
  const offset = Math.max(
    0,
    Number.isFinite(Number(body.offset)) ? Math.floor(Number(body.offset)) : 0,
  );
  const limit = Math.min(
    10,
    Math.max(
      1,
      Number.isFinite(Number(body.limit))
        ? Math.floor(Number(body.limit))
        : 6,
    ),
  );

  await env.DB.prepare(
    `INSERT INTO guild_configs
       (guild_id, guild_name, auto_community, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       auto_community = 1,
       updated_at = excluded.updated_at`,
  )
    .bind(guildId, guild?.name ?? null, now)
    .run();

  try {
    const scoped = await applyGuildApiKeys(env, guildId);
    const models = await loadFreeModels(scoped, { provider });
    const result = await provisionModelChannels(
      env,
      guildId,
      models,
      offset,
      limit,
    );
    return jsonResponse({ success: true, enabled: true, ...result });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function resolveTargetGuild(
  env: Env,
  session: Session,
  requestedGuildId?: string | null,
): Promise<string | Response> {
  if (!env.DISCORD_BOT_TOKEN) {
    return apiError("DISCORD_BOT_TOKEN is not configured", 500);
  }

  let botGuildIds = new Set<string>();
  try {
    const botGuilds = await listBotGuilds(env);
    botGuildIds = new Set(botGuilds.map((guild) => guild.id));
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : String(error),
      500,
    );
  }

  if (requestedGuildId) {
    if (!canManage(session, requestedGuildId)) {
      return apiError("You do not manage that guild", 403);
    }
    if (!botGuildIds.has(requestedGuildId)) {
      return apiError("The bot is not in that guild", 404);
    }
    return requestedGuildId;
  }

  const candidate = session.guilds.find((guild) =>
    botGuildIds.has(guild.id),
  );
  if (!candidate) {
    return apiError(
      "The bot is not in any guild you manage. Add it to a server first.",
      404,
    );
  }
  return candidate.id;
}

async function apiServerState(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  const guildId = await resolveTargetGuild(
    env,
    found.session,
    url.searchParams.get("guild_id"),
  );
  if (guildId instanceof Response) return guildId;

  try {
    const [channelsResponse, rolesResponse] = await Promise.all([
      botApi(env, `/guilds/${guildId}/channels`),
      botApi(env, `/guilds/${guildId}/roles`),
    ]);
    if (!channelsResponse.ok) {
      return apiError(
        `Could not load channels: ${await channelsResponse.text()}`,
        channelsResponse.status,
      );
    }
    if (!rolesResponse.ok) {
      return apiError(
        `Could not load roles: ${await rolesResponse.text()}`,
        rolesResponse.status,
      );
    }

    return jsonResponse({
      guildId,
      channels: await channelsResponse.json(),
      roles: await rolesResponse.json(),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiServerOrganize(env: Env, request: Request): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let requestedGuildId: string | null = null;
  let requestedCategory = "";
  try {
    const body = (await request.json()) as {
      guildId?: unknown;
      guild_id?: unknown;
      category?: unknown;
    };
    if (typeof body.guildId === "string") requestedGuildId = body.guildId;
    if (typeof body.guild_id === "string") requestedGuildId = body.guild_id;
    if (typeof body.category === "string") requestedCategory = body.category;
  } catch {
    // No body is allowed; process every category.
  }

  const resolvedGuildId = await resolveTargetGuild(
    env,
    found.session,
    requestedGuildId,
  );
  if (resolvedGuildId instanceof Response) return resolvedGuildId;

  const guildId = resolvedGuildId;
  const everyoneId = guildId;
  const VIEW_CHANNEL = 1n << 10n;
  const SEND_MESSAGES = 1n << 11n;
  const CONNECT = 1n << 20n;
  const SPEAK = 1n << 21n;
  const MANAGE_CHANNELS = 1n << 4n;
  const ADMINISTRATOR = 1n << 3n;

  function permissionBits(role: { permissions?: string }): bigint {
    try {
      return BigInt(role.permissions ?? "0");
    } catch {
      return 0n;
    }
  }

  function isStaffRole(role: { id: string; name: string; permissions?: string }): boolean {
    if (role.id === everyoneId) return false;
    const bits = permissionBits(role);
    if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return true;
    if ((bits & MANAGE_CHANNELS) === MANAGE_CHANNELS) return true;
    const name = role.name.toLowerCase();
    return (
      name.includes("mod") ||
      name.includes("admin") ||
      name.includes("staff") ||
      name.includes("manager")
    );
  }

  function overwrite(
    id: string,
    type: 0 | 1,
    allow: bigint,
    deny: bigint,
  ): Record<string, unknown> {
    return {
      id,
      type,
      allow: allow.toString(),
      deny: deny.toString(),
    };
  }

  function allowAllText(): bigint {
    return VIEW_CHANNEL | SEND_MESSAGES;
  }

  function allowAllVoice(): bigint {
    return VIEW_CHANNEL | CONNECT | SPEAK;
  }

  const categoryPlan = [
    {
      name: "📌 INFORMATION",
      channels: [
        { name: "welcome", type: 0, topic: "Welcome to the AI-focused community." },
        { name: "rules", type: 0, topic: "Server rules and expectations." },
        { name: "announcements", type: 0, topic: "Important announcements from staff." },
        { name: "changelog", type: 0, topic: "Bot and server changelog." },
        { name: "faq", type: 0, topic: "Frequently asked questions." },
      ],
      postRestricted: ["announcements", "changelog"],
    },
    {
      name: "💬 COMMUNITY",
      channels: [
        { name: "general", type: 0, topic: "General community chat." },
        { name: "introductions", type: 0, topic: "Introduce yourself to the community." },
        { name: "showcase", type: 0, topic: "Showcase projects, builds, and creations." },
        { name: "memes", type: 0, topic: "Memes and fun content." },
        { name: "media", type: 0, topic: "Images, videos, and media sharing." },
        { name: "suggestions", type: 0, topic: "Suggestions for the server or bot." },
        { name: "questions", type: 0, topic: "Ask questions and get help." },
      ],
    },
    {
      name: "🤖 AI CHATBOT",
      channels: [
        { name: "the-ai-chat", type: 0, topic: "Chat with the AI agent." },
        { name: "bot-testing", type: 0, topic: "Test bot commands and features." },
        { name: "bug-reports", type: 0, topic: "Report bot bugs and issues." },
        { name: "model-discussion", type: 0, topic: "Discuss AI models and providers." },
        { name: "bot-feedback", type: 0, topic: "Feedback for the bot." },
      ],
    },
    {
      name: "🎮 HANGOUT",
      channels: [
        { name: "gaming", type: 0, topic: "Gaming chat." },
        { name: "music", type: 0, topic: "Music chat." },
        { name: "off-topic", type: 0, topic: "Off-topic conversation." },
        { name: "General", type: 2, topic: "General voice hangout." },
        { name: "music-room", type: 2, topic: "Music voice room." },
      ],
    },
    {
      name: "🔒 STAFF ONLY",
      channels: [
        { name: "moderator-only", type: 0, topic: "Moderator discussion." },
        { name: "mod-logs", type: 0, topic: "Moderation logs." },
        { name: "reports", type: 0, topic: "User reports." },
        { name: "staff-notes", type: 0, topic: "Staff notes." },
      ],
      staffOnly: true,
    },
  ];

  const categoriesToProcess = requestedCategory
    ? categoryPlan.filter((category) => category.name === requestedCategory)
    : categoryPlan;

  if (categoriesToProcess.length === 0) {
    return apiError("Unknown category", 400);
  }

  const report = {
    categoriesCreated: [] as string[],
    channelsCreated: [] as string[],
    channelsReused: [] as string[],
    channelsMoved: [] as string[],
    permissionsConfigured: [] as string[],
    errors: [] as string[],
    missingPermissions: [] as string[],
  };

  try {
    const [channelsResponse, rolesResponse] = await Promise.all([
      botApi(env, `/guilds/${guildId}/channels`),
      botApi(env, `/guilds/${guildId}/roles`),
    ]);
    if (!channelsResponse.ok || !rolesResponse.ok) {
      throw new Error(
        `Could not load guild state: ${await channelsResponse.text()} ${await rolesResponse.text()}`,
      );
    }

    const channels = (await channelsResponse.json()) as Array<{
      id: string;
      name: string;
      type: number;
      parent_id?: string | null;
      topic?: string | null;
      permission_overwrites?: Array<Record<string, unknown>>;
    }>;
    const roles = (await rolesResponse.json()) as Array<{
      id: string;
      name: string;
      permissions?: string;
    }>;

    const staffRoles = roles.filter(isStaffRole);
    const staffRoleIds = staffRoles.map((role) => role.id);

    const findCategory = (name: string) =>
      channels.find((channel) => channel.type === 4 && channel.name === name);
    const findChannel = (name: string, type: number) =>
      channels.find(
        (channel) => channel.type === type && channel.name === name,
      );

    for (const category of categoriesToProcess) {
      let categoryChannel = findCategory(category.name);
      if (!categoryChannel) {
        const createResponse = await botApi(env, `/guilds/${guildId}/channels`, {
          method: "POST",
          body: JSON.stringify({
            name: category.name,
            type: 4,
          }),
        });
        if (!createResponse.ok) {
          report.errors.push(
            `Category ${category.name}: ${await createResponse.text()}`,
          );
          continue;
        }
        categoryChannel = (await createResponse.json()) as {
          id: string;
          name: string;
          type: number;
        };
        channels.push(categoryChannel as never);
        report.categoriesCreated.push(category.name);
      }

      const postRestricted = new Set(category.postRestricted ?? []);
      const staffOnly = Boolean(category.staffOnly);

      for (const channelPlan of category.channels) {
        let channel = findChannel(channelPlan.name, channelPlan.type);
        if (!channel) {
          const createPayload: Record<string, unknown> = {
            name: channelPlan.name,
            type: channelPlan.type,
            parent_id: categoryChannel.id,
          };
          if (channelPlan.type !== 2) {
            createPayload.topic = channelPlan.topic;
          }
          const createResponse = await botApi(env, `/guilds/${guildId}/channels`, {
            method: "POST",
            body: JSON.stringify(createPayload),
          });
          if (!createResponse.ok) {
            report.errors.push(
              `${channelPlan.name}: ${await createResponse.text()}`,
            );
            continue;
          }
          channel = (await createResponse.json()) as {
            id: string;
            name: string;
            type: number;
            parent_id?: string | null;
          };
          channels.push(channel as never);
          report.channelsCreated.push(channelPlan.name);
        } else {
          report.channelsReused.push(channelPlan.name);
          if (channel.parent_id !== categoryChannel.id) {
            report.channelsMoved.push(channelPlan.name);
          }
        }

        const overwrites: Array<Record<string, unknown>> = [];

        if (staffOnly) {
          overwrites.push(
            overwrite(everyoneId, 0, 0n, VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK),
          );
          for (const roleId of staffRoleIds) {
            overwrites.push(overwrite(roleId, 0, VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK, 0n));
          }
        } else if (channelPlan.type === 2) {
          overwrites.push(overwrite(everyoneId, 0, allowAllVoice(), 0n));
        } else {
          const everyoneAllow = allowAllText();
          const everyoneDeny =
            postRestricted.has(channelPlan.name) ? SEND_MESSAGES : 0n;
          overwrites.push(overwrite(everyoneId, 0, everyoneAllow, everyoneDeny));
          if (postRestricted.has(channelPlan.name)) {
            for (const roleId of staffRoleIds) {
              overwrites.push(overwrite(roleId, 0, SEND_MESSAGES, 0n));
            }
          }
        }

        const patchBody: Record<string, unknown> = {
          parent_id: categoryChannel.id,
          permission_overwrites: overwrites,
        };
        if (channelPlan.type !== 2) {
          patchBody.topic = channelPlan.topic;
        }

        const patchResponse = await botApi(env, `/channels/${channel.id}`, {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        });
        if (!patchResponse.ok) {
          report.errors.push(
            `${channelPlan.name} permissions: ${await patchResponse.text()}`,
          );
          continue;
        }

        report.permissionsConfigured.push(channelPlan.name);
      }
    }

    return jsonResponse({
      success: report.errors.length === 0,
      staffRoles: staffRoles.map((role) => ({ id: role.id, name: role.name })),
      report,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}


async function apiServerBotMember(
  env: Env,
  request: Request,
  url: URL,
): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CLIENT_ID) {
    return apiError("Missing bot config", 500);
  }

  const guildId = await resolveTargetGuild(
    env,
    found.session,
    url.searchParams.get("guild_id"),
  );
  if (guildId instanceof Response) return guildId;

  try {
    const response = await botApi(
      env,
      `/guilds/${guildId}/members/${env.DISCORD_CLIENT_ID}`,
    );
    if (!response.ok) return apiError(await response.text(), response.status);
    return jsonResponse(await response.json());
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiServerVerifySetup(env: Env, request: Request): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CLIENT_ID) {
    return apiError("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required", 500);
  }

  let requestedGuildId: string | null = null;
  try {
    const body = (await request.json()) as {
      guildId?: unknown;
      guild_id?: unknown;
    };
    if (typeof body.guildId === "string") requestedGuildId = body.guildId;
    if (typeof body.guild_id === "string") requestedGuildId = body.guild_id;
  } catch {
    // No body is allowed; use the first connected guild.
  }

  const resolvedGuildId = await resolveTargetGuild(
    env,
    found.session,
    requestedGuildId,
  );
  if (resolvedGuildId instanceof Response) return resolvedGuildId;

  const guildId = resolvedGuildId;
  const everyoneId = guildId;
  const VIEW_CHANNEL = 1n << 10n;
  const SEND_MESSAGES = 1n << 11n;
  const CONNECT = 1n << 20n;
  const SPEAK = 1n << 21n;
  const ADMINISTRATOR = 1n << 3n;
  const MANAGE_CHANNELS = 1n << 4n;

  function permissionBits(role: { permissions?: string }): bigint {
    try {
      return BigInt(role.permissions ?? "0");
    } catch {
      return 0n;
    }
  }

  function isStaffRole(role: { id: string; name: string; permissions?: string }): boolean {
    if (role.id === everyoneId) return false;
    const bits = permissionBits(role);
    if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return true;
    if ((bits & MANAGE_CHANNELS) === MANAGE_CHANNELS) return true;
    const name = role.name.toLowerCase();
    return (
      name.includes("mod") ||
      name.includes("admin") ||
      name.includes("staff") ||
      name.includes("manager")
    );
  }

  function overwrite(id: string, type: 0 | 1, allow: bigint, deny: bigint): Record<string, unknown> {
    return {
      id,
      type,
      allow: allow.toString(),
      deny: deny.toString(),
    };
  }

  const report = {
    roleCreated: false,
    roleId: "",
    unverifiedRoleCreated: false,
    unverifiedRoleId: "",
    unverifiedMembersAssigned: 0,
    verifyChannelId: "",
    verificationMessageSent: false,
    channelsConfigured: [] as string[],
    errors: [] as string[],
  };

  try {
    const [channelsResponse, rolesResponse] = await Promise.all([
      botApi(env, `/guilds/${guildId}/channels`),
      botApi(env, `/guilds/${guildId}/roles`),
    ]);
    if (!channelsResponse.ok || !rolesResponse.ok) {
      throw new Error("Could not load guild state");
    }

    const channels = (await channelsResponse.json()) as Array<{
      id: string;
      name: string;
      type: number;
      parent_id?: string | null;
    }>;
    const roles = (await rolesResponse.json()) as Array<{
      id: string;
      name: string;
      permissions?: string;
    }>;

    let verifiedRole = roles.find((role) => role.name === "Verified");
    if (!verifiedRole) {
      const createRoleResponse = await botApi(env, `/guilds/${guildId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          name: "Verified",
          color: 5763719,
          hoist: false,
          mentionable: false,
          permissions: "0",
        }),
      });
      if (!createRoleResponse.ok) {
        throw new Error(`Could not create Verified role: ${await createRoleResponse.text()}`);
      }
      verifiedRole = (await createRoleResponse.json()) as {
        id: string;
        name: string;
        permissions?: string;
      };
      report.roleCreated = true;
    }
    report.roleId = verifiedRole.id;

    let unverifiedRole = roles.find((role) => role.name === "Unverified");
    if (!unverifiedRole) {
      const createUnverifiedRoleResponse = await botApi(env, `/guilds/${guildId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          name: "Unverified",
          color: 9807270,
          hoist: false,
          mentionable: false,
          permissions: "0",
        }),
      });
      if (!createUnverifiedRoleResponse.ok) {
        throw new Error(
          `Could not create Unverified role: ${await createUnverifiedRoleResponse.text()}`,
        );
      }
      unverifiedRole = (await createUnverifiedRoleResponse.json()) as {
        id: string;
        name: string;
        permissions?: string;
      };
      roles.push(unverifiedRole);
      report.unverifiedRoleCreated = true;
    }
    report.unverifiedRoleId = unverifiedRole.id;

    const staffRoleIds = roles.filter(isStaffRole).map((role) => role.id);
    const informationCategory = channels.find(
      (channel) => channel.type === 4 && channel.name === "📌 INFORMATION",
    );
    if (!informationCategory) {
      throw new Error("INFORMATION category was not found");
    }

    let verifyChannel = channels.find(
      (channel) => channel.type === 0 && channel.name === "verify",
    );
    if (!verifyChannel) {
      const createChannelResponse = await botApi(env, `/guilds/${guildId}/channels`, {
        method: "POST",
        body: JSON.stringify({
          name: "verify",
          type: 0,
          parent_id: informationCategory.id,
          topic: "Verify that you are not a robot to access the server.",
        }),
      });
      if (!createChannelResponse.ok) {
        throw new Error(`Could not create verify channel: ${await createChannelResponse.text()}`);
      }
      verifyChannel = (await createChannelResponse.json()) as {
        id: string;
        name: string;
        type: number;
        parent_id?: string | null;
      };
      channels.push(verifyChannel);
    }
    report.verifyChannelId = verifyChannel.id;

    const staffOnlyCategory = channels.find(
      (channel) => channel.type === 4 && channel.name === "🔒 STAFF ONLY",
    );
    const restrictedChannels = new Set(["announcements", "changelog"]);

    for (const channel of channels) {
      if (channel.type !== 0 && channel.type !== 2) continue;

      const isVerify = channel.name === "verify";
      const isStaffOnly =
        Boolean(staffOnlyCategory && channel.parent_id === staffOnlyCategory.id) ||
        channel.name === "moderator-only";
      const isRestricted = restrictedChannels.has(channel.name);
      const overwrites: Array<Record<string, unknown>> = [];

      if (isVerify) {
        overwrites.push(overwrite(everyoneId, 0, VIEW_CHANNEL | SEND_MESSAGES, 0n));
        overwrites.push(
          overwrite(verifiedRole.id, 0, 0n, VIEW_CHANNEL | SEND_MESSAGES),
        );
        for (const roleId of staffRoleIds) {
          overwrites.push(overwrite(roleId, 0, VIEW_CHANNEL | SEND_MESSAGES, 0n));
        }
      } else if (isStaffOnly) {
        overwrites.push(overwrite(everyoneId, 0, 0n, VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK));
        overwrites.push(overwrite(verifiedRole.id, 0, 0n, VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK));
        for (const roleId of staffRoleIds) {
          overwrites.push(overwrite(roleId, 0, VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK, 0n));
        }
      } else if (channel.type === 2) {
        overwrites.push(overwrite(everyoneId, 0, 0n, VIEW_CHANNEL | CONNECT | SPEAK));
        overwrites.push(overwrite(verifiedRole.id, 0, VIEW_CHANNEL | CONNECT | SPEAK, 0n));
        for (const roleId of staffRoleIds) {
          overwrites.push(overwrite(roleId, 0, VIEW_CHANNEL | CONNECT | SPEAK, 0n));
        }
      } else {
        overwrites.push(overwrite(everyoneId, 0, 0n, VIEW_CHANNEL | SEND_MESSAGES));
        overwrites.push(
          overwrite(
            verifiedRole.id,
            0,
            isRestricted ? VIEW_CHANNEL : VIEW_CHANNEL | SEND_MESSAGES,
            0n,
          ),
        );
        for (const roleId of staffRoleIds) {
          overwrites.push(overwrite(roleId, 0, VIEW_CHANNEL | SEND_MESSAGES, 0n));
        }
      }

      const patchResponse = await botApi(env, `/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ permission_overwrites: overwrites }),
      });
      if (!patchResponse.ok) {
        report.errors.push(`${channel.name}: ${await patchResponse.text()}`);
        continue;
      }
      report.channelsConfigured.push(channel.name);
    }

    const messagesResponse = await botApi(
      env,
      `/channels/${verifyChannel.id}/messages?limit=10`,
    );
    let alreadyHasVerificationMessage = false;
    let oldButtonMessages: string[] = [];
    if (messagesResponse.ok) {
      const messages = (await messagesResponse.json()) as Array<{
        id: string;
        author?: { id?: string };
        components?: Array<{ components?: Array<{ custom_id?: string; url?: string }> }>;
      }>;
      for (const message of messages) {
        if (message.author?.id !== env.DISCORD_CLIENT_ID) continue;
        const hasLinkButton = message.components?.some((row) =>
          row.components?.some((component) =>
            typeof component.url === "string" && component.url.includes("/verify"),
          ),
        );
        const hasOldButton = message.components?.some((row) =>
          row.components?.some((component) => component.custom_id === "verify_member"),
        );
        if (hasLinkButton) alreadyHasVerificationMessage = true;
        if (hasOldButton && message.id) oldButtonMessages.push(message.id);
      }
    }

    for (const messageId of oldButtonMessages) {
      await botApi(env, `/channels/${verifyChannel.id}/messages/${messageId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }

    if (!alreadyHasVerificationMessage) {
      const messageResponse = await botApi(env, `/channels/${verifyChannel.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content:
            "Welcome! Click the button below to verify that you are not a robot. After verification, you will gain access to the server.",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: "Verify in browser",
                  url: `${new URL(request.url).origin}/verify?guild=${guildId}`,
                },
              ],
            },
          ],
        }),
      });
      if (!messageResponse.ok) {
        report.errors.push(`verification message: ${await messageResponse.text()}`);
      } else {
        report.verificationMessageSent = true;
        const message = (await messageResponse.json()) as { id?: string };
        if (message.id) {
          await botApi(env, `/channels/${verifyChannel.id}/pins/${message.id}`, {
            method: "PUT",
          }).catch(() => undefined);
        }
      }
    }

    try {
      const membersResponse = await botApi(env, `/guilds/${guildId}/members?limit=1000`);
      if (membersResponse.ok) {
        const members = (await membersResponse.json()) as Array<{
          user?: { id?: string; bot?: boolean };
          roles?: string[];
        }>;
        for (const member of members) {
          const memberId = member.user?.id;
          if (!memberId || member.user?.bot) continue;
          if (member.roles?.includes(verifiedRole.id)) continue;
          if (member.roles?.includes(unverifiedRole.id)) continue;
          const assignResponse = await botApi(
            env,
            `/guilds/${guildId}/members/${memberId}/roles/${unverifiedRole.id}`,
            { method: "PUT" },
          );
          if (assignResponse.ok) {
            report.unverifiedMembersAssigned += 1;
          }
        }
      }
    } catch {
      // Best-effort backfill.
    }

    return jsonResponse({
      success: report.errors.length === 0,
      report,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function apiVerifyComplete(env: Env, request: Request): Promise<Response> {
  const found = await requireSession(env, request);
  if (found instanceof Response) return found;

  let body: { guildId?: unknown; fingerprint?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("Invalid JSON");
  }

  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  if (!guildId || !fingerprint) {
    return apiError("guildId and fingerprint are required");
  }
  if (fingerprint.length < 16) {
    return apiError("Invalid fingerprint");
  }

  const userId = found.session.userId;
  const userAgent = request.headers.get("user-agent") || "unknown";
  const ip = clientIp(request);
  const ipHash = await sha256Hex(ip);
  const fingerprintHash = await sha256Hex(fingerprint);
  const identityHash = await sha256Hex(`${ipHash}|${fingerprintHash}|${userAgent}`);

  try {
    const memberResponse = await botApi(env, `/guilds/${guildId}/members/${userId}`);
    if (!memberResponse.ok) {
      return apiError("You are not a member of this server.", 403);
    }

    const banned = await isBannedIdentity(env, guildId, identityHash);
    if (banned) {
      try {
        const dmChannelResponse = await botApi(env, "/users/@me/channels", {
          method: "POST",
          body: JSON.stringify({ recipient_id: userId }),
        });
        if (dmChannelResponse.ok) {
          const dmChannel = (await dmChannelResponse.json()) as { id: string };
          await botApi(env, `/channels/${dmChannel.id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              content: "You were already banned in this server.",
            }),
          });
        }
      } catch {
        // Best-effort DM.
      }

      await botApi(env, `/guilds/${guildId}/bans/${userId}`, {
        method: "PUT",
        body: JSON.stringify({
          delete_message_days: 0,
          reason: "Alt account of a banned user",
        }),
      }).catch(() => undefined);

      return jsonResponse({
        banned: true,
        message: "You were already banned in this server.",
      });
    }

    const rolesResponse = await botApi(env, `/guilds/${guildId}/roles`);
    if (!rolesResponse.ok) {
      return apiError("Could not load server roles.", 500);
    }
    const roles = (await rolesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    const verifiedRole = roles.find((role) => role.name === "Verified");
    if (!verifiedRole) {
      return apiError("The Verified role has not been configured yet.", 500);
    }

    const unverifiedRole = roles.find((role) => role.name === "Unverified");

    const assignResponse = await botApi(
      env,
      `/guilds/${guildId}/members/${userId}/roles/${verifiedRole.id}`,
      { method: "PUT" },
    );
    if (!assignResponse.ok) {
      return apiError(
        `Could not assign the Verified role: ${(await assignResponse.text()).slice(0, 200)}`,
        500,
      );
    }

    if (unverifiedRole) {
      await botApi(
        env,
        `/guilds/${guildId}/members/${userId}/roles/${unverifiedRole.id}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }

    const identity = {
      ipHash,
      fingerprintHash,
      identityHash,
      userAgent,
      createdAt: Date.now(),
    };
    await storeIdentity(env, userId, identity);
    await markVerified(env, guildId, userId, identityHash);

    let guildName = guildId;
    try {
      const guildResponse = await botApi(env, `/guilds/${guildId}`);
      if (guildResponse.ok) {
        const guild = (await guildResponse.json()) as { name?: string };
        if (guild.name) guildName = guild.name;
      }
    } catch {
      // Keep the guild ID as a fallback name.
    }

    const successMessage = `Successfully verified on server "${guildName}".`;
    try {
      const dmChannelResponse = await botApi(env, "/users/@me/channels", {
        method: "POST",
        body: JSON.stringify({ recipient_id: userId }),
      });
      if (dmChannelResponse.ok) {
        const dmChannel = (await dmChannelResponse.json()) as { id: string };
        await botApi(env, `/channels/${dmChannel.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: successMessage }),
        });
      }
    } catch {
      // Best-effort DM.
    }

    try {
      const channelsResponse = await botApi(env, `/guilds/${guildId}/channels`);
      if (channelsResponse.ok) {
        const channels = (await channelsResponse.json()) as Array<{
          id: string;
          name: string;
          type: number;
        }>;
        const verifyChannel = channels.find(
          (channel) => channel.type === 0 && channel.name === "verify",
        );
        if (verifyChannel) {
          await botApi(env, `/channels/${verifyChannel.id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              content: `<@${userId}> ${successMessage}`,
              allowed_mentions: { parse: ["users"] },
            }),
          });
        }
      }
    } catch {
      // Best-effort guild notification.
    }

    console.log(`Verified user ${userId} on guild ${guildId} (${guildName})`);

    return jsonResponse({
      banned: false,
      message: successMessage,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), 500);
  }
}


async function handleWebAgentApi(
  env: Env,
  request: Request,
  url: URL,
  identity: { id: string },
  ctx?: ExecutionContext,
): Promise<Response> {
  const {
    createSession: createWebAgentSession,
    saveSession: saveWebAgentSession,
    deleteSession: deleteWebAgentSession,
    titleFromPrompt,
    getJob,
    putJob,
  } = await import("./web-agent-store");
  const { runAgent } = await import("./agent");
  const { DEFAULT_SYSTEM_PROMPT } = await import("./env");
  const { runOpencodeAgent, opencodeConfigured } = await import("./opencode-agent");

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // empty body
  }

  const pathname = url.pathname;

  if (pathname === "/api/web/agent/sessions" && request.method === "GET") {
    return jsonResponse({ sessions: await listWebAgentSessions(env, identity.id) });
  }

  if (pathname === "/api/web/agent/session" && request.method === "GET") {
    const sessionIdGet = url.searchParams.get("id") ?? "";
    const existing = await loadWebAgentSession(env, identity.id, sessionIdGet);
    if (!existing) return apiError("No such session", 404);
    return jsonResponse({ session: existing });
  }

  if (pathname === "/api/web/agent/sessions" && request.method === "POST") {
    const title = typeof body.title === "string" ? body.title : "New chat";
    const session = await createWebAgentSession(env, identity.id, title);
    await saveWebAgentSession(env, identity.id, session);
    return jsonResponse({ session: { id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt } });
  }

  if (pathname === "/api/web/agent/session/delete" && request.method === "POST") {
    const removed = await deleteWebAgentSession(env, identity.id, String(body.id ?? ""));
    return jsonResponse({ removed });
  }

  if (pathname === "/api/web/agent/chat" && request.method === "POST") {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return apiError("Prompt is required");
    let sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : "";
    let session = sessionId
      ? await loadWebAgentSession(env, identity.id, sessionId)
      : null;
    if (!session) {
      session = await createWebAgentSession(env, identity.id, titleFromPrompt(prompt));
      sessionId = session.id;
    }
    const history = session.messages.map(
      (m: { role: string; content: string }) =>
        ({ role: m.role, content: m.content }) as { role: "user" | "assistant"; content: string },
    );
    session.messages.push({ role: "user", content: prompt, at: Date.now() });
    session.updatedAt = Date.now();
    if (session.title === "New chat") session.title = titleFromPrompt(prompt);
    await saveWebAgentSession(env, identity.id, session);

    // Hybrid: stream to the client over SSE, but keep the run alive via
    // waitUntil so it finishes server-side even if the browser disconnects.
    // Job state in KV lets a reconnecting client catch up.
    const setJob = async (payload: Record<string, unknown>) => {
      try {
        await putJob(env, identity.id, sessionId, payload);
      } catch {
        // job tracking is best-effort
      }
    };
    await setJob({ status: "running", activity: "thinking…", startedAt: Date.now() });

    const encoder = new TextEncoder();
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    let clientGone = false;
    const sendEvent = async (event: string, data: Record<string, unknown>) => {
      if (clientGone) return;
      try {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`),
        );
      } catch {
        clientGone = true; // browser tab closed; run continues server-side
      }
    };

    const run = (async () => {
      try {
        await sendEvent("meta", { sessionId });
        // Agent V2 first: the real opencode agent on the owner's machine.
        if (opencodeConfigured(env)) {
          await sendEvent("status", { status: "agent v2 running…" });
          await setJob({ status: "running", activity: "agent v2 running…" });
          const run = await runOpencodeAgent(env, {
            sessionKey: `web-${identity.id}-${sessionId}`,
            prompt,
            timeoutSeconds: 10,
          });
          if (run.ok) {
            // Stream the finished reply out in chunks so the UI types it.
            const reply = run.output;
            const chunkSize = 220;
            for (let i = 0; i < reply.length; i += chunkSize) {
              await sendEvent("delta", { text: reply.slice(i, i + chunkSize) });
            }
            session!.messages.push({ role: "assistant", content: reply, at: Date.now() });
            session!.updatedAt = Date.now();
            await saveWebAgentSession(env, identity.id, session!);
            await sendEvent("done", { text: reply });
            await setJob({ status: "done", activity: null, finishedAt: Date.now() });
            return;
          }
          const fallbackNote = run.error ?? "unknown error";
          await sendEvent("status", { status: `v2 failed: ${fallbackNote.slice(0, 120)} — falling back to v1…` });
          await setJob({ status: "running", activity: "v2 failed — using v1" });
        }
        const result = await runAgent(env, {
          scope: `web/${identity.id}/${sessionId}`,
          userId: identity.id,
          history,
          prompt,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          modelChain: [
            "dots-studio/dots-3-note-preview:free",
            "baidu/ernie-5.5-flash-preview:free",
            "nvidia/nemotron-3.5-super-vl:free",
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
            "codestral-latest",
            "kilo-auto/free",
          ],
          stream: {
            onDelta: async (text) => {
              await sendEvent("delta", { text });
              await setJob({ status: "running", activity: "writing…" });
            },
            onStatus: async (status) => {
              let label = status.toLowerCase();
              const runMatch = status.match(/^Using\s+([a-z0-9_]+)…?$/i);
              const readMatch = status.match(/^Reading\s+([a-z0-9_]+)\s+results…?$/i);
              if (runMatch) label = `running ${runMatch[1].replace(/_/g, " ")}…`;
              else if (readMatch) label = `reading ${readMatch[1].replace(/_/g, " ")} results…`;
              await sendEvent("status", { status: label });
              await setJob({ status: "running", activity: label });
            },
            onToolEvent: async (event) => {
              await sendEvent("tool", { ...event });
            },
          },
        });
        session!.messages.push({ role: "assistant", content: result.text, at: Date.now() });
        session!.updatedAt = Date.now();
        await saveWebAgentSession(env, identity.id, session!);
        await sendEvent("done", { text: result.text });
        await setJob({ status: "done", activity: null, finishedAt: Date.now() });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await sendEvent("error", { text: text.slice(0, 300) });
        await setJob({ status: "error", error: text.slice(0, 300) });
      } finally {
        try {
          await writer.close();
        } catch {
          // client already gone
        }
      }
    })();
    if (ctx) {
      ctx.waitUntil(run);
      return new Response(stream.readable, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    }
    await run;
    return jsonResponse({ started: true, sessionId });
  }

  if (pathname === "/api/web/agent/job" && request.method === "GET") {
    const sessionId = url.searchParams.get("session") ?? "";
    if (!sessionId) return apiError("session is required");
    try {
      const job = await getJob(env, identity.id, sessionId);
      return jsonResponse(job ?? { status: "none" });
    } catch {
      return jsonResponse({ status: "none" });
    }
  }

  return apiError("Unknown web agent route", 404);
}
