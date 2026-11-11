# Discord AI Agent on Cloudflare Workers

A serverless Discord agent that runs on Cloudflare Workers. It has no slash commands. You talk to it directly in Discord, and it acts through an attached Linux terminal sandbox.

It supports:

- Replies in DMs, when mentioned, when replied to, or in one configured channel per server
- An autonomous agent loop with tool calling
- A persistent Linux terminal sandbox over HTTP
- Sandbox file read/write, download, upload, and public service URLs
- AI fallback chain: Workers AI → OpenRouter → Ollama Cloud (configurable)
- Per-channel conversation memory in KV
- Device-first blob storage with a D1 overflow queue
- An OAuth2 dashboard for configuring the agent trigger and system prompt

## Architecture

```text
Discord
  │  Gateway WebSocket
  ▼
Durable Object /gateway
  ├─ IDENTIFY / heartbeat / resume
  ├─ filter DMs, mentions, replies, and the configured channel
  ├─ read D1 guild config
  ├─ download attachments to blob storage
  ├─ run the agent loop
  └─ send/edit replies via Discord REST

Agent loop
  ├─ Workers AI
  ├─ OpenRouter
  ├─ Ollama Cloud
  └─ tools
       ├─ terminal_exec
       ├─ terminal_read_file / terminal_write_file
       ├─ terminal_download / terminal_upload
       ├─ terminal_service_url
       ├─ http_request
       └─ blob storage tools

Attached sandbox
  └─ HTTP API at SANDBOX_URL
       ├─ /api/exec
       ├─ /api/readfile, /api/writefile
       ├─ /api/download, /api/upload
       └─ /api/serviceurl

Dashboard /dashboard
  ├─ Discord OAuth2 (identify + guilds)
  ├─ KV: sessions and OAuth state
  └─ D1: per-guild trigger channel, auto-reply, system prompt
```

## Prerequisites

- Node.js 20+ and npm
- A Cloudflare account with Workers, KV, D1, Durable Objects, and Workers AI enabled
- A Discord application
- An attached terminal sandbox that exposes the HTTP API described below
- Optional: a device that can run the reference blob server and expose it through Cloudflare Tunnel, Tailscale Funnel, or another HTTPS tunnel

## 1. Create the Discord application

1. Open <https://discord.com/developers/applications> and create an application.
2. On **General Information**, copy the **Application ID** and **Public Key**.
3. On **Bot**, reset and copy the **Bot Token**.
4. On **Bot**, enable **Message Content Intent**. The agent cannot read normal messages without it.
5. On **OAuth2 → General**, copy the **Client Secret**. Leave **Requires OAuth2 Code Grant** disabled.
6. On **Installation**, use the `bot` scope. Slash commands are not used.
7. Do not set the **Interactions Endpoint URL** yet. Set it after deployment.
8. Add the bot to your server with **View Channel**, **Read Message History**, and **Send Messages** permissions.

## 2. Create Cloudflare resources

Install dependencies:

```bash
npm install
```

Log in to Cloudflare:

```bash
npx wrangler login
```

Create a KV namespace for conversation history:

```bash
npx wrangler kv namespace create CONVERSATIONS
```

Copy the returned namespace `id` into `wrangler.jsonc` (`kv_namespaces[0].id`).

Create the D1 database:

```bash
npx wrangler d1 create discord-ai-bot
```

Copy the returned `database_id` into `wrangler.jsonc` (`d1_databases[0].database_id`).

Apply migrations remotely:

```bash
npm run db:migrate:remote
```

The migrations create `temp_blobs`, `temp_blob_chunks`, and `guild_configs`. Temporary files are stored as base64 chunks, so each D1 row stays well below the 2 MB row limit.

## 3. Configure secrets

Deploy once so the Worker exists, then set secrets:

```bash
npm run deploy
```

Set the required Worker secrets:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

`DISCORD_BOT_TOKEN` is required for the gateway and dashboard channel picker. `DISCORD_CLIENT_ID` is the Application ID. `DISCORD_CLIENT_SECRET` comes from OAuth2 → General.

Optionally restrict dashboard logins to one Discord user:

```bash
npx wrangler secret put DASHBOARD_OWNER_ID
```

If you are using a device, set its URL and token:

```bash
npx wrangler secret put DEVICE_BLOB_URL
npx wrangler secret put DEVICE_BLOB_TOKEN
```

