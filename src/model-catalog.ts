import type { Env } from "./env";

export const PROVIDER_IDS = [
  "workers-ai",
  "openrouter",
  "groq",
  "gemini",
  "mistral",
  "ollama",
  "huggingface",
  "nvidia",
  "mrouter",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  baseUrl: string;
  keyEnv?: keyof Env;
  keyLabel: string;
  docsUrl: string;
  freeNote: string;
  requiresKey: boolean;
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  "workers-ai": {
    id: "workers-ai",
    name: "Cloudflare Workers AI",
    baseUrl: "",
    keyLabel: "Built-in binding",
    docsUrl: "https://developers.cloudflare.com/workers-ai/",
    freeNote: "10,000 Neurons/day on the Workers Free plan.",
    requiresKey: false,
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    keyLabel: "OpenRouter API key",
    docsUrl: "https://openrouter.ai/keys",
    freeNote: "Free models end in :free. 50 requests/day before a one-time credit purchase.",
    requiresKey: true,
    defaultModel: "openrouter/free",
  },
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    keyLabel: "Groq API key",
    docsUrl: "https://console.groq.com/keys",
    freeNote: "Free plan with per-model daily limits.",
    requiresKey: true,
    defaultModel: "llama-3.3-70b-versatile",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    keyLabel: "Gemini API key",
    docsUrl: "https://aistudio.google.com/apikey",
    freeNote: "Free tier for Flash and Gemma models with per-project limits.",
    requiresKey: true,
    defaultModel: "gemini-2.5-flash",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    keyLabel: "Mistral API key",
    docsUrl: "https://console.mistral.ai/api-keys/",
    freeNote: "Free plan includes monthly API credits and rate limits.",
    requiresKey: true,
    defaultModel: "mistral-small-latest",
  },
  ollama: {
    id: "ollama",
    name: "Ollama Cloud",
    baseUrl: "https://ollama.com",
    keyEnv: "OLLAMA_API_KEY",
    keyLabel: "Ollama API key",
    docsUrl: "https://ollama.com/settings/keys",
    freeNote: "Free plan with hourly/daily cloud usage limits.",
    requiresKey: true,
    defaultModel: "llama3.3:70b",
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    keyEnv: "HUGGINGFACE_API_KEY",
    keyLabel: "Hugging Face token",
    docsUrl: "https://huggingface.co/settings/tokens",
    freeNote: "Free accounts get a small monthly inference credit.",
    requiresKey: true,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    keyLabel: "NVIDIA API key",
    docsUrl: "https://build.nvidia.com/",
    freeNote: "Free developer tier with rate-limited NIM endpoints.",
    requiresKey: true,
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  mrouter: {
    id: "mrouter",
    name: "mrouter",
    baseUrl: "https://mrouter.csomeone301.workers.dev/v1",
    keyEnv: "MRROUTER_API_KEY",
    keyLabel: "mrouter API key",
    docsUrl: "https://mrouter.csomeone301.workers.dev/docs",
    freeNote: "OpenAI/Anthropic-compatible router. Probe-verified model chain; \"auto\" is the last resort.",
    requiresKey: true,
    defaultModel: "kilo-auto/free",
  },
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isKeyProviderId(value: string): value is ProviderId {
  return isProviderId(value) && PROVIDERS[value].requiresKey;
}

export interface FreeModel {
  provider: ProviderId;
  id: string;
  name: string;
  description: string;
  contextLength?: number;
  recommended?: boolean;
}

const STATIC_FREE_MODELS: FreeModel[] = [
  {
    provider: "mrouter",
    id: "kilo-auto/free",
    name: "Kilo free auto",
    description: "Best free model on Kilo's gateway (no gpt-oss).",
    recommended: true,
  },
  {
    provider: "mrouter",
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B",
    description: "Huge free Nemotron reasoning model.",
  },
  {
    provider: "mrouter",
    id: "openrouter/free",
    name: "OpenRouter free",
    description: "OpenRouter's free-pool auto model.",
  },
  {
    provider: "mrouter",
    id: "openai-fast",
    name: "LLM7 openai-fast",
    description: "Fast GPT-OSS-20B class model on the LLM7 gateway.",
  },
  {
    provider: "mrouter",
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "Nemotron 3.5 Super VL",
    description: "Vision-capable free Nemotron model.",
  },
  {
    provider: "mrouter",
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    description: "Pro Kimi model on Ollama Cloud.",
  },
  {
    provider: "mrouter",
    id: "minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash",
    description: "Fast MiniMax model on Ollama Cloud.",
  },
  {
    provider: "mrouter",
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    description: "Quick legal-tuned GLM model.",
  },
  {
    provider: "mrouter",
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    description: "Fast DeepSeek model on Ollama Cloud.",
  },
  {
    provider: "workers-ai",
    id: "@cf/openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    description: "Open model hosted by Cloudflare (fallback only).",
  },
  {
    provider: "workers-ai",
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B",
    description: "Fast general-purpose Llama model.",
    recommended: true,
  },
  {
    provider: "workers-ai",
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B",
    description: "Coding-focused Qwen model.",
  },
  {
    provider: "workers-ai",
    id: "@cf/meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B",
    description: "Small and fast Llama model.",
  },
  {
    provider: "workers-ai",
    id: "@cf/google/gemma-3-12b-it",
    name: "Gemma 3 12B",
    description: "Google Gemma instruction model.",
  },
  {
    provider: "openrouter",
    id: "openrouter/free",
    name: "OpenRouter Free Router",
    description: "Automatically routes to an available free model.",
    recommended: true,
  },
  {
    provider: "openrouter",
    id: "nvidia/nemotron-3-super:free",
    name: "Nemotron 3 Super",
    description: "NVIDIA free general-purpose model.",
    recommended: true,
  },
  {
    provider: "openrouter",
    id: "recursive/flint-v1.0:free",
    name: "Flint v1.0",
    description: "Free OpenRouter chat model.",
  },
  {
    provider: "openrouter",
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B",
    description: "Free Llama variant when available.",
  },
  {
    provider: "groq",
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    description: "Groq's fast GPT-OSS endpoint (fallback only).",
  },
  {
    provider: "groq",
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    description: "Smaller fast GPT-OSS model.",
  },
  {
    provider: "groq",
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    description: "Groq's general-purpose Llama 3.3 endpoint.",
    recommended: true,
  },
  {
    provider: "groq",
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    description: "Very fast small model.",
  },
  {
    provider: "groq",
    id: "qwen/qwen3-32b",
    name: "Qwen3 32B",
    description: "Qwen general-purpose model on Groq.",
  },
  {
    provider: "groq",
    id: "moonshotai/kimi-k2-instruct",
    name: "Kimi K2 Instruct",
    description: "Moonshot Kimi K2 on Groq.",
  },
  {
    provider: "gemini",
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast Gemini model with a large context window.",
    recommended: true,
  },
  {
    provider: "gemini",
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    description: "Low-latency Gemini model.",
    recommended: true,
  },
  {
    provider: "gemini",
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    description: "Previous-generation fast Gemini model.",
  },
  {
    provider: "gemini",
    id: "gemma-3-27b-it",
    name: "Gemma 3 27B",
    description: "Google Gemma instruction model.",
  },
  {
    provider: "mistral",
    id: "mistral-small-latest",
    name: "Mistral Small",
    description: "Balanced Mistral model.",
    recommended: true,
  },
  {
    provider: "mistral",
    id: "open-mistral-nemo",
    name: "Mistral NeMo",
    description: "Open Mistral model.",
  },
  {
    provider: "mistral",
    id: "ministral-8b-latest",
    name: "Ministral 8B",
    description: "Small Mistral model.",
  },
  {
    provider: "mistral",
    id: "ministral-3b-latest",
    name: "Ministral 3B",
    description: "Tiny Mistral model.",
  },
  {
    provider: "ollama",
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B",
    description: "Ollama Cloud GPT-OSS 20B (fallback only).",
  },
  {
    provider: "ollama",
    id: "gpt-oss:120b",
    name: "GPT-OSS 120B",
    description: "Ollama Cloud GPT-OSS 120B (fallback only).",
  },
  {
    provider: "ollama",
    id: "deepseek-v3.1:671b",
    name: "DeepSeek V3.1 671B",
    description: "Large DeepSeek model on Ollama Cloud.",
  },
  {
    provider: "ollama",
    id: "qwen3-coder:480b",
    name: "Qwen3 Coder 480B",
    description: "Coding-focused Qwen model.",
  },
  {
    provider: "ollama",
    id: "kimi-k2:1t",
    name: "Kimi K2 1T",
    description: "Moonshot Kimi K2 on Ollama Cloud.",
  },
  {
    provider: "huggingface",
    id: "meta-llama/Llama-3.3-70B-Instruct",
    name: "Llama 3.3 70B",
    description: "Llama 3.3 through Hugging Face inference providers.",
    recommended: true,
  },
  {
    provider: "huggingface",
    id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B",
    description: "Qwen 2.5 through Hugging Face.",
  },
  {
    provider: "huggingface",
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B",
    description: "Mistral 7B through Hugging Face.",
  },
  {
    provider: "huggingface",
    id: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    name: "DeepSeek R1 Distill 70B",
    description: "Reasoning model through Hugging Face.",
  },
  {
    provider: "nvidia",
    id: "meta/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    description: "Llama 3.3 on NVIDIA NIM.",
    recommended: true,
  },
  {
    provider: "nvidia",
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    name: "Nemotron 70B",
    description: "NVIDIA Nemotron model.",
  },
  {
    provider: "nvidia",
    id: "deepseek-ai/deepseek-r1",
    name: "DeepSeek R1",
    description: "DeepSeek reasoning model on NVIDIA NIM.",
  },
  {
    provider: "nvidia",
    id: "qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B",
    description: "Coding model on NVIDIA NIM.",
  },
];

const MODEL_CACHE_KEY = "model-catalog:free:v2";
const MODEL_CACHE_TTL = 6 * 60 * 60;

interface CachedCatalog {
  models: FreeModel[];
  updatedAt: number;
}

interface OpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

interface OpenAiModelList {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    context_length?: number;
    context_window?: number;
  }>;
}

