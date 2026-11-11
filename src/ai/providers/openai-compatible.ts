import type { Env } from "../../env";
import { readSse } from "../sse";
import type {
  AiProvider,
  ChatRequest,
  ChatResponse,
  StreamHandlers,
  ToolCall,
} from "../types";
import { workersAiProvider } from "./workers-ai";

interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
}

interface ProviderOptions {
  id: string;
  isConfigured: (env: Env) => boolean;
  getConfig: (env: Env) => ProviderConfig;
  /**
   * Optional candidate models tried in order when the caller does not pin a
   * specific model. First candidate that produces a usable response wins.
   * Used to keep flaky gateways from breaking chats.
   */
  modelChain?: string[];
}

export function getServiceBinding(
  env: Env,
  providerId: string,
): { fetch(url: Request): Promise<Response> } | undefined {
  const key = `${providerId.toUpperCase().replace(/-/g, "_")}_SERVICE`;
  const binding = (env as unknown as Record<string, unknown>)[key];
  if (
    binding &&
    typeof binding === "object" &&
    "fetch" in binding &&
    typeof (binding as { fetch?: unknown }).fetch === "function"
  ) {
    return binding as { fetch(url: Request): Promise<Response> };
  }
  return undefined;
}

function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  if (base.endsWith("/openai")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function normalizeToolCall(call: unknown, index: number): ToolCall {
  const value = call as {
    id?: string;
    function?: { name?: string; arguments?: unknown };
    name?: string;
    arguments?: unknown;
  };
  const name = value.function?.name ?? value.name ?? "";
  const rawArgs = value.function?.arguments ?? value.arguments ?? {};
  return {
    id: value.id ?? `call_${index}`,
    type: "function",
    function: {
      name,
      arguments:
        typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
    },
  };
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function requestBody(
  config: ProviderConfig,
  request: ChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model || config.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? 1200,
  };

  if (request.tools?.length) {
    body.tools = request.tools;
    if (config.baseUrl.includes("ollama.com")) {
      // Ollama Cloud has issues with some tool_choice values
    } else {
      body.tool_choice = "auto";
    }
  }

  if (stream) body.stream = true;
  return body;
}

function requestHeaders(config: ProviderConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
    ...config.headers,
  };
}

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

function mergeToolDelta(
  calls: Map<number, PartialToolCall>,
  raw: unknown,
  fallbackIndex: number,
): void {
  const call = raw as {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: unknown };
    name?: string;
    arguments?: unknown;
  };
  const index =
    typeof call.index === "number" ? call.index : fallbackIndex;
  const current = calls.get(index) ?? { id: "", name: "", arguments: "" };

  if (typeof call.id === "string" && call.id) current.id = call.id;

  const name = call.function?.name ?? call.name;
  if (typeof name === "string" && name) current.name = name;

  const args = call.function?.arguments ?? call.arguments;
  if (typeof args === "string") current.arguments += args;
  else if (args != null) current.arguments += JSON.stringify(args);

  calls.set(index, current);
}

