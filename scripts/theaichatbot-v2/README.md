# theaichatbot v2 (beta)

Local Go agent server for the discord-ai-bot worker. Full machine access,
jailed file writes. Public via a cloudflared quick tunnel.

## Run

```bash
cd scripts/theaichatbot-v2
CGO_ENABLED=0 go build -o theaichatbot-v2 .
V2_TOKEN=<long-random-string> V2_ROOT=/home/coder/theaichatbot-v2 ./theaichatbot-v2
```

Then, in another terminal:

```bash
export SSL_CERT_FILE=/data/data/com.termux/files/usr/lib/python3.14/site-packages/certifi/cacert.pem
/home/coder/bin/cloudflared tunnel --url http://127.0.0.1:8818
```

Copy the printed `https://<name>.trycloudflare.com` into the worker var
`V2_AGENT_URL` in `wrangler.jsonc` (tunnel URL changes per restart) and
`npx wrangler secret put V2_AGENT_TOKEN` with the same `V2_TOKEN`.

## Endpoints (Bearer auth)

- `GET /v2/health`
- `POST /v2/command` `{"command": "echo hi"}` — runs inside `unshare -Urm`
  (user + mount ns, cwd locked to V2_ROOT; system dirs read-only)
- `POST /v2/read` `{"path": "src/x.py", "startLine": 100, "endLine": 200}` —
  numbered slice, 500-line cap per call
- `POST /v2/file` `{"path": "src/x.py", "content": "..."}` (jailed to V2_ROOT)

Pre-installed in the sandbox: python venv `.venv` (requests, beautifulsoup4,
rich), node modules `node-lib` (axios). Node needs
`LD_LIBRARY_PATH=/home/coder/.local/lib`. Tunnel URL is per-restart — update
`V2_AGENT_URL` in `wrangler.jsonc` and redeploy after restarting. 

## Worker side

- Tools: `v2_exec`, `v2_write_file` in `src/ai/tools.ts`
- Slash command: `/v2 prompt:<task>` (appends `-# v2 beta test, bound to change`)
- Debug: `POST /api/debug/tool` with `x-update-token`, tools `v2_exec`,
  `v2_write_file`, `v2_health` (health needs `botApi`-style auth token header too)
