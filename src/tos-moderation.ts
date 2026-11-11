import type { Env } from "./env";
import { completeWithFallback } from "./ai/router";
import { logEvent } from "./guild-features";

// Autonomous ToS enforcement. This is NOT a user-requestable feature:
// checks run on incoming messages, never on demand, and no tool exposes
// ban/unban to the model.

const CHECK_SYSTEM = [
  "You are the autonomous terms-of-service filter for theAIchatbot.",
  "Classify the USER MESSAGE against the service terms below.",
  "Violations include: illegal activity or facilitation (fraud, malware, credential theft, exploits against systems they do not own);",
  "sexual content or dating/romance roleplay; content sexualizing minors; violent threats; self-harm encouragement;",
  "hate or harassment targeting people; doxxing or privacy invasion; spam, abuse, or evasion of safety controls.",
  "Mere rudeness, profanity without harassment, coding help with dual-use implications that stay benign, and normal topics are NOT violations.",
  "CRITICAL: talking ABOUT rules is not breaking them. Jokes, claims like \"I'm breaking the TOS\", \"ban me\", bait,",
  "hypotheticals, meta-discussion, or describing violations without actually providing/committing the content are NOT violations.",
  "A violation requires the message itself to contain or concretely request the prohibited material.",
  "Reply ONLY with compact JSON: {\"violation\":bool,\"severity\":\"temporary\"|\"permanent\",\"reason\":\"<=160 chars\"}.",
  "severity \"permanent\" only for minors content or credible threats/illegal-harm plans. Otherwise \"temporary\".",
  "If no violation: {\"violation\":false,\"severity\":\"temporary\",\"reason\":\"\"}.",
].join(" ");

export interface TosVerdict {
  violation: boolean;
  permanent: boolean;
  reason: string;
}

export interface UserBan {
  reason: string;
  until: string | null; // ISO; null = permanent
}

const STRIKE_KEYS = [null, "1d", "7d"]; // 1st -> 1 day, 2nd -> 7 days, 3rd -> permanent

function strikeCountKey(userId: string): string {
  return `tos:strikes:${userId}`;
}

function strikeCountFromUntil(until: string | null): number {
  // newest strikes are inferred from expiry length: 1d=1, 7d=2
  if (until === null) return 3;
  const ms = new Date(until).getTime() - Date.now();
  if (ms > 6 * 24 * 3600_000) return 2;
  return 1;
}

export async function getUserBan(env: Env, userId: string): Promise<UserBan | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT reason, until FROM user_bans WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ reason: string; until: string | null }>();
    if (!row) return null;
    if (row.until && new Date(row.until).getTime() <= Date.now()) {
      await env.DB.prepare("DELETE FROM user_bans WHERE user_id = ?")
        .bind(userId)
        .run();
      await env.CONVERSATIONS.delete(strikeCountKey(userId));
      return null;
    }
    return { reason: row.reason, until: row.until };
  } catch {
    return null;
  }
}

async function recordStrike(env: Env, userId: string, verdict: TosVerdict): Promise<UserBan> {
  const existing = await getUserBan(env, userId);
  if (existing) return existing;
  let count = 1;
  try {
    const raw = await env.CONVERSATIONS.get(strikeCountKey(userId));
    if (raw) count = parseInt(raw, 10) || 1;
  } catch {
    // default to 1
  }
  count = Math.min(count + 1, 3);
  const permanent = verdict.permanent || count >= 3;
  const days = permanent ? 0 : parseInt(STRIKE_KEYS[count] ?? "1d", 10);
  const until = permanent ? null : new Date(Date.now() + days * 24 * 3600_000).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO user_bans (user_id, reason, until) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = datetime('now')",
    )
      .bind(userId, verdict.reason, until)
      .run();
  } catch (error) {
    await logEvent(env, "", "tos-moderation", `Failed to persist ban for ${userId}.`);
  }
  if (!permanent) {
    await env.CONVERSATIONS.put(strikeCountKey(userId), String(count), {
      expirationTtl: 90 * 24 * 3600,
    });
  } else {
    await env.CONVERSATIONS.delete(strikeCountKey(userId));
  }
  void strikeCountFromUntil;
  await logEvent(env, "", "tos-moderation",
    `Banned ${userId} ${permanent ? "permanently" : `until ${until}`} (${verdict.reason}). Strike ${count}.`);
  return { reason: verdict.reason, until };
}

