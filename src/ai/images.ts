import type { Env } from "../env";

export interface GeneratedImage {
  base64: string;
  mime: string;
  model: string;
}

import { MRROUTER_IMAGE_BASE } from "./router-vars";
import { getServiceBinding } from "./providers/openai-compatible";

function mrouterFetch(
  env: Env,
  target: string,
  init: RequestInit,
): Promise<Response> {
  const binding = getServiceBinding(env, "mrouter");
  if (binding) return binding.fetch(new Request(target, init));
  return fetch(target, init);
}

export const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const DETAILED_IMAGE_MODEL = "@cf/stability-ai/stable-diffusion-xl-base-1.0";

/**
 * Text-to-image straight through the Worker's own Workers AI binding —
 * no external router involved.
 */
export async function generateImage(
  env: Env,
  prompt: string,
  style = "fast",
): Promise<GeneratedImage> {
  if (!env.AI) {
    throw new Error("Image generation is not configured for this worker.");
  }

  const model = style === "detailed" ? DETAILED_IMAGE_MODEL : DEFAULT_IMAGE_MODEL;
  const started = Date.now();

  let result;
  try {
    result = await env.AI.run(model, {
      prompt: prompt.slice(0, 1000),
      steps: style === "detailed" ? 20 : 4,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (env.MRROUTER_API_KEY) {
      return generateViaRouter(env, prompt, message);
    }
    throw new Error(`Image generation failed: ${message}. Try again in a moment.`);
  }

  // Workers AI returns either a ReadableStream of image bytes or a JSON body
  // with base64 data, depending on the model.
  const buffer = await imageBytes(result);
  if (!buffer.length) {
    throw new Error("Image generation returned no usable data.");
  }

  const mime =
    model.includes("flux") || buffer.length < 4 ? "image/png" : "image/jpeg";

  return {
    base64: bytesToBase64(buffer),
    mime,
    model: `${model} (${Date.now() - started}ms)`,
  };
}

async function imageBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = result.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(new Uint8Array(value));
    }
    return concat(chunks);
  }

  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;

  if (result && typeof result === "object") {
    const payload = result as {
      image?: string;
      png?: string;
      contentType?: string;
      pdf?: string;
    };
    const b64 = payload.image ?? payload.png ?? "";
    if (b64) return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  return new Uint8Array();
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function generateViaRouter(
  env: Env,
  prompt: string,
  localError: string,
): Promise<GeneratedImage> {
  const apiKey = env.MRROUTER_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      localError.includes("neurons")
        ? "Daily Workers AI image budget is used up; ask the admin to try again tomorrow or add a router key."
        : `Image generation failed: ${localError}`,
    );
  }
  const payloadJson = JSON.stringify({ prompt: prompt.slice(0, 1000) });
  const response = await mrouterFetch(env, `${MRROUTER_IMAGE_BASE}/images/generations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: payloadJson,
  });
  if (!response.ok) {
    throw new Error(`/v1/images/generations HTTP ${response.status}`);
  }
  const raw = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("application/json") && !raw.includes('"data"')) {
    throw new Error(`No image data. ${raw.slice(0, 120)}`);
  }
  const payload = JSON.parse(raw) as {
    model?: string;
    data?: Array<{ url?: string }>;
  };
  const url = payload.data?.[0]?.url ?? "";
  if (!url.startsWith("data:")) {
    throw new Error(`No data URL. Got: ${raw.slice(0, 200)}`);
  }
  const [header, body] = url.split(",", 2);
  const mime = header.split(":")[1]?.split(";")[0] || "image/png";
  const bytes = Uint8Array.from(atob(body ?? ""), (c) => c.charCodeAt(0));
  return { base64: bytesToBase64(bytes), mime, model: payload.model ?? "mrouter-flux" };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + chunkSize) as unknown as number[]),
    );
  }
  return btoa(binary);
}
