import type { Env } from "../env";
import {
  geminiProvider,
  groqProvider,
  huggingFaceProvider,
  mistralProvider,
  mrouterProvider,
  nvidiaProvider,
  ollamaProvider,
  openRouterProvider,
} from "./providers/openai-compatible";
import { workersAiProvider } from "./providers/workers-ai";
import type {
  AiProvider,
  ChatRequest,
  ChatResponse,
  StreamHandlers,
} from "./types";

const PROVIDERS: Record<string, AiProvider> = {
  "workers-ai": workersAiProvider,
  openrouter: openRouterProvider,
  ollama: ollamaProvider,
  groq: groqProvider,
  gemini: geminiProvider,
  mistral: mistralProvider,
  huggingface: huggingFaceProvider,
  nvidia: nvidiaProvider,
  mrouter: mrouterProvider,
};

const DEFAULT_ORDER = ["mrouter", "openrouter", "ollama", "workers-ai"];
const COOLDOWN_SECONDS = 60;

export interface ProviderAttempt {
  provider: string;
  error: string;
}

export class ProviderError extends Error {
  constructor(public readonly attempts: ProviderAttempt[]) {
    super(
      `All AI providers failed: ${attempts
        .map((attempt) => `${attempt.provider}: ${attempt.error}`)
        .join(" | ")}`,
    );
    this.name = "ProviderError";
  }
}

export function providerOrder(env: Env): string[] {
  const configured = (env.AI_PROVIDER_ORDER ?? DEFAULT_ORDER.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORDER;
}

export async function completeWithModel(
  env: Env,
  providerId: string,
  modelId: string,
  request: ChatRequest,
  handlers?: StreamHandlers,
): Promise<ChatResponse> {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!provider.isConfigured(env)) {
    throw new Error(`${providerId} is not configured`);
  }

  const modelRequest: ChatRequest = { ...request, model: modelId };
  const response =
    provider.stream && handlers
      ? await provider.stream(env, modelRequest, handlers)
      : await provider.complete(env, modelRequest);

  if (!response.content && response.toolCalls.length === 0) {
    throw new Error("empty response");
  }
  return response;
}

export async function completeWithFallback(
  env: Env,
  request: ChatRequest,
  handlers?: StreamHandlers,
): Promise<ChatResponse> {
  const attempts: ProviderAttempt[] = [];

  for (const id of providerOrder(env)) {
    const provider = PROVIDERS[id];
    if (!provider) {
      attempts.push({ provider: id, error: "unknown provider" });
      continue;
    }
    if (!provider.isConfigured(env)) {
      attempts.push({ provider: id, error: "not configured" });
      continue;
    }

    const cooldownKey = `provider-cooldown:${id}`;
    try {
      const cooldown = await env.CONVERSATIONS.get(cooldownKey);
      if (cooldown) {
        attempts.push({
          provider: id,
          error: `cooling down after: ${cooldown.slice(0, 160)}`,
        });
        continue;
      }
    } catch {
      // KV is best-effort here; a KV failure should not block inference.
    }

    let emitted = false;
    const streamHandlers: StreamHandlers | undefined = handlers
      ? {
          onDelta: async (text) => {
            emitted = true;
            await handlers.onDelta?.(text);
          },
          onReasoning: handlers.onReasoning,
          onStatus: handlers.onStatus,
        }
      : undefined;
    const canStream =
      Boolean(provider.stream && streamHandlers) &&
      (!request.tools?.length || provider.supportsStreamingTools === true);

    try {
      const response =
        canStream && provider.stream
          ? await provider.stream(env, request, streamHandlers!)
          : await provider.complete(env, request);
      if (!response.content && response.toolCalls.length === 0) {
        throw new Error("empty response");
      }
      try {
        await env.CONVERSATIONS.delete(cooldownKey);
      } catch {
        // Best-effort.
      }
      return {
        ...response,
        streamed: response.streamed ?? emitted,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ provider: id, error: message.slice(0, 400) });
      try {
        await env.CONVERSATIONS.put(cooldownKey, message.slice(0, 200), {
          expirationTtl: COOLDOWN_SECONDS,
        });
      } catch {
        // Best-effort.
      }
      if (emitted) throw error;
    }
  }

  throw new ProviderError(attempts);
}
