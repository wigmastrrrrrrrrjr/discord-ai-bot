import { describe, expect, it } from "vitest";
import { trimHistory } from "../src/memory";

describe("trimHistory", () => {
  it("keeps the most recent messages", () => {
    const history = [
      { role: "user" as const, content: "one" },
      { role: "assistant" as const, content: "two" },
      { role: "user" as const, content: "three" },
    ];
    expect(trimHistory(history, 2)).toEqual(history.slice(1));
  });

  it("always keeps at least one message", () => {
    const history = [{ role: "user" as const, content: "one" }];
    expect(trimHistory(history, 0)).toEqual(history);
  });
});
