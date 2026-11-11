import { DurableObject } from "cloudflare:workers";
import { runAgent } from "./agent";
import { completeWithModel } from "./ai/router";
import type { ChatMessage } from "./ai/types";
import { executeTool, toolsFor } from "./ai/tools";
import { MAX_TOOL_ROUNDS } from "./agent";
import {
  shouldRespond,
  stripBotMention,
} from "./discord/agent-trigger";
import { getBotProfileCached } from "./bot-profile";
import {
  deleteChannelMessage,
  getIdentityWebhook,
  reactToMessage,
  sendChannelMessage,
  type IdentityWebhook,
  sendChannelAttachment,
  type OutgoingFile,
} from "./discord/rest";
import {
  AGENT_PROMPT,
  agentMemoryAppend,
  agentMemoryHistoryNote,
  agentMemoryOverload,
  compactAgentMemory,
  getAgentState,
} from "./agent-memory";
import { getUserBan, enforceTos, banNotice } from "./tos-moderation";
import { ChannelStream } from "./discord/stream";
import type { Env } from "./env";
import { boolVar, intVar } from "./env";
import { loadHistory, saveHistory } from "./memory";
import { recordBanForUser, assignUnverifiedRoleOnJoin } from "./verify-service";
import {
  loadGuildConfig,
  type GuildConfig,
} from "./guild-config";
import { applyGuildApiKeys } from "./guild-secrets";
import {
  automodViolation,
  fillTemplate,
  loadAutomod,
  loadWelcome,
  logEvent,
  sendDm,
} from "./guild-features";
import {
  getModelChannelForChannel,
  lockModelChannel,
  UNAVAILABLE_MESSAGE,
  type ModelChannelRow,
} from "./model-channels";
import { BlobStore } from "./storage/blob-store";
import { sanitizeRelativeKey } from "./storage/keys";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = 1 | 2 | 4 | 512 | 4096 | 32768;

