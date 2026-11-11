import type { Env } from "../env";
import { boolVar, intVar } from "../env";
import {
  sandboxDownload,
  sandboxExec,
  sandboxReadFile,
  sandboxServiceUrl,
  sandboxUpload,
  sandboxWriteFile,
} from "../sandbox";
import { BlobStore } from "../storage/blob-store";
import type { ToolCall, ToolDefinition } from "./types";
import { generateImage } from "./images";
import { v2Exec, v2WriteFile } from "../v2-agent";
import {
  getAgentState,
  agentMemoryWrite,
  compactAgentMemory as triggerAgentCompaction,
} from "../agent-memory";
import {
  awaitCommandResult,
  latestTokenForUser,
  queueRelayCommand,
} from "../agent-relay";

const WRITE_TOOL_NAMES = new Set(["write_file", "delete_file"]);
const MAX_TOOL_WRITE_BYTES = 256 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 12_000;

const ALL_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "terminal_exec",
      description:
        "Run a shell command in the persistent Linux sandbox. The working directory and exported environment variables survive between calls. Use this to inspect files, run scripts, install packages, build projects, and start servers.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command or multi-line script to run",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (1000-120000)",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_read_file",
      description:
        "Read a UTF-8 text file from the sandbox. Use terminal_exec for binary files or large outputs.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path in the sandbox, for example /home/user/app/index.html",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_write_file",
      description:
        "Write UTF-8 text to a file in the sandbox. Creates parent directories automatically.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path in the sandbox",
          },
          content: {
            type: "string",
            description: "Text content to write",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_download",
      description:
        "Download a URL into the sandbox filesystem. Useful for fetching assets, archives, or remote files.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Source URL to download",
          },
          path: {
            type: "string",
            description: "Optional destination path in the sandbox",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_upload",
      description:
        "Publish a file from the sandbox at a public URL. Use this to share screenshots, builds, or generated files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of an existing sandbox file",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_service_url",
      description:
        "Get the public HTTPS URL for a port where you started a server in the sandbox.",
      parameters: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Port number the server is listening on",
          },
        },
        required: ["port"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_request",
      description:
        "Make an HTTP request to an external URL. Use terminal_exec with curl when you need cookies, redirects, or files in the sandbox.",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
            default: "GET",
          },
          url: {
            type: "string",
            description: "Full URL to send the request to",
          },
          headers: {
            type: "object",
            description: "Request headers as key-value pairs",
            additionalProperties: { type: "string" },
          },
          body: {
            type: "string",
            description: "Request body (for POST/PUT/PATCH)",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files in the Discord blob storage. Keys are relative to this server or DM.",
      parameters: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description: "Optional key prefix to filter by, for example uploads/",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a UTF-8 text file from Discord blob storage. Binary files only return metadata.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "File key to read" },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_info",
      description: "Get size, content type, and storage location for a Discord blob.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "File key to inspect" },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write a UTF-8 text file to Discord blob storage. Only available when AI file writes are enabled.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "File key to write" },
          content: { type: "string", description: "Text content to write" },
          content_type: {
            type: "string",
            description: "Optional MIME type, defaults to text/plain",
          },
        },
        required: ["key", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "Delete a file from Discord blob storage. Only available when AI file writes are enabled.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "File key to delete" },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "v2_exec",
      description:
        "Run a shell command on the OWNER'S real machine (v2 beta agent host). Full access: install, build, git, run servers. Returns stdout/stderr. Prefer this when the task belongs on the real machine instead of the bot sandbox.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command executed with bash -lc." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "v2_write_file",
      description:
        "Create or overwrite a file on the OWNER'S real machine (v2 beta agent host) inside its jailed workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path inside the v2 workspace, e.g. 'src/app.py'." },
          content: { type: "string", description: "Full file content to write." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_memory_load",
      description:
        "Read your persistent memory. Use this at the start of a session or whenever you need details saved earlier. This is the only durable storage you have across sessions.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description:
              "Optional substring filter to view only relevant lines, e.g. 'project api'. Leave empty to get the whole memory.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_memory_save",
      description:
        "Overwrite your persistent memory with new content. Read memory first, merge your changes in, then save the full updated version. Memory is the only thing that persists between sessions.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The new full memory content.",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_compact",
      description:
        "Compact your memory when it gets close to the model context limit. Safely distills everything into a single digest and clears raw memory so nothing is truncated without your choice. Call it proactively — agent_memory_load tells you the current size.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "relay_exec",
      description:
        "Run a shell command on the USER'S real device through the agent-relay Python bridge. Use this when the user wants you to touch their machine — build, run, edit — instead of the bot's own sandbox. If the result says HALTED, tell the user to run `agentrelay refresh` and stop calling relay tools until a later call succeeds.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run on the user's device.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_img",
      description:
        "Generate an image from a text description using AI. The finished picture is posted in the chat automatically as an attachment; you do not need to link it. Keep prompts as a single vivid sentence describing the whole scene. Default style is a fast photo/urt painterly render; pass style 'detailed' for the slower, higher-quality Stable Diffusion XL render.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "What the image should show. One descriptive sentence with subject, setting and style.",
          },
          style: {
            type: "string",
            enum: ["fast", "detailed"],
            description:
              "'fast' (default) is quick and stylized; 'detailed' takes longer but looks more polished.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
];