Set at least one external AI provider key if you want fallback beyond Workers AI:

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OLLAMA_API_KEY
```

Workers AI uses the `AI` binding and does not need an API key. OpenRouter and Ollama are skipped automatically when their keys are missing.

The sandbox URL is a normal Worker variable, not a secret. Set it in `wrangler.jsonc`:

```jsonc
"vars": {
  "SANDBOX_URL": "https://your-sandbox.example.com",
  "SANDBOX_TIMEOUT_MS": "60000"
}
```

The sandbox API needs no authentication. Only attach a sandbox you control.

## 4. Set the Discord interactions endpoint

After deployment, Wrangler prints a URL such as:

```text
https://discord-ai-bot.<your-subdomain>.workers.dev
```

In the Discord developer portal, set **Interactions Endpoint URL** to:

```text
https://discord-ai-bot.<your-subdomain>.workers.dev/interactions
```

Discord sends a signed `PING` immediately. The Worker must return a valid pong or Discord will refuse to save the URL. If saving fails, check the public key secret and the Worker logs:

```bash
npx wrangler tail
```

In **OAuth2 → Redirects**, add the dashboard callback URL:

```text
https://discord-ai-bot.<your-subdomain>.workers.dev/auth/callback
```

Open the dashboard at:

```text
https://discord-ai-bot.<your-subdomain>.workers.dev/dashboard
```

## 5. Clear old slash commands

If this bot previously had slash commands, remove them. Set the bot token and application ID, then run:

```bash
export DISCORD_BOT_TOKEN="..."
export DISCORD_APPLICATION_ID="..."
export DISCORD_GUILD_ID="..."
npm run clear-commands
```

The script clears both global commands and commands in `DISCORD_GUILD_ID`. The bot does not register any new commands.

## 6. Run the device blob server (optional)

The bot works without a device: everything is stored in D1 temporary storage and expires after 30 days. To keep files permanently, run the reference server on your device.

```bash
cd device-server
export DEVICE_BLOB_TOKEN="$(openssl rand -hex 32)"
echo "$DEVICE_BLOB_TOKEN"   # copy this into `wrangler secret put DEVICE_BLOB_TOKEN`
BLOB_DIR="$HOME/discord-blobs" PORT=8787 node server.mjs
```

Expose it with Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
```

Use the resulting HTTPS URL as `DEVICE_BLOB_URL` and the generated token as `DEVICE_BLOB_TOKEN`.

A named Cloudflare Tunnel is recommended so the URL stays stable.

### Device API contract

All endpoints require `Authorization: Bearer <DEVICE_BLOB_TOKEN>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Return `200` when the device is available |
| `GET` | `/objects?prefix=<prefix>&limit=500` | Return `{ "objects": [{ "key", "size", "contentType", "lastModified" }] }` |
| `PUT` | `/objects/<key>` | Store raw request body with the request `Content-Type` |
| `GET` | `/objects/<key>` | Return raw file bytes and content type |
| `HEAD` | `/objects/<key>` | Return file metadata headers, no body |
| `DELETE` | `/objects/<key>` | Delete the object |

Keys are slash-separated and URL-encoded per segment. The reference server stores files under `BLOB_DIR` and metadata under `BLOB_DIR/_meta`.

## 7. Configure the agent trigger

1. Open `/dashboard` and log in with Discord.
2. Pick the server and the text channel where the agent should reply without a mention.
3. Turn on **Reply to every human message in this channel**.
4. Optionally set a custom system prompt, then click **Save settings**.

The dashboard starts the Gateway Durable Object automatically. The Gateway card shows whether the WebSocket is connected and displays the last error if not.

The agent responds when:

- The message is a DM
- The bot is mentioned
- The message is a reply to the bot
- The message is in the configured channel and auto-reply is enabled

The bot ignores messages from other bots and webhooks. It uses per-channel KV history. DMs use per-user history.

## Sandbox API

The Worker expects the attached sandbox to expose the terminal API at `SANDBOX_URL`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/exec` | Run a shell command in a persistent bash session |
| `POST` | `/api/readfile` | Read a UTF-8 file |
| `POST` | `/api/writefile` | Write a UTF-8 file |
| `POST` | `/api/download` | Download a URL into the sandbox |
| `POST` | `/api/upload` | Publish a sandbox file at a public URL |
| `GET` | `/api/serviceurl?port=N` | Get the public URL for a port |

`/api/exec` accepts `{ "command": "...", "timeout": 60000 }` and returns `{ output, exitCode, error?, truncated?, saved_to? }`.

The agent's terminal tools:

| Tool | Purpose |
| --- | --- |
| `terminal_exec` | Run shell commands in the persistent sandbox |
| `terminal_read_file` | Read a sandbox text file |
| `terminal_write_file` | Write a sandbox text file |
| `terminal_download` | Download a URL into the sandbox |
| `terminal_upload` | Publish a sandbox file at a public URL |
| `terminal_service_url` | Get the public URL for a running server |

## Configuration

