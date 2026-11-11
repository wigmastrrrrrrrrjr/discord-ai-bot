import { describe, expect, it } from "vitest";
import { readSse } from "../src/ai/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const events: string[] = [];
  for await (const event of readSse(stream)) events.push(event);
  return events;
}

describe("readSse", () => {
  it("parses events split across chunks", async () => {
    const events = await collect(
      streamOf(['data: {"a":', '1}\n\ndata: [DONE]\n\n']),
    );
    expect(events).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("handles CRLF and multiline data", async () => {
    const events = await collect(
      streamOf(["data: one\r\ndata: two\r\n\r\ndata: three\r\n\r\n"]),
    );
    expect(events).toEqual(["one\ntwo", "three"]);
  });

  it("accepts raw JSON lines", async () => {
    const events = await collect(streamOf(['{"response":"hi"}\n\n']));
    expect(events).toEqual(['{"response":"hi"}']);
  });

  it("returns nothing for an empty body", async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});
