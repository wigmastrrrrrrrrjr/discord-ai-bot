import type { Env } from "./env";

// Agent V2: runs the REAL opencode agent (provider: iceman-free, temporarily
// unlimited) on the owner's machine, reached through the V2 cloudflared
// tunnel. Each conversation gets its own session directory, and opencode
// manages its own session history and tools.

export const V2_BETA_NOTICE = "Agent V2 beta, bound to change.";
export const V1_SUNSET_NOTICE = "Agent V1 is getting sunset on June 1st 2027.";

interface OpencodeRunResult {
  ok: boolean;
  output: string;
  seconds?: number;
  session?: string;
  model?: string;
  error?: string;
}

interface OpencodeStreamOptions {
  sessionKey: string;
  prompt: string;
  timeoutSeconds?: number;
  onDelta?: (text: string) => void | Promise<void>;
  onModel?: (model: string) => void | Promise<void>;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "");
}

// Lines opencode prints as status chrome, not reply content.
function isChromeLine(line: string): boolean {
  return /^\s*>\s*\S/.test(line) || /^\s*Error:\s/.test(line) || line.trim() === "";
}

// The formatted `opencode run` output echoes a model header line like
// "> build · iceman-free"; the reply is everything after it.
function extractReply(raw: string): string {
  const text = stripAnsi(raw);
  const lines = text.split("\n");
  const headerIdx = lines.findIndex((line) => /^\s*>\s*build\b/.test(line));
  const reply = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
  return reply
    .filter((line) => !/^\s*Error:\s/.test(line))
    .join("\n")
    .trim();
}

export function opencodeConfigured(env: Env): boolean {
  return Boolean(env.V2_AGENT_URL && env.V2_AGENT_TOKEN);
}

async function streamBridge(
  env: Env,
  options: OpencodeStreamOptions,
  handle: (record: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const base = (env.V2_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = env.V2_AGENT_TOKEN ?? "";
  if (!base || !token) {
    throw new Error("v2 agent is not bound (V2_AGENT_URL/V2_AGENT_TOKEN missing)");
  }
  const controller = new AbortController();
  const timeoutMs = Math.max((options.timeoutSeconds ?? 10) * 1000, 60_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/opencode/run`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: options.prompt,
        session: options.sessionKey,
        timeout: Math.min(Math.floor(timeoutMs / 1000), 600),
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`opencode bridge HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        await handle(record);
        if (record.done) return;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function runOpencodeAgent(
  env: Env,
  options: OpencodeStreamOptions,
): Promise<OpencodeRunResult> {
  let chunks = "";
  let model: string | undefined;
  let exitErr = "";
  let sawDone = false;
  let transportError: string | null = null;
  try {
    await streamBridge(env, options, async (record) => {
      if (typeof record.t === "string") {
        chunks += stripAnsi(record.t);
        const clean = stripAnsi(record.t);
        if (options.onDelta && !/^\s*>\s*build\b/.test(clean) && !/^\s*Error:\s/.test(clean)) {
          const filtered = clean.split("\n").filter((line) => !isChromeLine(line));
          const joined = filtered.join("\n");
          if (joined.trim()) await options.onDelta(joined + "\n");
        }
      }
      if (typeof record.model === "string") {
        model = record.model;
        if (options.onModel) await options.onModel(record.model);
      }
      if (typeof record.exit_err === "string") exitErr = record.exit_err;
      if (record.done) sawDone = true;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    transportError = message.includes("abort")
      ? "the agent v2 run timed out"
      : `v2 agent unreachable: ${message.slice(0, 200)}`;
  }

  const reply = extractReply(chunks);
  if (reply) {
    return { ok: true, output: reply, seconds: undefined, session: undefined, model };
  }
  return {
    ok: false,
    output: "",
    model,
    error:
      transportError ??
      (exitErr ? `opencode: ${exitErr.slice(0, 300)}` : "opencode returned an empty reply"),
  };
}

// Session keys become directory names on the bridge machine.
export function opencodeSessionKey(scope: string): string {
  return scope.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60) || "default";
}