All configuration is optional except the Discord secrets. Values live in `wrangler.jsonc` under `vars`; override secrets with `wrangler secret put`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SANDBOX_URL` | built-in sandbox URL | Base URL of the attached terminal sandbox |
| `SANDBOX_TIMEOUT_MS` | `60000` | Default sandbox command timeout |
| `AI_PROVIDER_ORDER` | `workers-ai,openrouter,ollama` | Comma-separated fallback order |
| `WORKERS_AI_MODEL` | `@cf/openai/gpt-oss-120b` | Workers AI model (must support function calling for tools) |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | OpenRouter model |
| `OLLAMA_BASE_URL` | `https://ollama.com` | Ollama API base URL |
| `OLLAMA_MODEL` | `gpt-oss:20b` | Ollama model |
| `SYSTEM_PROMPT` | built-in prompt | Override the system prompt |
| `MAX_HISTORY_MESSAGES` | `20` | Conversation messages kept per channel |
| `MAX_TEMP_BLOB_BYTES` | `5242880` (5 MiB) | Largest file allowed in D1 temp storage |
| `TEMP_BLOB_TTL_DAYS` | `30` | Days before an unsynced temp blob is deleted |
| `DEVICE_TIMEOUT_MS` | `4000` | Device API timeout |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MiB) | Largest Discord attachment accepted |
| `MAX_DISCORD_UPLOAD_BYTES` | `8388608` (8 MiB) | Largest file returned to Discord |
| `MAX_TOOL_READ_BYTES` | `65536` | Text returned by the `read_file` AI tool |
| `SYNC_BATCH_SIZE` | `10` | Temp blobs moved per cron/manual sync |
| `ALLOW_AI_FILE_WRITES` | `false` | Allow the AI to call blob `write_file` and `delete_file` |
| `SHOW_PROVIDER` | `true` | Append a small "via provider · model" footer to answers |
| `DASHBOARD_OWNER_ID` | unset | Optional Discord user ID allowed to use the dashboard |

### AI fallback behavior

- Providers are tried in `AI_PROVIDER_ORDER`.
- Unconfigured providers are skipped.
- A provider that fails is put into a 60-second KV cooldown so subsequent requests do not hammer it.
- Tool definitions are normalized for Workers AI's traditional function-calling format and OpenAI-compatible formats for OpenRouter/Ollama.
- If every provider fails, the Discord message includes a short error summary and the full error is logged.

### Storage lifecycle

1. Writes go to the device first.
2. If the device is unreachable, the file is written to D1 as chunked base64 with a 30-day expiry.
3. Every 15 minutes the Worker checks `/health`. If the device is online, pending blobs are uploaded and their D1 rows are deleted.
4. Expired temp blobs are deleted even if the device never comes back.
5. Files on the device are never auto-deleted.

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in the values
npm run db:migrate:local
npm run dev
```

Wrangler serves on `http://localhost:8787`. Discord cannot reach localhost, so expose it with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
```

Set the Discord interactions endpoint to `<tunnel-url>/interactions`.

Run checks:

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

## Security notes

- Every interaction is verified with Discord's Ed25519 signature before parsing.
- Responses disable mention parsing (`allowed_mentions: { parse: [] }`), so model output cannot ping `@everyone`.
- The agent has shell access to the attached sandbox. Only attach a sandbox you control, and do not put production secrets in it.
- The sandbox API has no authentication. Keep its URL private or put it behind access control.
- The agent is instructed not to run destructive commands, but instructions are not a security boundary. Use a disposable sandbox.
- File keys are scoped per guild or DM user and sanitized against path traversal.
- Blob writes/deletes require `ALLOW_AI_FILE_WRITES=true`.
- The device API uses a bearer token. Always expose it over HTTPS; never use plain HTTP on the public internet.
- Secrets are stored with `wrangler secret`, not in `wrangler.jsonc`.

## Limitations

- The agent has no slash commands. It only responds to DMs, mentions, replies, and the configured channel.
- A sandbox command is limited to 120 seconds per call by the sandbox API.
- The sandbox is shared and persistent. Concurrent conversations can affect each other's files and working directory.
- D1 temp fallback is bounded by `MAX_TEMP_BLOB_BYTES`; large files require the device to be online.
- Workers AI tool calling depends on the selected model. If a model does not support tools, change `WORKERS_AI_MODEL` or rely on OpenRouter/Ollama.
- Discord follow-ups must be sent within 15 minutes of the deferred response. Very long tool loops could exceed that window.
- Conversation history expires after 7 days and is capped by `MAX_HISTORY_MESSAGES`.

## Troubleshooting

- **Discord says "invalid interactions endpoint"**: the Worker returned 401 or an invalid pong. Check `DISCORD_PUBLIC_KEY`, deploy status, and `npx wrangler tail`.
- **All AI providers failed**: check model names and API keys. Workers AI model IDs are case-sensitive. Inspect the error shown in Discord and in `wrangler tail`.
- **Agent does not reply**: confirm the message is a DM, mention, reply, or in the configured channel. Check that **Message Content Intent** is enabled and the gateway is connected.
- **Gateway says "Message Content Intent is disabled"**: enable it under Bot → Privileged Gateway Intents, then restart the gateway from the dashboard.
- **Gateway says "Invalid DISCORD_BOT_TOKEN"**: reset the bot token and update the Worker secret.
- **Sandbox tools fail**: confirm `SANDBOX_URL` is reachable from Cloudflare and returns the documented API responses. Check `npx wrangler tail`.
- **Device always offline**: confirm `DEVICE_BLOB_URL` has no trailing slash, the tunnel is running, `/health` returns 200 with the bearer token, and `DEVICE_BLOB_TOKEN` matches the server.
- **Dashboard login fails**: add `https://<worker-domain>/auth/callback` to OAuth2 → Redirects and verify `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`.