export function toolsFor(env: Env): ToolDefinition[] {
  if (boolVar(env.ALLOW_AI_FILE_WRITES)) return ALL_TOOLS;
  return ALL_TOOLS.filter(
    (tool) => !WRITE_TOOL_NAMES.has(tool.function.name),
  );
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function isProbablyText(contentType: string, data: Uint8Array): boolean {
  const type = contentType.toLowerCase();
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("javascript") ||
    type.includes("yaml") ||
    type.includes("csv")
  ) {
    return true;
  }
  if (type && type !== "application/octet-stream") return false;

  const sample = data.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

function errorResult(error: unknown): string {
  return JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
  });
}

function truncate(value: string, limit = MAX_TOOL_OUTPUT_CHARS): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= limit) return { value, truncated: false };
  return {
    value: `${value.slice(0, limit)}\n… [truncated ${value.length - limit} chars]`,
    truncated: true,
  };
}

export interface ToolAuth {
  ghToken?: string | null;
}

export async function executeTool(
  env: Env,
  scope: string,
  call: ToolCall,
  auth?: ToolAuth,
): Promise<string> {
  const allowed = new Set(toolsFor(env).map((tool) => tool.function.name));
  if (!allowed.has(call.function.name)) {
    return JSON.stringify({
      error: `Tool "${call.function.name}" is not allowed`,
    });
  }

  let args: Record<string, unknown>;
  try {
    args = parseArguments(call.function.arguments);
  } catch (error) {
    return errorResult(error);
  }

  const store = new BlobStore(env, scope);
  const key = typeof args.key === "string" ? args.key : "";

  try {
    switch (call.function.name) {
      case "terminal_exec": {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command.trim()) {
          return JSON.stringify({ error: "command is required" });
        }
        const timeout =
          typeof args.timeout === "number" ? args.timeout : undefined;
        // A linked user's GitHub token is injected fresh per command —
        // it is never written into the shared sandbox shell.
        const ghPrefix = auth?.ghToken
          ? `export GH_TOKEN=${JSON.stringify(auth.ghToken).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\n`
          : "";
        const result = await sandboxExec(env, ghPrefix + command, timeout);
        const output = truncate(result.output ?? "");
        return JSON.stringify({
          output: output.value,
          exitCode: result.exitCode,
          truncated: Boolean(result.truncated) || output.truncated,
          error: result.error,
          saved_to: result.saved_to,
        });
      }

      case "terminal_read_file": {
        const path = typeof args.path === "string" ? args.path : "";
        if (!path) return JSON.stringify({ error: "path is required" });
        const result = await sandboxReadFile(env, path);
        const content = truncate(result.output ?? "");
        return JSON.stringify({
          path,
          content: content.value,
          truncated: content.truncated,
        });
      }

      case "terminal_write_file": {
        const path = typeof args.path === "string" ? args.path : "";
        const content = typeof args.content === "string" ? args.content : "";
        if (!path) return JSON.stringify({ error: "path is required" });
        const result = await sandboxWriteFile(env, path, content);
        return JSON.stringify(result);
      }

      case "terminal_download": {
        const url = typeof args.url === "string" ? args.url : "";
        const path = typeof args.path === "string" ? args.path : undefined;
        if (!url) return JSON.stringify({ error: "url is required" });
        const result = await sandboxDownload(env, url, path);
        return JSON.stringify(result);
      }

      case "terminal_upload": {
        const path = typeof args.path === "string" ? args.path : "";
        if (!path) return JSON.stringify({ error: "path is required" });
        const result = await sandboxUpload(env, path);
        return JSON.stringify(result);
      }

      case "terminal_service_url": {
        const port = typeof args.port === "number" ? args.port : Number(args.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return JSON.stringify({ error: "port must be 1-65535" });
        }
        const result = await sandboxServiceUrl(env, port);
        return JSON.stringify(result);
      }

      case "generate_img": {
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        if (!prompt.trim()) {
          return JSON.stringify({ error: "prompt is required" });
        }
        const style = args.style === "detailed" ? "detailed" : "fast";
        const image = await generateImage(env, prompt, style);
        const base64Data = Uint8Array.from(atob(image.base64), (c) =>
          c.charCodeAt(0),
        );
        const stamp = Date.now().toString(36);
        const blobKey = `generated/${stamp}-${Math.random().toString(36).slice(2, 8)}.${image.mime === "image/jpeg" ? "jpg" : "png"}`;
        await store.put(blobKey, base64Data, image.mime);
        return JSON.stringify({
          status: "generated",
          pending_attachment: blobKey,
          generator_model: image.model,
          size_bytes: base64Data.byteLength,
          note: "Image is ready and will be attached to your reply automatically. Tell the user what you created; do not invent a link.",
        });
      }

      case "v2_exec": {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command.trim()) return JSON.stringify({ error: "command is required" });
        const v2 = await v2Exec(env, command);
        return JSON.stringify({
          host: "owner-machine (theaichatbot v2 beta)",
          exit: v2.exit,
          output: v2.output,
        });
      }

      case "v2_write_file": {
        const v2Path = typeof args.path === "string" ? args.path : "";
        const v2Content = typeof args.content === "string" ? args.content : "";
        if (!v2Path.trim() || !v2Content) {
          return JSON.stringify({ error: "path and content are required" });
        }
        const v2 = await v2WriteFile(env, v2Path, v2Content);
        return JSON.stringify({ host: "owner-machine (theaichatbot v2 beta)", path: v2.path, bytes: v2.bytes });
      }

      case "agent_memory_load": {
        if (!scope.startsWith("users/")) {
          return JSON.stringify({ error: "agent memory is only available in an agent session" });
        }
        const userId = scope.slice("users/".length);
        const state = await getAgentState(env, userId);
        const wanted =
          typeof args.section === "string" && args.section.trim()
            ? args.section.trim().toLowerCase()
            : "";
        const lines = state.memory
          .split("\n")
          .filter((line) => !wanted || line.toLowerCase().includes(wanted));
        return JSON.stringify({
          total_chars: state.memory.length,
          memory: lines.join("\n").slice(0, 12000) || "(empty)",
          hint: state.memory.length > 20000
            ? "Memory is large — consider calling agent_compact before the context fills up"
            : "Call agent_compact proactively if memory plus conversation approaches the context limit",
        });
      }

      case "agent_memory_save": {
        if (!scope.startsWith("users/")) {
          return JSON.stringify({ error: "agent memory is only available in an agent session" });
        }
        const content = typeof args.content === "string" ? args.content : "";
        if (!content.trim()) return JSON.stringify({ error: "content is required" });
        await agentMemoryWrite(env, scope.slice("users/".length), content);
        return JSON.stringify({ status: "saved", chars: content.length });
      }

      case "agent_compact": {
        if (!scope.startsWith("users/")) {
          return JSON.stringify({ error: "agent memory is only available in an agent session" });
        }
        const result = await triggerAgentCompaction(env, scope.slice("users/".length));
        return JSON.stringify({
          status: "compacted",
          digest_chars: result.digest.length,
          digest_preview: result.digest.slice(0, 300),
          note: "Raw memory cleared and replaced by the digest. Nothing else was deleted.",
        });
      }

      case "relay_exec": {
        if (!scope.startsWith("users/")) {
          return JSON.stringify({ error: "relay is only available in a DM agent session" });
        }
        const userId = scope.slice("users/".length);
        const command = typeof args.command === "string" ? args.command : "";
        if (!command.trim()) return JSON.stringify({ error: "command is required" });
        const active = await latestTokenForUser(env, userId);
        if (!active) {
          return JSON.stringify({
            status: "HALTED",
            reason: "no active relay bridge",
            action: "Tell the user to run `agentrelay bind` on their device, then try again.",
          });
        }
        const queued = await queueRelayCommand(env, userId, command);
        if (queued.halted) {
          return JSON.stringify({
            status: "HALTED",
            reason: queued.reason,
            action: "Tell the user to run `agentrelay refresh`; continue the same task once relay calls succeed again.",
          });
        }
        const result = await awaitCommandResult(env, queued.id!, 60_000);
        if (result === null) {
          return JSON.stringify({
            status: "timeout",
            note: "The user's device did not answer in 60s. It may be offline; you can retry or continue elsewhere.",
          });
        }
        return JSON.stringify({ status: "done", output: result.slice(0, 12000) });
      }

      case "http_request": {
        const method = typeof args.method === "string" ? args.method : "GET";
        const url = typeof args.url === "string" ? args.url : "";
        if (!url) return JSON.stringify({ error: "url is required" });

        const headers: Record<string, string> = {};
        if (
          args.headers &&
          typeof args.headers === "object" &&
          !Array.isArray(args.headers)
        ) {
          for (const [name, value] of Object.entries(args.headers)) {
            if (typeof value === "string") headers[name] = value;
          }
        }

        const fetchOptions: RequestInit = { method, headers };
        if (
          args.body &&
          typeof args.body === "string" &&
          ["POST", "PUT", "PATCH"].includes(method)
        ) {
          fetchOptions.body = args.body;
        }

        const response = await fetch(url, fetchOptions);
        const text = await response.text();
        const body = truncate(text);
        return JSON.stringify({
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: body.value,
          truncated: body.truncated,
        });
      }

      case "list_files": {
        const prefix = typeof args.prefix === "string" ? args.prefix : "";
        const files = await store.list(prefix);
        return JSON.stringify({
          files: files.slice(0, 100).map((file) => ({
            key: file.key,
            size: file.size,
            content_type: file.contentType,
            location: file.location,
          })),
          truncated: files.length > 100,
        });
      }

      case "read_file": {
        if (!key) return JSON.stringify({ error: "key is required" });
        const blob = await store.get(key);
        if (!blob) return JSON.stringify({ error: "File not found" });

        const maxBytes = intVar(env.MAX_TOOL_READ_BYTES, 64 * 1024);
        const truncated = blob.data.byteLength > maxBytes;
        const slice = truncated ? blob.data.subarray(0, maxBytes) : blob.data;

        if (!isProbablyText(blob.contentType, slice)) {
          return JSON.stringify({
            key: blob.key,
            size: blob.data.byteLength,
            content_type: blob.contentType,
            location: blob.location,
            binary: true,
            note: "Binary file content is not returned.",
          });
        }

        return JSON.stringify({
          key: blob.key,
          size: blob.data.byteLength,
          content_type: blob.contentType,
          location: blob.location,
          truncated,
          content: new TextDecoder().decode(slice),
        });
      }

      case "file_info": {
        if (!key) return JSON.stringify({ error: "key is required" });
        const info = await store.stat(key);
        if (!info) return JSON.stringify({ error: "File not found" });
        return JSON.stringify(info);
      }

      case "write_file": {
        if (!key) return JSON.stringify({ error: "key is required" });
        const content = typeof args.content === "string" ? args.content : "";
        if (!content) return JSON.stringify({ error: "content is required" });

        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > MAX_TOOL_WRITE_BYTES) {
          return JSON.stringify({
            error: `content is too large (max ${MAX_TOOL_WRITE_BYTES} bytes)`,
          });
        }

        const contentType =
          typeof args.content_type === "string" && args.content_type
            ? args.content_type
            : "text/plain; charset=utf-8";
        const result = await store.put(key, bytes, contentType);
        return JSON.stringify({ ok: true, ...result });
      }

      case "delete_file": {
        if (!key) return JSON.stringify({ error: "key is required" });
        const result = await store.delete(key);
        return JSON.stringify({ ok: true, ...result });
      }

      default:
        return JSON.stringify({ error: "Unknown tool" });
    }
  } catch (error) {
    return errorResult(error);
  }
}
