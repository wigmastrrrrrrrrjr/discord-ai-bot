import { describe, expect, it } from "vitest";
import {
  buildScopedKey,
  sanitizeRelativeKey,
} from "../src/storage/keys";

describe("sanitizeRelativeKey", () => {
  it("strips path traversal", () => {
    expect(sanitizeRelativeKey("../../etc/passwd")).toBe("etc/passwd");
  });

  it("normalizes backslashes and duplicate slashes", () => {
    expect(sanitizeRelativeKey("a\\\\b//c")).toBe("a/b/c");
  });

  it("rejects empty keys", () => {
    expect(() => sanitizeRelativeKey("///")).toThrow();
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeRelativeKey("hello?world.txt")).toBe("hello_world.txt");
  });

  it("reserves the device metadata directory", () => {
    expect(sanitizeRelativeKey("_meta/secret.json")).toBe("file/secret.json");
  });

  it("keeps scoped keys inside the scope", () => {
    expect(buildScopedKey("guilds/1", "../x")).toBe("guilds/1/x");
  });

  it("rejects an invalid scope", () => {
    expect(() => buildScopedKey("../", "x")).toThrow();
  });
});
