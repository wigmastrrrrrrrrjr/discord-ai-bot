import { completeWithFallback } from "./ai/router";
import { executeTool, toolsFor } from "./ai/tools";
import { applyGuildApiKeys } from "./guild-secrets";
import type { ChatMessage, ChatResponse, StreamHandlers } from "./ai/types";
import type { Env } from "./env";
import { DEFAULT_SYSTEM_PROMPT } from "./env";
import type { StoredMessage } from "./memory";
import { sandboxExec } from "./sandbox";

export const MAX_TOOL_ROUNDS = 8;
const MAX_TOKENS = 2000;
const SIMULATED_CHUNK = 32;
const SIMULATED_DELAY_MS = 25;

export interface AgentResult {
  text: string;
  provider: string;
  model: string;
  generatedAttachments?: string[];
}

function toResult(
  response: ChatResponse,
  generatedAttachments: string[] = [],
): AgentResult {
  return {
    text: response.content.trim() || "Done.",
    provider: response.provider,
    model: response.model,
    ...(generatedAttachments.length ? { generatedAttachments } : {}),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateStream(
  text: string,
  handlers: StreamHandlers,
): Promise<void> {
  const pieces = text.match(/\s*\S+/g) ?? [text];
  let buffer = "";

  for (const piece of pieces) {
    buffer += piece;
    if (buffer.length < SIMULATED_CHUNK) continue;
    await handlers.onDelta?.(buffer);
    buffer = "";
    await sleep(SIMULATED_DELAY_MS);
  }

  if (buffer) await handlers.onDelta?.(buffer);
}

function toolStatus(name: string): string {
  return `Using ${name.replace(/_/g, " ")}…`;
}


const OPENCODE_CACHE_KEY = "agent:opencode-available";
const OPENCODE_CACHE_TTL = 300;

async function opencodeAvailable(env: Env): Promise<boolean | null> {
  try {
    const cached = await env.CONVERSATIONS.get(OPENCODE_CACHE_KEY);
    if (cached === "1") return true;
    if (cached === "0") return false;
  } catch {
    // KV is best-effort.
  }
  return null;
}

async function cacheOpencode(env: Env, available: boolean): Promise<void> {
  try {
    await env.CONVERSATIONS.put(OPENCODE_CACHE_KEY, available ? "1" : "0", {
      expirationTtl: OPENCODE_CACHE_TTL,
    });
  } catch {
    // KV is best-effort.
  }
}

async function runOpenCodeAgent(
  env: Env,
  prompt: string,
): Promise<AgentResult | null> {
  // The sandbox CLI runs synchronously and can hold a reply for up to two
  // minutes, so it stays behind a flag. The fast provider chain answers
  // directly by default.
  if (env.ALLOW_OPENCODE_AGENT !== "1") return null;
  const cached = await opencodeAvailable(env);
  if (cached === false) return null;
  try {
    await sandboxExec(env, "command -v opencode >/dev/null 2>&1", 5_000);
    await cacheOpencode(env, true);
    const quoted = JSON.stringify(prompt).slice(1, -1);
    const result = await sandboxExec(env, `opencode run ${quoted}`, 120_000);
    const output = (result.output ?? "").trim();
    if (result.exitCode !== 0 || !output) return null;
    return { text: output, provider: "opencode-local", model: "agent" };
  } catch (error) {
    // Only cache "unavailable" when the probe itself clocks out; a real run
    // failure should fall through to the normal providers instead.
    if (
      cached === null &&
      error instanceof Error &&
      /timed out|abort/i.test(error.message)
    ) {
      await cacheOpencode(env, false);
    }
    return null;
  }
}
export async function runAgent(
  env: Env,
  options: {
    scope: string;
    userId?: string;
    history: StoredMessage[];
    prompt: string;
    attachmentNote?: string;
    attachmentImageUrl?: string;
    systemPrompt?: string;
    allowTools?: boolean;
    stream?: StreamHandlers;
    guildId?: string;
  },
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        options.systemPrompt?.trim() ||
        env.SYSTEM_PROMPT ||
        DEFAULT_SYSTEM_PROMPT,
    },
    ...options.history.map(
      (message): ChatMessage => ({
        role: message.role,
        content: message.content,
      }),
    ),
    {
      role: "user",
      content: options.attachmentImageUrl
        ? [
            { type: "text", text: options.attachmentNote ? `${options.prompt}\n\n${options.attachmentNote}` : options.prompt },
            { type: "image_url", image_url: { url: options.attachmentImageUrl, detail: "auto" } },
          ]
        : options.attachmentNote
          ? `${options.prompt}\n\n${options.attachmentNote}`
          : options.prompt,
    },
  ];

  const requestEnv = options.guildId
    ? await applyGuildApiKeys(env, options.guildId)
    : env;
  const tools =
    options.allowTools === false ? [] : toolsFor(requestEnv);
  const stream = options.stream;

  const pendingAttachments: string[] = [];
  const local = await runOpenCodeAgent(requestEnv, options.prompt);
  if (local) {
    await stream?.onStatus?.("Writing…");
    await simulateStream(local.text, stream || { onDelta: async () => undefined });
    return local;
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await completeWithFallback(
      requestEnv,
      {
        messages,
        tools,
        maxTokens: MAX_TOKENS,
        temperature: 0.7,
      },
      stream,
    );

    if (!response.toolCalls.length) {
      if (stream && !response.streamed && response.content.trim()) {
        await stream.onStatus?.("Writing…");
        await simulateStream(response.content, stream);
      }
      return toResult(response, pendingAttachments);
    }

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      await stream?.onStatus?.(toolStatus(call.function.name));
      const result = await executeTool(requestEnv, options.scope, call);
      try {
        const parsed = JSON.parse(result) as { pending_attachment?: string };
        if (parsed?.pending_attachment) {
          pendingAttachments.push(parsed.pending_attachment);
        }
      } catch {
        // Plain-text tool result; nothing to attach.
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
    await stream?.onStatus?.("Thinking…");
  }

  messages.push({
    role: "user",
    content:
      "Do not call any more tools. Give your final answer now using the information above.",
  });

  const final = await completeWithFallback(
    requestEnv,
    {
      messages,
      tools: [],
      maxTokens: MAX_TOKENS,
      temperature: 0.7,
    },
    stream,
  );

  if (stream && !final.streamed && final.content.trim()) {
    await stream.onStatus?.("Writing…");
    await simulateStream(final.content, stream);
  }

  return toResult(final, pendingAttachments);
}