interface GeminiModelList {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

function providerKey(env: Env, provider: ProviderId): string | undefined {
  const keyEnv = PROVIDERS[provider].keyEnv;
  if (!keyEnv) return undefined;
  const value = env[keyEnv];
  return typeof value === "string" && value ? value : undefined;
}

function looksLikeChatModel(id: string): boolean {
  return !/(embed|embedding|rerank|moderation|whisper|tts|audio|speech|image|vision-only|guard|classifier)/i.test(
    id,
  );
}

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverOpenRouter(): Promise<FreeModel[]> {
  const data = await fetchJson<{ data?: OpenRouterModel[] }>(
    "https://openrouter.ai/api/v1/models",
    { headers: { "X-Title": "Discord AI Bot" } },
  );
  if (!data?.data?.length) return [];

  return data.data
    .filter((model) => {
      if (!model.id || !looksLikeChatModel(model.id)) return false;
      const output = model.architecture?.output_modalities;
      if (Array.isArray(output) && !output.includes("text")) return false;
      const prompt = model.pricing?.prompt;
      const completion = model.pricing?.completion;
      return (
        model.id.endsWith(":free") ||
        (prompt === "0" && completion === "0")
      );
    })
    .map((model) => ({
      provider: "openrouter" as const,
      id: model.id as string,
      name: model.name || (model.id as string),
      description: model.description || "Free OpenRouter model.",
      contextLength: model.context_length,
    }))
    .slice(0, 80);
}

async function discoverGroq(env: Env): Promise<FreeModel[]> {
  const key = providerKey(env, "groq");
  if (!key) return [];
  const data = await fetchJson<OpenAiModelList>(
    "https://api.groq.com/openai/v1/models",
    { headers: { authorization: `Bearer ${key}` } },
  );
  return (data?.data ?? [])
    .filter((model) => model.id && looksLikeChatModel(model.id))
    .map((model) => ({
      provider: "groq" as const,
      id: model.id as string,
      name: model.id as string,
      description: "Model available on the Groq free plan.",
      contextLength: model.context_window ?? model.context_length,
    }))
    .slice(0, 50);
}

async function discoverMistral(env: Env): Promise<FreeModel[]> {
  const key = providerKey(env, "mistral");
  if (!key) return [];
  const data = await fetchJson<OpenAiModelList>(
    "https://api.mistral.ai/v1/models",
    { headers: { authorization: `Bearer ${key}` } },
  );
  return (data?.data ?? [])
    .filter((model) => model.id && looksLikeChatModel(model.id))
    .map((model) => ({
      provider: "mistral" as const,
      id: model.id as string,
      name: model.name || (model.id as string),
      description: "Model available on the Mistral free plan.",
    }))
    .slice(0, 50);
}

async function discoverGemini(env: Env): Promise<FreeModel[]> {
  const key = providerKey(env, "gemini");
  if (!key) return [];
  const data = await fetchJson<GeminiModelList>(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
  );
  return (data?.models ?? [])
    .filter((model) => {
      const id = model.name?.replace(/^models\//, "") ?? "";
      if (!id) return false;
      if (!model.supportedGenerationMethods?.includes("generateContent")) {
        return false;
      }
      if (!/(flash|gemma)/i.test(id)) return false;
      return !/embedding|aqa|imagen|veo|robotics/i.test(id);
    })
    .map((model) => {
      const id = (model.name as string).replace(/^models\//, "");
      return {
        provider: "gemini" as const,
        id,
        name: model.displayName || id,
        description: model.description || "Gemini free-tier model.",
        contextLength: model.inputTokenLimit,
      };
    })
    .slice(0, 50);
}

function mergeModels(models: FreeModel[]): FreeModel[] {
  const seen = new Set<string>();
  const merged: FreeModel[] = [];
  for (const model of models) {
    const key = `${model.provider}:${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(model);
  }
  const rank: Record<string, number> = {
    mrouter: 0,
    openrouter: 1,
    groq: 2,
    gemini: 3,
    mistral: 4,
    huggingface: 5,
    nvidia: 6,
    ollama: 7,
    "workers-ai": 8,
  };
  return merged.sort((a, b) => {
    if (a.provider !== b.provider) {
      return (rank[a.provider] ?? 9) - (rank[b.provider] ?? 9);
    }
    if (Boolean(a.recommended) !== Boolean(b.recommended)) {
      return a.recommended ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function readCachedCatalog(env: Env): Promise<FreeModel[] | null> {
  try {
    const raw = await env.CONVERSATIONS.get(MODEL_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedCatalog;
    if (!Array.isArray(cached.models) || !cached.models.length) return null;
    return cached.models;
  } catch {
    return null;
  }
}

async function writeCachedCatalog(
  env: Env,
  models: FreeModel[],
): Promise<void> {
  try {
    const cached: CachedCatalog = { models, updatedAt: Date.now() };
    await env.CONVERSATIONS.put(MODEL_CACHE_KEY, JSON.stringify(cached), {
      expirationTtl: MODEL_CACHE_TTL,
    });
  } catch {
    // Catalog caching is best-effort.
  }
}

export async function loadFreeModels(
  env: Env,
  options: { refresh?: boolean; provider?: ProviderId } = {},
): Promise<FreeModel[]> {
  const cached = options.refresh ? null : await readCachedCatalog(env);
  let models = cached;

  if (!models) {
    const discovered = await Promise.all([
      discoverOpenRouter(),
      discoverGroq(env),
      discoverMistral(env),
      discoverGemini(env),
    ]);
    models = mergeModels([...STATIC_FREE_MODELS, ...discovered.flat()]);
    await writeCachedCatalog(env, models);
  }

  if (options.provider) {
    return models.filter((model) => model.provider === options.provider);
  }
  return models;
}

export function findFreeModel(
  models: FreeModel[],
  provider: string,
  modelId: string,
): FreeModel | undefined {
  return models.find(
    (model) => model.provider === provider && model.id === modelId,
  );
}

export function providerForModelId(modelId: string): ProviderId | null {
  for (const model of STATIC_FREE_MODELS) {
    if (model.id === modelId) return model.provider;
  }
  if (modelId.startsWith("@cf/")) return "workers-ai";
  if (modelId.endsWith(":free") || modelId === "openrouter/free") {
    return "openrouter";
  }
  if (modelId.startsWith("gemini-") || modelId.startsWith("gemma-")) {
    return "gemini";
  }
  return null;
}