export function banNotice(ban: UserBan): string {
  const untilText = ban.until
    ? `until <t:${Math.floor(new Date(ban.until).getTime() / 1000)}:f>`
    : "permanently";
  return (
    `Your access to theAIchatbot has been restricted ${untilText} for a Terms of Service violation.` +
    (ban.reason ? `\nReason: ${ban.reason}` : "") +
    `\nReview the terms at https://discord-ai-bot.csomeone301.workers.dev/terms`
  );
}

export async function checkTos(
  env: Env,
  userId: string,
  content: string,
  guildId?: string,
): Promise<TosVerdict | null> {
  if (!content || content.length < 4) return null;
  try {
    const result = await completeWithFallback(env, {
      messages: [
        { role: "system", content: CHECK_SYSTEM },
        { role: "user", content: content.slice(0, 1000) },
      ],
      maxTokens: 200,
      temperature: 0,
      guildId,
    });
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      violation?: boolean;
      severity?: string;
      reason?: string;
    };
    if (!parsed.violation) return null;
    // Second pass: require independent agreement before punishing anyone.
    const confirmed = await thisVerify(env, content.slice(0, 1000), guildId);
    if (!confirmed) return null;
    return {
      violation: true,
      permanent: confirmed,
      reason: (parsed.reason || "Terms of Service violation").slice(0, 160),
    };
  } catch {
    return null; // fail open: the check itself must not break chat
  }
}

async function thisVerify(env: Env, content: string, guildId?: string): Promise<boolean | null> {
  try {
    const result = await completeWithFallback(env, {
      messages: [
        {
          role: "system",
          content:
            "You are a strict appeals reviewer. Re-examine this single message for an actual terms-of-service violation. " +
            "Claims, jokes, bait, or talk about breaking rules are NOT violations. Only concrete prohibited content or requests count. " +
            'Reply ONLY {"confirm":true,"permanent":bool} or {"confirm":false}.',
        },
        { role: "user", content },
      ],
      maxTokens: 60,
      temperature: 0,
      guildId,
    });
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { confirm?: boolean; permanent?: boolean };
    return parsed.confirm === true ? Boolean(parsed.permanent) : false;
  } catch {
    return null; // tie goes to the user
  }
}

export async function enforceTos(
  env: Env,
  userId: string,
  content: string,
  guildId?: string,
): Promise<UserBan | null> {
  const verdict = await checkTos(env, userId, content, guildId);
  if (!verdict) return null;
  return recordStrike(env, userId, verdict);
}

export async function listUserBans(
  env: Env,
): Promise<Array<{ user_id: string; reason: string; until: string | null; created_at: string }>> {
  const result = await env.DB.prepare(
    "SELECT user_id, reason, until, created_at FROM user_bans ORDER BY created_at DESC LIMIT 200",
  ).all<{ user_id: string; reason: string; until: string | null; created_at: string }>();
  return (result.results ?? []).map((r) => ({
    user_id: r.user_id,
    reason: r.reason,
    until: r.until,
    created_at: r.created_at,
  }));
}

export async function unbanUser(env: Env, userId: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM user_bans WHERE user_id = ?")
    .bind(userId)
    .run();
  await env.CONVERSATIONS.delete(strikeCountKey(userId)).catch(() => undefined);
  await logEvent(env, "", "tos-moderation", `Unbanned ${userId} by the creator.`);
  return (result.meta.changes ?? 0) > 0;
}
