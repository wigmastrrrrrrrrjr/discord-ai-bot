import type { Env } from "../env";
import { intVar } from "../env";

export class DeviceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceUnavailableError";
  }
}

export interface DeviceObject {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: number;
}

export function deviceConfigured(env: Env): boolean {
  return Boolean(env.DEVICE_BLOB_URL && env.DEVICE_BLOB_TOKEN);
}

function baseUrl(env: Env): string {
  return (env.DEVICE_BLOB_URL ?? "").replace(/\/+$/, "");
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function deviceRequest(
  env: Env,
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  if (!deviceConfigured(env)) {
    throw new DeviceUnavailableError("Device blob storage is not configured");
  }

  const timeout = timeoutMs ?? intVar(env.DEVICE_TIMEOUT_MS, 4000);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.DEVICE_BLOB_TOKEN}`);

  try {
    return await fetch(`${baseUrl(env)}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DeviceUnavailableError(
      `Device blob storage is unreachable: ${message}`,
    );
  }
}

export async function deviceHealth(env: Env): Promise<boolean> {
  if (!deviceConfigured(env)) return false;
  try {
    const timeout = Math.min(intVar(env.DEVICE_TIMEOUT_MS, 4000), 2500);
    const response = await deviceRequest(env, "/health", { method: "GET" }, timeout);
    return response.ok;
  } catch {
    return false;
  }
}

export async function devicePut(
  env: Env,
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await deviceRequest(env, `/objects/${encodeKey(key)}`, {
    method: "PUT",
    headers: { "content-type": contentType || "application/octet-stream" },
    body: data as unknown as BodyInit,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new DeviceUnavailableError(
      `Device PUT failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
}

export async function deviceGet(
  env: Env,
  key: string,
): Promise<{ data: Uint8Array; contentType: string } | null> {
  const response = await deviceRequest(env, `/objects/${encodeKey(key)}`, {
    method: "GET",
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new DeviceUnavailableError(
      `Device GET failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  return {
    data: new Uint8Array(await response.arrayBuffer()),
    contentType:
      response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function deviceHead(
  env: Env,
  key: string,
): Promise<{ size: number; contentType?: string } | null> {
  const response = await deviceRequest(env, `/objects/${encodeKey(key)}`, {
    method: "HEAD",
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DeviceUnavailableError(
      `Device HEAD failed (${response.status})`,
    );
  }

  const length = Number(response.headers.get("content-length"));
  return {
    size: Number.isFinite(length) ? length : 0,
    contentType: response.headers.get("content-type") ?? undefined,
  };
}

export async function deviceDelete(env: Env, key: string): Promise<boolean> {
  const response = await deviceRequest(env, `/objects/${encodeKey(key)}`, {
    method: "DELETE",
  });

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new DeviceUnavailableError(
      `Device DELETE failed (${response.status})`,
    );
  }
  return true;
}

export async function deviceList(
  env: Env,
  prefix: string,
  limit = 500,
): Promise<DeviceObject[]> {
  const query = new URLSearchParams({ prefix, limit: String(limit) });
  const response = await deviceRequest(env, `/objects?${query}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new DeviceUnavailableError(
      `Device LIST failed (${response.status})`,
    );
  }

  const data = (await response.json()) as {
    objects?: Array<{
      key?: unknown;
      size?: unknown;
      contentType?: unknown;
      lastModified?: unknown;
    }>;
  };

  if (!Array.isArray(data.objects)) return [];

  return data.objects
    .filter(
      (item): item is { key: string; size?: number; contentType?: string; lastModified?: number } =>
        typeof item.key === "string",
    )
    .map((item) => ({
      key: item.key,
      size: typeof item.size === "number" ? item.size : 0,
      contentType:
        typeof item.contentType === "string" ? item.contentType : undefined,
      lastModified:
        typeof item.lastModified === "number" ? item.lastModified : undefined,
    }));
}
