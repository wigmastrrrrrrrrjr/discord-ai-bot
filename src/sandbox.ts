import type { Env } from "./env";
import { intVar } from "./env";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;

export interface SandboxExecResult {
  output: string;
  exitCode: number | null;
  error?: string;
  truncated?: boolean;
  full_output?: string;
  saved_to?: string;
}

export interface SandboxReadFileResult {
  output: string;
}

export interface SandboxWriteFileResult {
  ok: boolean;
  path: string;
  bytes: number;
}

export interface SandboxUploadResult {
  url: string;
  temporary: boolean;
}

export interface SandboxDownloadResult {
  ok: boolean;
  path: string;
  bytes: number;
}

export interface SandboxServiceUrlResult {
  url: string;
  port: number;
}

function baseUrl(env: Env): string {
  return (env.SANDBOX_URL || "").replace(/\/+$/, "");
}

function clampTimeout(env: Env, value?: number): number {
  const fallback = intVar(env.SANDBOX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(Math.max(1_000, timeout), MAX_TIMEOUT_MS);
}

async function request<T>(
  env: Env,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);

  try {
    const response = await fetch(`${baseUrl(env)}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Sandbox ${path} failed (${response.status}): ${text.slice(0, 500)}`,
      );
    }

    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Sandbox ${path} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return request<T>(
    env,
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

export async function sandboxExec(
  env: Env,
  command: string,
  timeout?: number,
): Promise<SandboxExecResult> {
  const timeoutMs = clampTimeout(env, timeout);
  return post<SandboxExecResult>(
    env,
    "/api/exec",
    { command, timeout: timeoutMs },
    timeoutMs,
  );
}

export async function sandboxReadFile(
  env: Env,
  path: string,
): Promise<SandboxReadFileResult> {
  return post<SandboxReadFileResult>(
    env,
    "/api/readfile",
    { path },
    clampTimeout(env),
  );
}

export async function sandboxWriteFile(
  env: Env,
  path: string,
  content: string,
): Promise<SandboxWriteFileResult> {
  return post<SandboxWriteFileResult>(
    env,
    "/api/writefile",
    { path, content },
    clampTimeout(env),
  );
}

export async function sandboxUpload(
  env: Env,
  path: string,
): Promise<SandboxUploadResult> {
  return post<SandboxUploadResult>(
    env,
    "/api/upload",
    { path },
    clampTimeout(env),
  );
}

export async function sandboxDownload(
  env: Env,
  url: string,
  path?: string,
): Promise<SandboxDownloadResult> {
  return post<SandboxDownloadResult>(
    env,
    "/api/download",
    path ? { url, path } : { url },
    clampTimeout(env),
  );
}

export async function sandboxServiceUrl(
  env: Env,
  port: number,
): Promise<SandboxServiceUrlResult> {
  return request<SandboxServiceUrlResult>(
    env,
    `/api/serviceurl?port=${encodeURIComponent(String(port))}`,
    { method: "GET" },
    clampTimeout(env),
  );
}
