import type { Env } from "./env";
import { DEFAULT_SYSTEM_PROMPT } from "./env";
import { completeWithFallback } from "./ai/router";

export interface AgentState {
  enabled: boolean;
  memory: string;
}

export const AGENT_PROMPT = `${DEFAULT_SYSTEM_PROMPT}

You are now running "theAIagent": a non-personalized agent session with the one
user who opened you in their DMs. Drop server-flavored behavior entirely —
no server rules, no channel etiquette; act like a hands-on coding/task agent.

Your memory:
- You have tools to read and save your memory (agent_memory_load,
  agent_memory_save). Memory persists across sessions; the message history
  does not, so anything you want to survive must be saved to memory.
- Before every new user message you will automatically see a "Memory digest"
  plus the recent messages. Use agent_memory_load when you need detail.

Compaction:
- Watch your own memory size (agent_memory_read reports character count).
- The model context is finite: when memory plus the conversation starts to
  look close to the context horizon, call agent_compact yourself BEFORE
  anything gets truncated. agent_compact safely summarizes and clears raw
  memory into a single digest and reports exactly what it kept, so nothing
  is lost quietly.

Agent relay (user's real device):
- The user may have bound the agent-relay Python bridge to their machine.
- relay_exec runs a shell command on THEIR device and returns the output.
  Use it for anything you would do with terminal_exec when the local
  sandbox is not where you want to act.
- If relay_exec reports a HALT (token window expired), tell the user to run
  \`agentrelay refresh\` and STOP issuing relay commands until tool calls
  succeed again. Then continue exactly where you left off.`;

const DEFAULT_MEMORY_CHAR_LIMIT = 30000;

export async function getAgentState(
  env: Env,
  userId: string,
): Promise<AgentState> {
  const row = await env.DB.prepare(
    `SELECT enabled, memory FROM agent_state WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ enabled: number; memory: string }>();
  if (!row) return { enabled: false, memory: "" };
  return { enabled: Boolean(row.enabled), memory: row.memory ?? "" };
}

export async function setAgentEnabled(
  env: Env,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO agent_state (user_id, enabled, memory, updated_at)
     VALUES (?, ?, '', ?)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, enabled ? 1 : 0, Date.now())
    .run();
}

export async function agentMemoryAppend(
  env: Env,
  userId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  const state = await getAgentState(env, userId);
  const addition = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const memory = `${state.memory}\n${addition}`.trim();
  await env.DB.prepare(
    `UPDATE agent_state SET memory = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(
      memory.length <= DEFAULT_MEMORY_CHAR_LIMIT * 2
        ? memory
        : memory.slice(0, DEFAULT_MEMORY_CHAR_LIMIT * 2),
      Date.now(),
      userId,
    )
    .run();
}

const COMPACTION_INSTRUCTIONS = `You are compacting a coding agent's memory.
Merge the older memory into a tight working digest: open goals, decisions,
file paths, commands that were run and their outcomes, user preferences, and
anything else that still matters. Drop small talk and stale details.
Keep the digest under 2000 characters. Reply with ONLY the digest text.`;

export async function compactAgentMemory(
  env: Env,
  userId: string,
): Promise<{ digest: string; before: number; after: number }> {
  const state = await getAgentState(env, userId);
  const before = state.memory.length;
  let base = state.memory;
  if (state.memory) base = `Existing digest / memory:\n${state.memory}`;
  const response = await completeWithFallback(env, {
    messages: [
      { role: "system", content: COMPACTION_INSTRUCTIONS },
      { role: "user", content: base || "(memory is empty)" },
    ],
    maxTokens: 1000,
    temperature: 0.2,
  });
  const digest = response.content.trim().slice(0, 2000);
  await env.DB.prepare(
    `UPDATE agent_state SET memory = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(digest, Date.now(), userId)
    .run();
  return { digest, before, after: digest.length };
}

export async function agentMemoryOverload(
  env: Env,
  userId: string,
  incomingPrompt: string,
): Promise<{ overload: boolean; memoryChars: number }> {
  const state = await getAgentState(env, userId);
  const memoryChars = state.memory.length;
  const limit = Number(env.AGENT_MEMORY_MAX_CHARS) || DEFAULT_MEMORY_CHAR_LIMIT;
  // The prompt plus current memory must fit comfortably in the model
  // context, leaving headroom for the reply.
  const overload = memoryChars + incomingPrompt.length > limit;
  return { overload, memoryChars };
}

export async function agentMemoryWrite(
  env: Env,
  userId: string,
  content: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE agent_state SET memory = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(content.slice(0, 200000), Date.now(), userId)
    .run();
}

export async function agentMemoryHistoryNote(
  env: Env,
  userId: string,
): Promise<string> {
  const state = await getAgentState(env, userId);
  if (!state.memory) {
    return "(memory digest: empty — first session, nothing saved yet)";
  }
  return `Memory digest (saved by you; persists across sessions; ${state.memory.length} chars):\n${state.memory}`;
}
