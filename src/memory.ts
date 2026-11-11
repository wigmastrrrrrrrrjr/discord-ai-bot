import type { Env } from "./env";
import { encryptText, decryptText } from "./crypto";
import type { Interaction } from "./discord/types";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_STORED_MESSAGE_CHARS = 8000;

export function conversationKey(interaction: Interaction): string {
  const userId = interaction.user?.id ?? interaction.member?.user.id ?? "unknown";
  const owner = interaction.guild_id
    ? `guild:${interaction.guild_id}`
    : `user:${userId}`;
  return `conv:${owner}:${interaction.channel_id ?? "dm"}`;
}

export function trimHistory(
  history: StoredMessage[],
  maxMessages: number,
): StoredMessage[] {
  return history.slice(-Math.max(1, maxMessages));
}

export async function loadHistory(
  env: Env,
  key: string,
  maxMessages: number,
): Promise<StoredMessage[]> {
  try {
    const raw = await env.CONVERSATIONS.get(key);
    if (!raw) return [];
    // Values are AES-GCM encrypted at rest. A plaintext legacy value is
    // accepted once and re-encrypted on the next save.
    let text = raw;
    try {
      text = await decryptText(env, raw);
    } catch {
      text = raw;
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];

    const history = parsed.filter(
      (message): message is StoredMessage =>
        Boolean(message) &&
        typeof message === "object" &&
        ((message as StoredMessage).role === "user" ||
          (message as StoredMessage).role === "assistant") &&
        typeof (message as StoredMessage).content === "string",
    );

    return trimHistory(history, maxMessages);
  } catch {
    return [];
  }
}

export async function saveHistory(
  env: Env,
  key: string,
  history: StoredMessage[],
  maxMessages: number,
): Promise<void> {
  const trimmed = trimHistory(history, maxMessages).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_STORED_MESSAGE_CHARS),
  }));

  await env.CONVERSATIONS.put(key, await encryptText(env, JSON.stringify(trimmed)), {
    expirationTtl: HISTORY_TTL_SECONDS,
  });
}

export async function clearHistory(env: Env, key: string): Promise<void> {
  await env.CONVERSATIONS.delete(key);
}