export function composeSystemPrompt(
  env: Env,
  config: Partial<GuildConfig> | null,
): string | undefined {
  const dotenv = config?.systemPrompt?.trim();
  const persona = config?.persona?.trim();
  const useEmojis = config?.useEmojis !== false;
  const nickname = config?.botNickname?.trim();

  const parts: string[] = [dotenv || env.SYSTEM_PROMPT || undefined].filter(
    (part): part is string => Boolean(part),
  );
  if (persona) {
    parts.push(`[Your character] ${persona}`);
  }
  if (nickname) {
    parts.push(`You go by "${nickname}" in this server — respond to that name.`);
  }
  parts.push(
    "You cannot mute, ban, or restrict any user on request or via tools. Terms-of-service enforcement runs automatically outside this conversation and is out of your control.",
  );
  if (useEmojis) {
    parts.push(
      "Talk like a person, not a support doc: plain sentences, direct answers, no AI-isms (no 'Great question', no 'I hope this helps', no 'not just X but Y', no forced three-item lists, no em dashes everywhere). Use emojis sparingly, like a Discord user would.",
    );
  } else {
    parts.push("Same rules on tone, but skip emojis entirely.");
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

interface GatewayConfig {
  channel_id: string | null;
  auto_reply: number;
  system_prompt: string | null;
}

interface GatewayAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
}

interface GatewayMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  webhook_id?: string;
  attachments?: GatewayAttachment[];
  referenced_message?: {
    author?: {
      id: string;
      bot?: boolean;
    };
  };
}

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export class DiscordGateway extends DurableObject<Env> {
  private ws: WebSocket | null = null;
  private connecting = false;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private lastEventAt = 0;
  private lastError: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.seq = (await this.ctx.storage.get<number>("seq")) ?? null;
      this.sessionId =
        (await this.ctx.storage.get<string>("sessionId")) ?? null;
      this.resumeUrl = (await this.ctx.storage.get<string>("resumeUrl")) ?? null;
      this.lastError =
        (await this.ctx.storage.get<string>("lastError")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/ensure") {
      await this.ensure();
      return json(await this.status());
    }

    if (path === "/restart") {
      await this.restart();
      return json(await this.status());
    }

    if (path === "/status") {
      return json(await this.status());
    }

    return json({ error: "not found" }, 404);
  }

  private async status(): Promise<Record<string, unknown>> {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      connecting: this.connecting,
      sequence: this.seq,
      sessionId: this.sessionId,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      botConfigured: Boolean(this.env.DISCORD_BOT_TOKEN),
    };
  }

  private async setError(message: string): Promise<void> {
    this.lastError = message;
    await this.ctx.storage.put("lastError", message);
  }

  private async clearError(): Promise<void> {
    this.lastError = null;
    await this.ctx.storage.delete("lastError");
  }

  private async ensure(): Promise<void> {
    if (!this.env.DISCORD_BOT_TOKEN) {
      await this.setError("DISCORD_BOT_TOKEN is not configured");
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.connecting) return;
    this.connecting = true;

    try {
      const base = this.resumeUrl
        ? `${this.resumeUrl.replace(/\/$/, "")}/?v=10&encoding=json`
        : GATEWAY_URL;
      const ws = new WebSocket(base);
      this.ws = ws;

      ws.addEventListener("open", () => {
        if (this.ws === ws) this.connecting = false;
      });

      ws.addEventListener("message", (event) => {
        if (this.ws !== ws) return;
        const raw =
          typeof event.data === "string" ? event.data : String(event.data);
        void this.onMessage(raw);
      });

      ws.addEventListener("close", (event) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.connecting = false;
        void this.onClose(event.code, event.reason);
      });

      ws.addEventListener("error", () => {
        if (this.ws !== ws) return;
        this.connecting = false;
        void this.setError("Gateway WebSocket error");
      });
    } catch (error) {
      this.connecting = false;
      this.ws = null;
      const message = error instanceof Error ? error.message : String(error);
      await this.setError(`Could not open gateway: ${message}`);
      await this.ctx.storage.setAlarm(Date.now() + 15_000);
    }
  }

  private async restart(): Promise<void> {
    this.sessionId = null;
    this.seq = null;
    this.resumeUrl = null;
    await this.ctx.storage.delete(["sessionId", "seq", "resumeUrl"]);
    try {
      this.ws?.close(4000, "restart");
    } catch {
      // Ignore close failures.
    }
    this.ws = null;
    await this.clearError();
    await this.ensure();
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private identify(): void {
    this.send({
      op: 2,
      d: {
        token: this.env.DISCORD_BOT_TOKEN,
        intents: INTENTS,
        properties: {
          os: "linux",
          browser: "cloudflare",
          device: "cloudflare",
        },
      },
    });
  }

  private resume(): void {
    if (!this.sessionId) {
      this.identify();
      return;
    }
    this.send({
      op: 6,
      d: {
        token: this.env.DISCORD_BOT_TOKEN,
        session_id: this.sessionId,
        seq: this.seq ?? 0,
      },
    });
  }

  private async onMessage(raw: string): Promise<void> {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(raw) as GatewayPayload;
    } catch {
      return;
    }

    if (typeof payload.s === "number") {
      this.seq = payload.s;
      void this.ctx.storage.put("seq", payload.s);
    }
    switch (payload.op) {
      case 10: {
        const hello = payload.d as { heartbeat_interval?: number } | undefined;
        const interval = Math.max(1000, hello?.heartbeat_interval ?? 41_250);
        await this.ctx.storage.setAlarm(Date.now() + interval);
        if (this.sessionId) this.resume();
        else this.identify();
        return;
      }
      case 11:
        return;
      case 1:
        this.send({ op: 1, d: this.seq });
        return;
      case 7:
        try {
          this.ws?.close(4000, "reconnect");
        } catch {
          // Ignore close failures.
        }
        return;
      case 9: {
        const resumable = Boolean(payload.d);
        if (!resumable) {
          this.sessionId = null;
          this.seq = null;
          this.resumeUrl = null;
          await this.ctx.storage.delete(["sessionId", "seq", "resumeUrl"]);
        }
        try {
          this.ws?.close(4000, "invalid session");
        } catch {
          // Ignore close failures.
        }
        return;
      }
      case 0:
        this.lastEventAt = Date.now();
        if (payload.t === "READY") {
          const ready = payload.d as {
            session_id?: string;
            resume_gateway_url?: string;
          };
          this.sessionId = ready.session_id ?? null;
          this.resumeUrl = ready.resume_gateway_url ?? null;
          if (this.sessionId) {
            await this.ctx.storage.put("sessionId", this.sessionId);
          }
          if (this.resumeUrl) {
            await this.ctx.storage.put("resumeUrl", this.resumeUrl);
          }
          await this.clearError();
        } else if (payload.t === "RESUMED") {
          await this.clearError();
        } else if (payload.t === "MESSAGE_CREATE") {
          this.ctx.waitUntil(
            this.handleMessage(payload.d as GatewayMessage).catch((error) => {
              console.error("Auto-reply failed", error);
            }),
          );
        } else if (payload.t === "GUILD_MEMBER_REMOVE") {
          const removed = payload.d as {
            guild_id?: string;
            user?: { id?: string; bot?: boolean; username?: string };
          };
          if (removed.guild_id && removed.user?.id && !removed.user.bot) {
            this.ctx.waitUntil(
              this.sendGoodbye(
                removed.guild_id,
                removed.user.id,
                removed.user.username || "member",
              ).catch((error) => console.error("Goodbye failed", error)),
            );
          }
        } else if (payload.t === "GUILD_MEMBER_ADD") {
          const member = payload.d as {
            guild_id?: string;
            user?: { id?: string; bot?: boolean; username?: string };
            roles?: string[];
          };
          if (
            member.guild_id &&
            member.user?.id &&
            !member.user.bot
          ) {
            void assignUnverifiedRoleOnJoin(
              this.env,
              member.guild_id,
              member.user.id,
              member.roles ?? [],
            ).catch((error) =>
              console.error("Unverified role assignment failed", error),
            );
            void this
              .sendWelcome(
                member.guild_id,
                member.user.id,
                member.user.username || "friend",
              )
              .catch((error) => console.error("Welcome failed", error));
          }
        } else if (payload.t === "GUILD_BAN_ADD") {
          const ban = payload.d as { guild_id?: string; user?: { id?: string } };
          if (ban.guild_id && ban.user?.id) {
            this.ctx.waitUntil(
              recordBanForUser(this.env, ban.guild_id, ban.user.id).catch(
                (error) => console.error("Ban recording failed", error),
              ),
            );
          }
        }
        return;
      default:
        return;
    }
  }

  private async onClose(code: number, reason: string): Promise<void> {
    if (code === 4004) {
      await this.setError("Invalid DISCORD_BOT_TOKEN");
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
      return;
    }
    if (code === 4014) {
      await this.setError(
        "Discord rejected privileged intents. Enable both Message Content Intent and Server Members Intent in the Discord Developer Portal under Bot > Privileged Gateway Intents." +
          (reason ? ` (${reason.slice(0, 160)})` : ""),
      );
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
      return;
    }
    if (code === 4013) {
      await this.setError("Discord rejected the requested gateway intents");
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
      return;
    }
    if (code !== 1000 && code !== 4000) {
      await this.setError(
        `Gateway closed (${code})${reason ? `: ${reason.slice(0, 160)}` : ""}`,
      );
    }
    await this.ctx.storage.setAlarm(Date.now() + 5_000);
  }

  async alarm(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ op: 1, d: this.seq });
      await this.ctx.storage.setAlarm(Date.now() + 41_250);
      return;
    }
    await this.ensure();
  }


  private async identityFor(
    message: GatewayMessage,
    config: GuildConfig | null,
  ): Promise<IdentityWebhook | undefined> {
    if (!config) return undefined;
    const name = config.respondName?.trim() ?? "";
    const avatar = config.respondAvatar?.trim() ?? "";
    if (!name && !avatar) return undefined;
    try {
      let displayName = name;
      if (!displayName) {
        displayName = (await getBotProfileCached(this.env)).displayName;
      }
      return await getIdentityWebhook(
        this.env,
        message.channel_id,
        displayName,
        avatar || undefined,
      );
    } catch (error) {
      console.error("Identity webhook failed", error);
      return undefined;
    }
  }


  private async sendWelcome(
    guildId: string,
    userId: string,
    username: string,
  ): Promise<void> {
    const config = await loadWelcome(this.env, guildId).catch(() => null);
    if (!config) return;
    const stamp = `<@${userId}>`;
    const values = { user: stamp, username, server: guildId };
    try {
      if (config.channelId && config.messageText.trim()) {
        await sendChannelMessage(
          this.env,
          config.channelId,
          fillTemplate(config.messageText, values),
        );
      }
      if (config.dmEnabled && config.dmText.trim()) {
        await sendDm(this.env, userId, fillTemplate(config.dmText, values));
      }
      await logEvent(
        this.env,
        guildId,
        "welcome",
        `Welcomed ${username} (${userId}).`,
      );
    } catch (error) {
      await logEvent(
        this.env,
        guildId,
        "welcome",
        `Welcome failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async sendGoodbye(
    guildId: string,
    userId: string,
    username: string,
  ): Promise<void> {
    const config = await loadWelcome(this.env, guildId).catch(() => null);
    if (!config?.goodbyeChannelId || !config.goodbyeText.trim()) return;
    const values = { user: `<@${userId}>`, username, server: guildId };
    try {
      await sendChannelMessage(
        this.env,
        config.goodbyeChannelId,
        fillTemplate(config.goodbyeText, values),
      );
      await logEvent(
        this.env,
        guildId,
        "goodbye",
        `Said goodbye to ${username}.`,
      );
    } catch (error) {
      await logEvent(
        this.env,
        guildId,
        "goodbye",
        `Goodbye failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async automodCheck(message: GatewayMessage): Promise<boolean> {
    if (!message.guild_id || !message.content) return false;
    const config = await loadAutomod(this.env, message.guild_id).catch(
      () => null,
    );
    if (!config?.enabled) return false;
    const word = automodViolation(config, message.content);
    if (!word) return false;
    try {
      await deleteChannelMessage(this.env, message.channel_id, message.id);
    } catch (error) {
      await logEvent(
        this.env,
        message.guild_id,
        "automod-delete",
        `Delete failed (${error instanceof Error ? error.message : String(error)}).`,
      );
      return true; // Do not answer a message we could not remove.
    }
    const notice = config.notice.trim();
    try {
      if (notice) {
        await sendChannelMessage(
          this.env,
          message.channel_id,
          notice
            .replace(new RegExp(`\{user\}`, "g"), `<@${message.author.id}>`)
            .slice(0, 300),
        );
      }
    } catch {
      // Notice delivery is best effort.
    }
    await logEvent(
      this.env,
      message.guild_id,
      "automod-delete",
      `Removed a message from ${message.author.username || message.author.id} (rule: ${word}).`,
    );
    return true;
  }


  // Returns false when the user must not receive an AI reply this round.
  private async tosGate(
    message: GatewayMessage,
    config: { autoReply?: boolean; channelId?: string | null } | null,
  ): Promise<boolean> {
    void config;
    const userId = message.author.id;
    const guildId = message.guild_id ?? undefined;
    const content =
      stripBotMention(message.content.trim(), this.env.DISCORD_CLIENT_ID) ||
      (message.attachments?.length ? "Inspect the attached file(s)." : "");

    const ban = await getUserBan(this.env, userId).catch(() => null);
    if (ban) {
      await this.sendBanNotice(message, banNotice(ban));
      return false;
    }
    const fresh = await enforceTos(this.env, userId, content, guildId);
    if (fresh) {
      await this.sendBanNotice(message, banNotice(fresh));
      return false;
    }
    return true;
  }

  private async sendBanNotice(
    message: GatewayMessage,
    notice: string,
  ): Promise<void> {
    const key = `tos:notice:${message.author.id}`;
    try {
      if (await this.env.CONVERSATIONS.get(key)) return;
      await this.env.CONVERSATIONS.put(key, "1", { expirationTtl: 86400 });
    } catch {
      // dedup best effort
    }
    try {
      await sendChannelMessage(this.env, message.channel_id, notice.slice(0, 600));
    } catch {
      // notice delivery is best effort
    }
  }
  private async handleMessage(message: GatewayMessage): Promise<void> {
    const botId = this.env.DISCORD_CLIENT_ID;
    if (message.webhook_id) return;
    if (message.author.id === botId) return;

    const rawContent = message.content.trim();
    const attachments = message.attachments ?? [];

    const config = message.guild_id
      ? await loadGuildConfig(this.env, message.guild_id)
      : null;

    const enabledBot =
      message.author.bot &&
      Boolean(message.guild_id) &&
      Boolean(config?.respondBots.includes(message.author.id));
    if (message.author.bot && !enabledBot) return;

    const modelChannel = message.guild_id
      ? await getModelChannelForChannel(
          this.env,
          message.guild_id,
          message.channel_id,
        ).catch(() => null)
      : null;

    const respond =
      enabledBot ||
      Boolean(modelChannel) ||
      shouldRespond({
        guildId: message.guild_id,
        channelId: message.channel_id,
        content: rawContent,
        botId,
        referencedAuthorId: message.referenced_message?.author?.id,
        configuredChannelId: config?.channelId ?? null,
        autoReply: Boolean(config?.autoReply),
        hasAttachments: attachments.length > 0,
      });

    if (!respond) return;

    const seenKey = `gateway:seen:${message.id}`;
    try {
      if (await this.env.CONVERSATIONS.get(seenKey)) return;
      await this.env.CONVERSATIONS.put(seenKey, "1", {
        expirationTtl: 300,
      });
    } catch {
      // Deduplication is best-effort.
    }

    // Autonomous ToS gate: never on request, never skippable by the model.
    if (!(await this.tosGate(message, config))) return;

    if (config?.useEmojis && config.reactionEmoji) {
      void reactToMessage(
        this.env,
        message.channel_id,
        message.id,
        config.reactionEmoji,
      ).catch(() => undefined);
    }

    const content =
      stripBotMention(rawContent, botId) ||
      (attachments.length ? "Inspect the attached file(s)." : "");

    // DM agent mode: not personalized, uses its own memory + tools.
    if (!message.guild_id) {
      const agentState = await getAgentState(this.env, message.author.id).catch(
        () => null,
      );
      if (agentState?.enabled) {
        await this.handleAgentMessage(
          message,
          content,
          config,
          modelChannel,
        );
        return;
      }
    }

    if (modelChannel) {
      await this.handleModelChannelMessage(message, modelChannel, content, config);
      return;
    }
    const scope = message.guild_id
      ? `guilds/${message.guild_id}`
      : `users/${message.author.id}`;
    const historyKey = message.guild_id
      ? `conv:guild:${message.guild_id}:${message.channel_id}`
      : `conv:dm:${message.author.id}`;
    const maxHistory = intVar(this.env.MAX_HISTORY_MESSAGES, 20);

    let stream: ChannelStream | undefined;

    try {
      const attachmentInfo = await this.storeAttachments(message, scope);
      const history = await loadHistory(this.env, historyKey, maxHistory);
      const identity = await this.identityFor(message, config);
      // Bot-to-bot replies never stream: one final message, no live edits.
      if (!enabledBot) {
        stream = new ChannelStream(this.env, message.channel_id, identity);
        await stream.start();
      }

      const result = await runAgent(this.env, {
        scope,
        history,
        prompt: content,
        attachmentNote: attachmentInfo.note,
        attachmentImageUrl: attachmentInfo.imageUrl,
        systemPrompt: composeSystemPrompt(this.env, config),
        guildId: message.guild_id,
        stream: {
          onDelta: (text) => stream?.delta(text),
          onReasoning: (text) => stream?.reasoning(text),
          onStatus: (status) => stream?.setStatus(status),
        },
      });

      const footer = boolVar(this.env.SHOW_PROVIDER, true)
        ? `\n\n-# via ${result.provider} · ${result.model}`
        : "";

      const userMessage = attachmentInfo.labels.length
        ? `${content}\n[attachments: ${attachmentInfo.labels.join(", ")}]`
        : content;

      await saveHistory(
        this.env,
        historyKey,
        [
          ...history,
          { role: "user", content: userMessage },
          { role: "assistant", content: result.text },
        ],
        maxHistory,
      );

      const generatedFiles = result.generatedAttachments?.length
        ? await this.blobFilesFromKeys(result.generatedAttachments, message.guild_id
            ? `guilds/${message.guild_id}`
            : scope)
        : [];
      if (stream) {
        await stream.finish(result.text + footer, generatedFiles);
      } else {
        const reply = `${result.text}${footer}`;
        if (generatedFiles.length) {
          await sendChannelAttachment(
            this.env,
            message.channel_id,
            reply,
            generatedFiles,
          );
        } else {
          await sendChannelMessage(this.env, message.channel_id, reply);
        }
      }
      await this.clearError();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await this.setError(text.slice(0, 500));
      console.error("Agent reply failed", error);

      const errorKey = `gateway:error:${message.channel_id}`;
      try {
        if (!(await this.env.CONVERSATIONS.get(errorKey))) {
          await this.env.CONVERSATIONS.put(errorKey, "1", {
            expirationTtl: 300,
          });
          const warning = `⚠️ Agent failed: ${text.slice(0, 500)}`;
          if (stream) {
            await stream.fail(warning);
          } else {
            await sendChannelMessage(
              this.env,
              message.channel_id,
              warning,
            );
          }
        }
      } catch {
        // Avoid error loops.
      }
    }
  }

  private async handleModelChannelMessage(
    message: GatewayMessage,
    modelChannel: ModelChannelRow,
    content: string,
    config: GuildConfig | null,
  ): Promise<void> {
    if (!modelChannel.available) {
      const noticeKey = `model-unavailable:${modelChannel.channelId}`;
      try {
        if (await this.env.CONVERSATIONS.get(noticeKey)) return;
        await this.env.CONVERSATIONS.put(noticeKey, "1", {
          expirationTtl: 60,
        });
      } catch {
        // Best-effort.
      }
      await sendChannelMessage(
        this.env,
        message.channel_id,
        UNAVAILABLE_MESSAGE,
      ).catch(() => undefined);
      return;
    }

    const guildId = message.guild_id;
    if (!guildId) return;

    const requestEnv = await applyGuildApiKeys(this.env, guildId);
    const tools = toolsFor(requestEnv);
    const historyKey = `conv:model:${guildId}:${message.channel_id}`;
    const maxHistory = intVar(this.env.MAX_HISTORY_MESSAGES, 20);
    const history = await loadHistory(this.env, historyKey, maxHistory);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          `You are ${modelChannel.displayName}, an AI model in a Discord channel. Answer the user directly, accurately, and concisely. Use Discord-friendly Markdown. Do not claim to have tools or access to files unless the user provides them in the message.`,
          config?.persona?.trim()
            ? `[Your character] ${config.persona.trim()}`
            : "",
          config?.botNickname?.trim()
            ? `You go by "${config.botNickname.trim()}" in this server.`
            : "",
          config?.useEmojis !== false
            ? "Talk like a person in this channel, not a support doc; emojis used sparingly are fine."
            : "Talk like a person in this channel, not a support doc; skip emojis entirely.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content },
    ];
    let stream: ChannelStream | undefined;

    try {
      const identity = await this.identityFor(message, config);
      stream = new ChannelStream(this.env, message.channel_id, identity);
      await stream.start();

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await completeWithModel(
          requestEnv,
          modelChannel.provider,
          modelChannel.model,
          {
            messages,
            tools,
            maxTokens: 2000,
            temperature: 0.7,
          },
          {
            onDelta: (text) => stream?.delta(text),
            onReasoning: (text) => stream?.reasoning(text),
            onStatus: (status) => stream?.setStatus(status),
          },
        );

        if (!response.toolCalls.length) {
          const footer = boolVar(this.env.SHOW_PROVIDER, true)
            ? `\n\n-# via ${response.provider} · ${response.model}`
            : "";
          await saveHistory(
            this.env,
            historyKey,
            [
              ...history,
              { role: "user", content },
              { role: "assistant", content: response.content },
            ],
            maxHistory,
          );
          await stream.finish(response.content + footer);
          await this.clearError();
          return;
        }

        messages.push({
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        });
        const toolResults: string[] = [];
        const toolKeys: string[] = [];
        for (const call of response.toolCalls) {
          await stream?.setStatus(`Using ${call.function.name}…`);
          const scope = `guilds/${guildId}`;
          const result = await executeTool(requestEnv, scope, call);
          toolResults.push(result);
          try {
            const parsed = JSON.parse(result) as { pending_attachment?: string };
            if (parsed?.pending_attachment) toolKeys.push(parsed.pending_attachment);
          } catch {
            // Plain-text tool result.
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        const generatedFiles = await this.blobFilesFromKeys(toolKeys, `guilds/${guildId}`);
        await stream?.setStatus("Thinking…");
      }

      messages.push({
        role: "user",
        content:
          "Do not call any more tools. Give your final answer now using the information above.",
      });
      const finalResponse = await completeWithModel(
        requestEnv,
        modelChannel.provider,
        modelChannel.model,
        {
          messages,
          tools: [],
          maxTokens: 2000,
          temperature: 0.7,
        },
        {
          onDelta: (text) => stream?.delta(text),
          onReasoning: (text) => stream?.reasoning(text),
          onStatus: (status) => stream?.setStatus(status),
        },
      );
      const footer = boolVar(this.env.SHOW_PROVIDER, true)
        ? `\n\n-# via ${finalResponse.provider} · ${finalResponse.model}`
        : "";
      await saveHistory(
        this.env,
        historyKey,
        [
          ...history,
          { role: "user", content },
          { role: "assistant", content: finalResponse.content },
        ],
        maxHistory,
      );
      await stream.finish(finalResponse.content + footer);
      await this.clearError();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await this.setError(text.slice(0, 500));
      console.error("Model channel reply failed", error);

      const wasAvailable = await lockModelChannel(
        this.env,
        modelChannel,
        text,
      ).catch(() => false);

      if (wasAvailable) {
        if (stream) {
          await stream.fail(UNAVAILABLE_MESSAGE).catch(() => undefined);
        } else {
          await sendChannelMessage(
            this.env,
            message.channel_id,
            UNAVAILABLE_MESSAGE,
          ).catch(() => undefined);
        }
      }
    }
  }


  private async blobFilesFromKeys(
    keys: string[],
    scope: string,
  ): Promise<OutgoingFile[]> {
    const files: OutgoingFile[] = [];
    if (!keys.length) return files;
    const store = new BlobStore(this.env, scope);
    for (const key of keys) {
      const blob = await store.get(key).catch(() => null);
      if (!blob) continue;
      const filename = key.split("/").pop() ?? "image.png";
      files.push({
        filename,
        bytes: blob.data,
        contentType: blob.contentType,
      });
    }
    return files;
  }


  private async handleAgentMessage(
    message: GatewayMessage,
    content: string,
    config: GuildConfig | null,
    modelChannel: ModelChannelRow | null,
  ): Promise<void> {
    void modelChannel;
    const userId = message.author.id;
    const historyKey = `agent:conv:${userId}`;
    const maxHistory = intVar(this.env.MAX_HISTORY_MESSAGES, 20);

    let stream: ChannelStream | undefined;
    try {
      const scope = `users/${userId}`;
      // Compaction gate: if the memory plus this prompt is close to filling
      // the model context, compact BEFORE anything is truncated.
      const load = await agentMemoryOverload(this.env, userId, content);
      if (load.overload) {
        await compactAgentMemory(this.env, userId);
      }
      const memoryNote = await agentMemoryHistoryNote(this.env, userId);
      const history = await loadHistory(this.env, historyKey, maxHistory);

      stream = new ChannelStream(this.env, message.channel_id);
      await stream.start();

      const result = await runAgent(this.env, {
        scope,
        userId,
        history,
        prompt: `${memoryNote}

User: ${content}`,
        systemPrompt: AGENT_PROMPT,
        guildId: undefined,
        stream: {
          onDelta: (text) => stream?.delta(text),
          onReasoning: (text) => stream?.reasoning(text),
          onStatus: (status) => stream?.setStatus(status),
        },
      });

      await agentMemoryAppend(this.env, userId, [
        { role: "user", content },
        { role: "assistant", content: result.text },
      ]);

      await saveHistory(
        this.env,
        historyKey,
        [
          ...history,
          { role: "user", content },
          { role: "assistant", content: result.text },
        ],
        maxHistory,
      );

      const footer = boolVar(this.env.SHOW_PROVIDER, true)
        ? `\n\n-# via ${result.provider} · ${result.model}`
        : "";
      await stream.finish(result.text + footer);
      await this.clearError();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await this.setError(text.slice(0, 500));
      console.error("Agent-mode reply failed", error);
      if (stream) {
        await stream.fail(UNAVAILABLE_MESSAGE).catch(() => undefined);
      } else {
        await sendChannelMessage(
          this.env,
          message.channel_id,
          UNAVAILABLE_MESSAGE,
        ).catch(() => undefined);
      }
    }
  }

  private async storeAttachments(
    message: GatewayMessage,
    scope: string,
  ): Promise<{
    note?: string;
    imageUrl?: string;
    labels: string[];
  }> {
    const attachments = message.attachments ?? [];
    if (!attachments.length) return { labels: [] };

    const maxUpload = intVar(this.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
    const store = new BlobStore(this.env, scope);
    const notes: string[] = [];
    const labels: string[] = [];
    let imageUrl: string | undefined;

    for (const attachment of attachments.slice(0, 5)) {
      labels.push(attachment.filename);

      if (attachment.size > maxUpload) {
        notes.push(
          `"${attachment.filename}" was too large (${attachment.size} bytes; max ${maxUpload}).`,
        );
        continue;
      }

      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = new Uint8Array(await response.arrayBuffer());
        let safeName = "file";
        try {
          safeName = sanitizeRelativeKey(attachment.filename || "file");
        } catch {
          safeName = "file";
        }

        const key = `uploads/${Date.now()}-${safeName}`;
        const stored = await store.put(
          key,
          data,
          attachment.content_type || "application/octet-stream",
        );

        notes.push(
          `"${attachment.filename}" saved at blob key "${stored.key}" (${stored.location === "device" ? "device storage" : "temporary D1 storage"}).`,
        );

        if (!imageUrl && attachment.content_type?.startsWith("image/")) {
          imageUrl = attachment.url;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        notes.push(`"${attachment.filename}" could not be saved: ${reason}`);
      }
    }

    return {
      note: notes.length ? `Attachments: ${notes.join(" ")}` : undefined,
      imageUrl,
      labels,
    };
  }
}
