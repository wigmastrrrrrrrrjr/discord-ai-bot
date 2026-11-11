export {};

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;

if (!token || !applicationId) {
  console.error(
    "Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID before clearing commands.",
  );
  process.exit(1);
}

const guildIndex = process.argv.indexOf("--guild");
const guildId =
  guildIndex >= 0
    ? process.argv[guildIndex + 1]
    : process.env.DISCORD_GUILD_ID;

const urls = [
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
];
if (guildId) {
  urls.push(
    `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  );
}

for (const url of urls) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: "[]",
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`Failed to clear ${url} (${response.status}): ${text}`);
    process.exitCode = 1;
    continue;
  }

  console.log(`Cleared commands at ${url}`);
}
