import { botApi } from "./discord/rest";
import type { Env } from "./env";

export interface BotProfile {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface DiscordUser {
  username?: string;
  global_name?: string | null;
  id?: string;
  avatar?: string | null;
}

export async function getBotProfile(env: Env): Promise<BotProfile> {
  const response = await botApi(env, "/users/@me");
  if (!response.ok) {
    throw new Error(
      `Could not load bot profile: ${await response.text()}`,
    );
  }
  const user = (await response.json()) as DiscordUser;
  return {
    username: user.username ?? "",
    displayName: user.global_name || user.username || "",
    avatarUrl:
      user.avatar && user.id
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
        : null,
  };
}

export let profileCache: { at: number; value: BotProfile } | null = null;
const PROFILE_CACHE_TTL = 15 * 60 * 1000;

export async function getBotProfileCached(env: Env): Promise<BotProfile> {
  if (profileCache && Date.now() - profileCache.at < PROFILE_CACHE_TTL) {
    return profileCache.value;
  }
  const value = await getBotProfile(env);
  profileCache = { at: Date.now(), value };
  return value;
}

export async function imageToDataUrl(value: string): Promise<string> {
  const source = value.trim();
  if (!source) throw new Error("Choose an image first");

  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(source)) {
    return source;
  }

  if (/^data:/.test(source)) {
    throw new Error("Unsupported avatar data format");
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Avatar must be an image URL like https://…/avatar.png");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Avatar URL must use http or https");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load avatar image (${response.status})`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(type)) {
    throw new Error(`Unsupported avatar image type: ${type || "unknown"}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 8 * 1024 * 1024) {
    throw new Error("Avatar image is too large (max 8 MB)");
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

export async function updateBotProfile(
  env: Env,
  options: {
    username?: string;
    avatarInput?: string;
  },
): Promise<BotProfile> {
  const body: Record<string, unknown> = {};

  const username = options.username?.trim();
  if (username) {
    if (!/^[\w .-]{1,32}$/.test(username)) {
      throw new Error(
        "Username must be 1–32 characters: letters, numbers, spaces, ., _ -",
      );
    }
    body.username = username;
  }

  if (options.avatarInput) {
    body.avatar = await imageToDataUrl(options.avatarInput);
  }

  if (!Object.keys(body).length) {
    throw new Error("Nothing to update");
  }

  const response = await botApi(env, "/users/@me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Discord rejected the profile update: ${(await response.text()).slice(0, 300)}`,
    );
  }

  return getBotProfile(env);
}

export async function setGuildBotNickname(
  env: Env,
  guildId: string,
  nickname: string,
): Promise<void> {
  const nick = nickname.trim();
  const body = nick ? { nick: nick.slice(0, 32) } : { nick: null };
  const response = await botApi(env, `/guilds/${guildId}/members/@me`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(
      `Could not set bot nickname: ${(await response.text()).slice(0, 300)}`,
    );
  }
}

