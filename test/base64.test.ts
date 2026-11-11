import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  chunkBytes,
  concatBytes,
} from "../src/storage/base64";

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array(2048);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("handles empty input", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(base64ToBytes("").length).toBe(0);
  });

  it("chunks and concatenates without losing data", () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
    const chunks = chunkBytes(bytes, 64);
    expect(chunks.length).toBe(16);
    expect([...concatBytes(chunks)]).toEqual([...bytes]);
  });
});
