import type { Env } from "../env";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  guildId?: string;
  model?: string;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  provider: string;
  model: string;
  streamed?: boolean;
}

export interface StreamHandlers {
  onDelta?: (text: string) => void | Promise<void>;
  onReasoning?: (text: string) => void | Promise<void>;
  onStatus?: (status: string) => void | Promise<void>;
}

export interface AiProvider {
  id: string;
  isConfigured(env: Env): boolean;
  complete(env: Env, request: ChatRequest, userId?: string): Promise<ChatResponse>;
  stream?: (
    env: Env,
    request: ChatRequest,
    handlers: StreamHandlers,
    userId?: string,
  ) => Promise<ChatResponse>;
  supportsStreamingTools?: boolean;
}
