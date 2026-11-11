export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ModalSubmit: 5,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 8,
} as const;

export const MessageFlags = {
  Ephemeral: 64,
} as const;

export const ApplicationCommandOptionType = {
  Subcommand: 1,
  String: 3,
  Boolean: 5,
  Attachment: 11,
} as const;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMember {
  user: DiscordUser;
  permissions?: string;
  roles?: string[];
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url?: string;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
  focused?: boolean;
}

export interface InteractionData {
  id: string;
  name: string;
  type: number;
  custom_id?: string;
  options?: InteractionOption[];
  resolved?: {
    attachments?: Record<string, DiscordAttachment>;
  };
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: InteractionData;
}
