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
  error?: string;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trim();
}

// The formatted `opencode run` output echoes a model header line like
// "> build · iceman-free"; the reply is everything after it.
function extractReply(raw: string): string {
  const text = stripAnsi(raw);
  const lines = text.split("\n");
  const headerIdx = lines.findIndex((line) => /^\s*>\s*build\b/.test(line));
  const reply = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
  return reply.join("\n").trim();
}

export function opencodeConfigured(env: Env): boolean {
  return Boolean(env.V2_AGENT_URL && env.V2_AGENT_TOKEN);
}

export async function runOpencodeAgent(
  env: Env,
  options: {
    sessionKey: string;
    prompt: string;
    timeoutSeconds?: number;
  },
): Promise<OpencodeRunResult> {
  const base = (env.V2_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = env.V2_AGENT_TOKEN ?? "";
  if (!base || !token) {
    return { ok: false, output: "", error: "v2 agent is not bound (V2_AGENT_URL/V2_AGENT_TOKEN missing)" };
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
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, output: "", error: `opencode bridge HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    const data = (await response.json()) as {
      output?: string;
      seconds?: number;
      session?: string;
      exit_err?: string;
    };
    const reply = extractReply(data.output ?? "");
    if (!reply && data.exit_err) {
      return { ok: false, output: "", error: `opencode: ${data.exit_err.slice(0, 300)}` };
    }
    return {
      ok: reply.length > 0,
      output: reply,
      seconds: data.seconds,
      session: data.session,
      error: reply ? undefined : "opencode returned an empty reply",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: "",
      error: message.includes("abort")
        ? "the agent v2 run timed out"
        : `v2 agent unreachable: ${message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Session keys become directory names on the bridge machine.
export function opencodeSessionKey(scope: string): string {
  return scope.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60) || "default";
}
