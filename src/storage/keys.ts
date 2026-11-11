import type { Interaction } from "../discord/types";

const MAX_KEY_LENGTH = 400;

export function sanitizeRelativeKey(input: string): string {
  const raw = String(input ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/[\u0000-\u001f\u007f]/g, "");

  const parts = raw
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) =>
      part
        .replace(/[^A-Za-z0-9._ -]/g, "_")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  let key = parts.join("/");
  if (!key) throw new Error("File key is empty");
  if (key.length > MAX_KEY_LENGTH) key = key.slice(0, MAX_KEY_LENGTH);

  key = key
    .split("/")
    .map((part) => (part === "_meta" ? "file" : part))
    .join("/");

  return key;
}

export function buildScopedKey(scope: string, relativeKey: string): string {
  const cleanScope = String(scope ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");

  if (!cleanScope) throw new Error("Invalid storage scope");
  return `${cleanScope}/${sanitizeRelativeKey(relativeKey)}`;
}

export function scopeForInteraction(interaction: Interaction): string {
  if (interaction.guild_id) return `guilds/${interaction.guild_id}`;
  const userId = interaction.user?.id ?? interaction.member?.user.id;
  if (userId) return `users/${userId}`;
  return `channels/${interaction.channel_id ?? "unknown"}`;
}

export function basename(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] || "file";
}
