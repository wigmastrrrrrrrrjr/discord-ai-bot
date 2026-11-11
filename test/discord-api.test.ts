import { describe, expect, it } from "vitest";
import { splitMessage } from "../src/discord/api";

describe("splitMessage", () => {
  it("returns Done for empty input", () => {
    expect(splitMessage("")).toEqual(["Done."]);
  });

  it("keeps short messages intact", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("splits long messages under the limit", () => {
    const text = "word ".repeat(1000);
    const chunks = splitMessage(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.trim(),
    );
  });
});
