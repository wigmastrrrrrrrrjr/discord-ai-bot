import { describe, expect, it } from "vitest";
import { providerOrder } from "../src/ai/router";
import type { Env } from "../src/env";

function envWith(order?: string): Env {
  return { AI_PROVIDER_ORDER: order } as Env;
}

describe("providerOrder", () => {
  it("uses the default order when unset", () => {
    expect(providerOrder(envWith())).toEqual([
      "mrouter",
      "openrouter",
      "ollama",
      "workers-ai",
    ]);
  });

  it("normalizes a custom order", () => {
    expect(providerOrder(envWith(" Ollama, OpenRouter ,, "))).toEqual([
      "ollama",
      "openrouter",
    ]);
  });
});
