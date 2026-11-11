import type { Env } from "./env";
import { encryptText, decryptText } from "./crypto";
import type { Interaction } from "./discord/types";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_STORED_MESSAGE_CHARS = 8000;
// Hard ceiling on stored history size (~75k tokens). Anything larger gets
// its oldest messages dropped automatically — this is the auto-reset that
// keeps histories within what the model APIs can handle.
const DEFAULT_MAX_HISTORY_CHARS = 300000;

function historyMaxChars(env: Env): number {
  const configured = Number(env.CONV_HISTORY_MAX_CHARS);
  return configured > 0 ? configured : DEFAULT_MAX_HISTORY_CHARS;
}

function trimToCharBudget(
  history: StoredMessage[],
  budget: number,
): StoredMessage[] {
  let total = 0;
  const out: StoredMessage[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    total += history[i].content.length;
    if (total > budget) break;
    out.push(history[i]);
  }
  return out.reverse();
}

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

    return trimToCharBudget(trimHistory(history, maxMessages), historyMaxChars(env));
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
  const capped = trimHistory(history, maxMessages).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_STORED_MESSAGE_CHARS),
  }));
  const trimmed = trimToCharBudget(capped, historyMaxChars(env));

  await env.CONVERSATIONS.put(key, await encryptText(env, JSON.stringify(trimmed)), {
    expirationTtl: HISTORY_TTL_SECONDS,
  });
}

export async function clearHistory(env: Env, key: string): Promise<void> {
  await env.CONVERSATIONS.delete(key);
}
