export interface TriggerContext {
  guildId?: string;
  channelId: string;
  content: string;
  botId?: string;
  referencedAuthorId?: string;
  configuredChannelId?: string | null;
  autoReply?: boolean;
  hasAttachments?: boolean;
}

export function mentionPattern(botId: string): RegExp {
  const escaped = botId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<@!?${escaped}>`, "g");
}

export function isBotMentioned(content: string, botId?: string): boolean {
  if (!botId) return false;
  return mentionPattern(botId).test(content);
}

export function stripBotMention(content: string, botId?: string): string {
  if (!botId) return content.trim();
  return content.replace(mentionPattern(botId), " ").replace(/\s+/g, " ").trim();
}

export function shouldRespond(context: TriggerContext): boolean {
  if (!context.content.trim() && !context.hasAttachments) return false;
  if (!context.guildId) return true;
  if (isBotMentioned(context.content, context.botId)) return true;
  if (context.botId && context.referencedAuthorId === context.botId) {
    return true;
  }
  return Boolean(
    context.autoReply &&
      context.configuredChannelId &&
      context.configuredChannelId === context.channelId,
  );
}