export function createOpenAiCompatibleProvider(
  options: ProviderOptions,
): AiProvider {
  async function post(
    env: Env,
    request: ChatRequest,
    stream: boolean,
    _userId?: string,
  ): Promise<{ response: Response; config: ProviderConfig }> {
    const config = options.getConfig(env);

    let body = requestBody(config, request, stream);
    // Ollama Cloud sometimes rejects extra fields
    if (options.id === "ollama" && Array.isArray((body as any).tools) && (body as any).tools.length) {
      delete (body as any).tool_choice;
    }
    // Also remove tool_choice for openrouter if causing issues
    if ((options.id === "openrouter" || options.id === "ollama") && (body as any).tool_choice) {
      delete (body as any).tool_choice;
    }

    const serviceBinding = getServiceBinding(env, options.id);

    // A pinned model (anything the caller explicitly set) is tried exactly
    // once. Without one — or with the chain's head — walk down modelChain.
    const chain = request.modelChain?.length
      ? request.modelChain
      : !request.model || request.model === (options.modelChain?.[0] ?? "")
        ? options.modelChain
        : undefined;
    const candidates = chain?.length ? chain : [body.model as string];

    let lastError = "";
    for (const candidate of candidates) {
      const attempt = { ...body, model: candidate };
      let response: Response;
      try {
        const target = chatCompletionsUrl(config.baseUrl);
        if (serviceBinding) {
          // External fetches to another same-account worker get 404 at the
          // edge; a service binding routes the call internally instead.
          response = await serviceBinding.fetch(
            new Request(target, {
              method: "POST",
              headers: requestHeaders(config),
              body: JSON.stringify(attempt),
            }),
          );
        } else {
          response = await fetch(target, {
            method: "POST",
            headers: requestHeaders(config),
            body: JSON.stringify(attempt),
          });
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
      const raw = await response.text();
      if (!response.ok) {
        lastError = `${options.id} ${response.status}: ${raw.slice(0, 200)}`;
        continue;
      }
      // Some gateways answer HTTP 200 with a JSON error envelope.
      if (raw.startsWith('{"error"') || raw.includes('"error":"')) {
        lastError = raw.slice(0, 200);
        continue;
      }
      if (stream && !raw.includes("data:")) {
        lastError = raw.slice(0, 200);
        continue;
      }
      return {
        response: new Response(raw, {
          status: response.status,
          headers: response.headers,
        }),
        config: { ...config, model: candidate },
      };
    }

    throw new Error(
      `${options.id}: all model candidates failed. Last: ${lastError.slice(0, 300)}`,
    );
  }

  return {
    id: options.id,
    isConfigured: options.isConfigured,
    supportsStreamingTools: true,

    async complete(env: Env, request: ChatRequest): Promise<ChatResponse> {
      const { response, config } = await post(env, request, false);

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            tool_calls?: unknown[];
          };
        }>;
      };

      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new Error(`${options.id}: unexpected response shape`);
      }

      return {
        content: normalizeContent(message.content),
        toolCalls: Array.isArray(message.tool_calls)
          ? message.tool_calls.map(normalizeToolCall)
          : [],
        provider: options.id,
        model: request.model || config.model,
      };
    },

    async stream(
      env: Env,
      request: ChatRequest,
      handlers: StreamHandlers,
    ): Promise<ChatResponse> {
      const { response, config } = await post(env, request, true);
      let content = "";
      const calls = new Map<number, PartialToolCall>();

      for await (const raw of readSse(response.body)) {
        if (raw === "[DONE]") break;

        let data: {
          error?: unknown;
          choices?: Array<{
            delta?: {
              content?: unknown;
              reasoning?: unknown;
              reasoning_content?: unknown;
              thinking?: unknown;
              tool_calls?: unknown[];
            };
            message?: {
              content?: unknown;
              tool_calls?: unknown[];
            };
          }>;
        };
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          continue;
        }

        if (data.error) {
          throw new Error(
            `${options.id}: ${JSON.stringify(data.error).slice(0, 400)}`,
          );
        }

        const choice = data.choices?.[0];
        const delta = choice?.delta;
        const message = choice?.message;

        const text = normalizeContent(delta?.content ?? message?.content);
        if (text) {
          content += text;
          await handlers.onDelta?.(text);
        }

        const reasoning = normalizeContent(
          delta?.reasoning ??
            delta?.reasoning_content ??
            delta?.thinking,
        );
        if (reasoning) await handlers.onReasoning?.(reasoning);

        const toolCalls = delta?.tool_calls ?? message?.tool_calls;
        if (Array.isArray(toolCalls)) {
          toolCalls.forEach((call, index) =>
            mergeToolDelta(calls, call, index),
          );
        }
      }

      return {
        content,
        toolCalls: [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => ({
            id: call.id || `call_${index}`,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: call.arguments || "{}",
            },
          })),
        provider: options.id,
        model: request.model || config.model,
        streamed: true,
      };
    },
  };
}

