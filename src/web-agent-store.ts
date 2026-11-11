import type { Env } from "./env";
import { encryptPayload, decryptPayload } from "./web-agent-auth";

// Every web-agent session payload is AES-GCM encrypted before KV storage.

export interface WebAgentMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
}

export interface WebAgentSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: WebAgentMessage[];
}

function secret(env: Env): string {
  return env.WEB_SESSION_SECRET ?? "unconfigured";
}

function indexKey(userId: string): string {
  return `webagent-idx:${userId}`;
}

function dataKey(userId: string, sessionId: string): string {
  return `webagent:${userId}:${sessionId}`;
}

export async function listSessions(
  env: Env,
  userId: string,
): Promise<WebAgentSessionMeta[]> {
  try {
    const blob = await env.CONVERSATIONS.get(indexKey(userId));
    if (!blob) return [];
    const json = await decryptPayload(secret(env), blob);
    if (!json) return [];
    const parsed = JSON.parse(json) as WebAgentSessionMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveIndex(
  env: Env,
  userId: string,
  sessions: WebAgentSessionMeta[],
): Promise<void> {
  const blob = await encryptPayload(secret(env), JSON.stringify(sessions));
  await env.CONVERSATIONS.put(indexKey(userId), blob);
}

export async function loadSession(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<WebAgentSession | null> {
  try {
    const blob = await env.CONVERSATIONS.get(dataKey(userId, sessionId));
    if (!blob) return null;
    const json = await decryptPayload(secret(env), blob);
    if (!json) return null;
    return JSON.parse(json) as WebAgentSession;
  } catch {
    return null;
  }
}

export async function saveSession(
  env: Env,
  userId: string,
  session: WebAgentSession,
): Promise<void> {
  const blob = await encryptPayload(
    secret(env),
    JSON.stringify({
      ...session,
      messages: session.messages.slice(-100),
    }),
  );
  await env.CONVERSATIONS.put(dataKey(userId, session.id), blob, {
    expirationTtl: 180 * 24 * 3600,
  });
  const index = await listSessions(env, userId);
  const meta: WebAgentSessionMeta = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  const withoutOld = index.filter((item) => item.id !== session.id);
  const next = [meta, ...withoutOld].sort((a, b) => b.updatedAt - a.updatedAt);
  await saveIndex(env, userId, next.slice(0, 50));
}

export async function createSession(
  env: Env,
  userId: string,
  title = "New chat",
): Promise<WebAgentSession> {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: title.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export async function deleteSession(
  env: Env,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const index = await listSessions(env, userId);
  if (!index.some((item) => item.id === sessionId)) return false;
  await env.CONVERSATIONS.delete(dataKey(userId, sessionId));
  await saveIndex(
    env,
    userId,
    index.filter((item) => item.id !== sessionId),
  );
  return true;
}

export function titleFromPrompt(prompt: string): string {
  return (
    prompt.replace(/\s+/g, " ").trim().slice(0, 60) ||
    "New chat"
  );
}
