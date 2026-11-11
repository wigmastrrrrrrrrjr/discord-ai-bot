import { describe, expect, it } from "vitest";
import {
  isBotMentioned,
  shouldRespond,
  stripBotMention,
} from "../src/discord/agent-trigger";

const BOT_ID = "1565885759280386078";

describe("agent triggers", () => {
  it("responds to DMs", () => {
    expect(
      shouldRespond({
        channelId: "dm-channel",
        content: "hello",
        botId: BOT_ID,
      }),
    ).toBe(true);
  });

  it("responds to mentions", () => {
    expect(
      shouldRespond({
        guildId: "guild",
        channelId: "channel",
        content: `<@${BOT_ID}> list the files`,
        botId: BOT_ID,
      }),
    ).toBe(true);
  });

  it("responds to replies to the bot", () => {
    expect(
      shouldRespond({
        guildId: "guild",
        channelId: "channel",
        content: "continue",
        botId: BOT_ID,
        referencedAuthorId: BOT_ID,
      }),
    ).toBe(true);
  });

  it("responds in the configured auto-reply channel", () => {
    expect(
      shouldRespond({
        guildId: "guild",
        channelId: "channel",
        content: "hello",
        botId: BOT_ID,
        configuredChannelId: "channel",
        autoReply: true,
      }),
    ).toBe(true);
  });

  it("ignores unrelated guild messages", () => {
    expect(
      shouldRespond({
        guildId: "guild",
        channelId: "channel",
        content: "hello",
        botId: BOT_ID,
        configuredChannelId: "other",
        autoReply: true,
      }),
    ).toBe(false);
  });

  it("responds to attachment-only DMs", () => {
    expect(
      shouldRespond({
        channelId: "dm-channel",
        content: "",
        hasAttachments: true,
        botId: BOT_ID,
      }),
    ).toBe(true);
  });

  it("strips both mention forms", () => {
    expect(stripBotMention(`<@${BOT_ID}> hi`, BOT_ID)).toBe("hi");
    expect(stripBotMention(`<@!${BOT_ID}> hi`, BOT_ID)).toBe("hi");
    expect(isBotMentioned(`<@!${BOT_ID}>`, BOT_ID)).toBe(true);
  });
});