export const openRouterProvider = createOpenAiCompatibleProvider({
  id: "openrouter",
  isConfigured: (env) => Boolean(env.OPENROUTER_API_KEY),
  getConfig: (env) => ({
    apiKey: env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1",
    model: env.OPENROUTER_MODEL || "openrouter/free",
    headers: {
      "X-Title": "Discord AI Bot",
    },
  }),
  // Free models only — this fallback account has no purchased credits,
  // so paid candidates would always 402.
  modelChain: [
    "openrouter/free",
    "baidu/ernie-5.5-flash-preview:free",
    "nvidia/nemotron-3.5-super-vl:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-31b-it:free",
  ],
});

export const ollamaProvider = createOpenAiCompatibleProvider({
  id: "ollama",
  isConfigured: (env) => Boolean(env.OLLAMA_API_KEY),
  getConfig: (env) => ({
    apiKey: env.OLLAMA_API_KEY ?? "",
    baseUrl: env.OLLAMA_BASE_URL || "https://ollama.com",
    model: env.OLLAMA_MODEL || "glm-5.3-flash:cloud",
  }),
});

export const groqProvider = createOpenAiCompatibleProvider({
  id: "groq",
  isConfigured: (env) => Boolean(env.GROQ_API_KEY),
  getConfig: (env) => ({
    apiKey: env.GROQ_API_KEY ?? "",
    baseUrl: "https://api.groq.com/openai/v1",
    model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
  }),
});

export const geminiProvider = createOpenAiCompatibleProvider({
  id: "gemini",
  isConfigured: (env) => Boolean(env.GEMINI_API_KEY),
  getConfig: (env) => ({
    apiKey: env.GEMINI_API_KEY ?? "",
    baseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai",
    model: env.GEMINI_MODEL || "gemini-2.5-flash",
  }),
});

export const mistralProvider = createOpenAiCompatibleProvider({
  id: "mistral",
  isConfigured: (env) => Boolean(env.MISTRAL_API_KEY),
  getConfig: (env) => ({
    apiKey: env.MISTRAL_API_KEY ?? "",
    baseUrl: "https://api.mistral.ai/v1",
    model: env.MISTRAL_MODEL || "mistral-small-latest",
  }),
});

export const huggingFaceProvider = createOpenAiCompatibleProvider({
  id: "huggingface",
  isConfigured: (env) => Boolean(env.HUGGINGFACE_API_KEY),
  getConfig: (env) => ({
    apiKey: env.HUGGINGFACE_API_KEY ?? "",
    baseUrl: "https://router.huggingface.co/v1",
    model: env.HUGGINGFACE_MODEL || "meta-llama/Llama-3.3-70B-Instruct",
  }),
});

const MRROUTER_BASE_URL = "https://mrouter.csomeone301.workers.dev/v1";

// Probe-verified chain (Nov 2026), best first. Everything empty at the top of
// the auto queue is avoided here; "auto" (which leads with gpt-oss) is the
// last-resort candidate only.
const MRROUTER_MODEL_CHAIN = [
  "kilo-auto/free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/free",
  "openai-fast",
  "nvidia/nemotron-3.5-super-vl:free",
  "nemotron-3-nano:30b",
  "kimi-k3.1-pro",
  "minimax-m3.1-flash",
  "glm-5.3-flash",
  "deepseek-v4.1-flash",
  "auto",
];

export const mrouterProvider = createOpenAiCompatibleProvider({
  id: "mrouter",
  isConfigured: (env) => Boolean(env.MRROUTER_API_KEY),
  getConfig: (env) => ({
    apiKey: env.MRROUTER_API_KEY ?? "",
    baseUrl: MRROUTER_BASE_URL,
    model: env.MRROUTER_MODEL || MRROUTER_MODEL_CHAIN[0],
  }),
  modelChain: MRROUTER_MODEL_CHAIN,
});

export const nvidiaProvider = createOpenAiCompatibleProvider({
  id: "nvidia",
  isConfigured: (env) => Boolean(env.NVIDIA_API_KEY),
  getConfig: (env) => ({
    apiKey: env.NVIDIA_API_KEY ?? "",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
  }),
});
