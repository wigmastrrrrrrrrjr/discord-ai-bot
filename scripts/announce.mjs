#!/usr/bin/env node
// Push an update announcement to every server that opted in.
// Usage: npm run announce -- "Added image generation (\`generate_img\`) to every chat."
// Reads the bot's URL and posting token from env: BOT_URL and BOT_UPDATE_TOKEN.

const url = (process.env.BOT_URL ?? "https://discord-ai-bot.csomeone301.workers.dev").replace(/\/+$/, "");
const token = process.env.BOT_UPDATE_TOKEN ?? "";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("No announcement text given.");
  process.exit(1);
}
if (!token) {
  console.error("Set BOT_UPDATE_TOKEN first (see scripts/announce-token.txt).");
  process.exit(1);
}

const response = await fetch(`${url}/api/bot/update`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-update-token": token,
  },
  body: JSON.stringify({ message }),
});

if (!response.ok) {
  console.error(`Failed: HTTP ${response.status} — ${await response.text()}`);
  process.exit(1);
}

const result = await response.json();
console.log(
  `Announcement pushed: ${result.sent} server(s) pinged, ${result.failed} skipped.`,
);
