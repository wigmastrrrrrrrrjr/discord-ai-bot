import type { Env } from "./env";

export const V2_BETA_FOOTER = "v2 beta test, bound to change";

export interface V2Result {
  ok: boolean;
  output: string;
  exit?: number;
  path?: string;
  bytes?: number;
}

async function v2Post(
  env: Env,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<V2Result> {
  const base = env.V2_AGENT_URL ?? "";
  const token = env.V2_AGENT_TOKEN ?? "";
  if (!base || !token) {
    throw new Error(
      "theaichatbot v2 is not bound. The owner must set V2_AGENT_URL and V2_AGENT_TOKEN.",
    );
  }
  const url = `${base.replace(/\/+$/, "")}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`v2 agent HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as V2Result;
}

export function v2Exec(env: Env, command: string): Promise<V2Result> {
  return v2Post(env, "/v2/command", { command });
}

export function v2WriteFile(
  env: Env,
  path: string,
  content: string,
): Promise<V2Result> {
  return v2Post(env, "/v2/file", { path, content });
}

export async function v2Health(env: Env): Promise<boolean> {
  try {
    const response = await fetch(
      `${(env.V2_AGENT_URL ?? "").replace(/\/+$/, "")}/v2/health`,
      { headers: { authorization: `Bearer ${env.V2_AGENT_TOKEN ?? ""}` } },
    );
    if (!response.ok) return false;
    const parse = (await response.json()) as { ok?: boolean };
    return parse.ok === true;
  } catch {
    return false;
  }
}
