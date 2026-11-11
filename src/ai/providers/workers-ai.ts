import type { Env } from "../../env";
import { readSse } from "../sse";
import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamHandlers,
  ToolCall,
  ToolDefinition,
} from "../types";

interface WorkersToolCall {
  id?: string;
  name?: string;
  arguments?: unknown;
  function?: { name?: string; arguments?: unknown };
}

function safeParseArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toWorkersTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function toWorkersMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) => ({
        name: call.function.name,
        arguments: safeParseArguments(call.function.arguments),
      }));
      return {
        role: "assistant" as const,
        content: JSON.stringify(calls.length === 1 ? calls[0] : calls),
      };
    }
    if (message.role === "tool") {
      return { role: "tool" as const, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

function normalizeToolCall(call: WorkersToolCall, index: number): ToolCall {
  const name = call.function?.name ?? call.name ?? "";
  const rawArgs = call.function?.arguments ?? call.arguments ?? {};
  return {
    id: call.id ?? `call_${index}`,
    type: "function",
    function: {
      name,
      arguments:
        typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
    },
  };
}

function normalizeContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

export const workersAiProvider: AiProvider = {
  id: "workers-ai",
  isConfigured: (env) => Boolean(env.AI),

  async complete(env: Env, request: ChatRequest): Promise<ChatResponse> {
    const model =
      request.model || env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const inputs: Record<string, unknown> = {
      messages: toWorkersMessages(request.messages),
      max_tokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools?.length) {
      inputs.tools = toWorkersTools(request.tools);
    }

    const raw = (await env.AI.run(model, inputs)) as {
      response?: unknown;
      tool_calls?: WorkersToolCall[];
      choices?: Array<{
        message?: {
          content?: unknown;
          tool_calls?: WorkersToolCall[];
        };
      }>;
    };

    const choiceMessage = raw?.choices?.[0]?.message;
    const toolCalls = Array.isArray(raw?.tool_calls)
      ? raw.tool_calls
      : Array.isArray(choiceMessage?.tool_calls)
        ? choiceMessage.tool_calls
        : [];

    const content =
      typeof raw?.response === "string"
        ? raw.response
        : normalizeContent(choiceMessage?.content);

    return {
      content,
      toolCalls: toolCalls.map(normalizeToolCall),
      provider: "workers-ai",
      model,
    };
  },

  async stream(
    env: Env,
    request: ChatRequest,
    handlers: StreamHandlers,
  ): Promise<ChatResponse> {
    const model =
      request.model || env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const inputs: Record<string, unknown> = {
      messages: toWorkersMessages(request.messages),
      max_tokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.7,
      stream: true,
    };

    if (request.tools?.length) {
      inputs.tools = toWorkersTools(request.tools);
    }

    const raw = (await env.AI.run(
      model,
      inputs,
    )) as unknown as ReadableStream<Uint8Array>;

    let content = "";
    const toolCalls: WorkersToolCall[] = [];

    for await (const event of readSse(raw)) {
      if (event === "[DONE]") break;

      let data: {
        error?: unknown;
        response?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
        thinking?: unknown;
        tool_calls?: WorkersToolCall[];
        choices?: Array<{
          delta?: {
            content?: unknown;
            reasoning?: unknown;
            reasoning_content?: unknown;
            thinking?: unknown;
            tool_calls?: WorkersToolCall[];
          };
          message?: {
            content?: unknown;
            tool_calls?: WorkersToolCall[];
          };
        }>;
      };
      try {
        data = JSON.parse(event) as typeof data;
      } catch {
        continue;
      }

      if (data.error) {
        throw new Error(
          `workers-ai: ${JSON.stringify(data.error).slice(0, 400)}`,
        );
      }

      const choice = data.choices?.[0];
      const delta = choice?.delta;
      const text =
        typeof data.response === "string"
          ? data.response
          : normalizeContent(delta?.content ?? choice?.message?.content);
      if (text) {
        content += text;
        await handlers.onDelta?.(text);
      }

      const reasoning = normalizeContent(
        data.reasoning ??
          data.reasoning_content ??
          data.thinking ??
          delta?.reasoning ??
          delta?.reasoning_content ??
          delta?.thinking,
      );
      if (reasoning) await handlers.onReasoning?.(reasoning);

      const calls = data.tool_calls ?? delta?.tool_calls ?? choice?.message?.tool_calls;
      if (Array.isArray(calls)) toolCalls.push(...calls);
    }

    return {
      content,
      toolCalls: toolCalls.map(normalizeToolCall),
      provider: "workers-ai",
      model,
      streamed: true,
    };
  },
};
