import type { Interaction } from "./types";
import { MessageFlags } from "./types";

const DISCORD_API = "https://discord.com/api/v10";
const MESSAGE_LIMIT = 1900;

export interface OutgoingFile {
  name: string;
  data: Uint8Array;
  contentType?: string;
}

export interface MessagePayload {
  content?: string;
  files?: OutgoingFile[];
  ephemeral?: boolean;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function deferredResponse(ephemeral: boolean): Response {
  return jsonResponse({
    type: 5,
    data: ephemeral ? { flags: MessageFlags.Ephemeral } : {},
  });
}

export function immediateMessage(content: string, ephemeral = false): Response {
  return jsonResponse({
    type: 4,
    data: {
      content,
      ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    },
  });
}

function webhookUrl(interaction: Interaction, suffix: string): string {
  return `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}${suffix}`;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

function payloadFlags(ephemeral: boolean | undefined): Record<string, unknown> {
  return ephemeral ? { flags: MessageFlags.Ephemeral } : {};
}

async function discordRequest(
  url: string,
  method: "PATCH" | "POST",
  payload: MessagePayload,
): Promise<void> {
  let response: Response;

  if (payload.files?.length) {
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({
        content: payload.content,
        attachments: payload.files.map((file, index) => ({
          id: index,
          filename: file.name,
        })),
        allowed_mentions: { parse: [] },
        ...payloadFlags(payload.ephemeral),
      }),
    );
    payload.files.forEach((file, index) => {
      form.append(
        `files[${index}]`,
        new Blob([toArrayBuffer(file.data)], {
          type: file.contentType || "application/octet-stream",
        }),
        file.name,
      );
    });
    response = await fetch(url, { method, body: form });
  } else {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: payload.content,
        allowed_mentions: { parse: [] },
        ...payloadFlags(payload.ephemeral),
      }),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Discord ${method} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
}

export async function editOriginal(
  interaction: Interaction,
  payload: MessagePayload,
): Promise<void> {
  await discordRequest(
    webhookUrl(interaction, "/messages/@original"),
    "PATCH",
    payload,
  );
}

export async function followUp(
  interaction: Interaction,
  payload: MessagePayload,
): Promise<void> {
  await discordRequest(webhookUrl(interaction, ""), "POST", payload);
}

export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ["Done."];

  const chunks: string[] = [];
  let rest = trimmed;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest) chunks.push(rest);
  return chunks.length ? chunks : ["Done."];
}

export async function sendText(
  interaction: Interaction,
  text: string,
  ephemeral: boolean,
): Promise<void> {
  const chunks = splitMessage(text);
  await editOriginal(interaction, {
    content: chunks[0],
    ephemeral,
  });
  for (const chunk of chunks.slice(1)) {
    await followUp(interaction, { content: chunk, ephemeral });
  }
}

export async function sendFile(
  interaction: Interaction,
  content: string,
  file: OutgoingFile,
  ephemeral: boolean,
): Promise<void> {
  try {
    await editOriginal(interaction, {
      content,
      files: [file],
      ephemeral,
    });
  } catch (error) {
    // Some Discord API edge cases reject multipart PATCH. Fall back to a
    // regular follow-up message with the attachment.
    try {
      await followUp(interaction, {
        content,
        files: [file],
        ephemeral,
      });
      await editOriginal(interaction, {
        content: "File sent in the message below.",
        ephemeral,
      });
    } catch {
      throw error;
    }
  }
}
