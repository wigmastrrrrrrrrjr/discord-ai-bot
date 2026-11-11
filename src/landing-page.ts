export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>theAIchatbot — AI bot for Discord with a web agent</title>
<meta name="description" content="theAIchatbot is a free AI assistant for your Discord server plus a web agent at /agent. Tools, memory, image generation, and open model routing.">
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #0b0f14; color: #e5edf5; line-height: 1.6; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 64px; }
  h1 { font-size: 30px; margin: 0 0 8px; }
  p.dim { color: #8ea0b3; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 28px 0; }
  @media (max-width: 700px) { .cards { grid-template-columns: 1fr; } }
  .card { background: #121821; border: 1px solid #1f2937; border-radius: 12px; padding: 18px; }
  .card h2 { margin: 0 0 6px; font-size: 17px; }
  .card p { margin: 0 0 12px; color: #8ea0b3; font-size: 14px; }
  .btn { display: inline-block; background: #4f8cff; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; }
  .btn.ghost { background: transparent; border: 1px solid #2a3a52; color: #e5edf5; }
  ul { color: #8ea0b3; font-size: 14px; padding-left: 20px; }
  .links { margin-top: 34px; font-size: 13px; color: #8ea0b3; }
  .links a { color: #4f8cff; margin-right: 14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>theAIchatbot</h1>
  <p class="dim">A free AI assistant for your Discord server — and a web agent you can use right here.</p>

  <div class="cards">
    <div class="card">
      <h2>Web agent</h2>
      <p>Full agent in your browser: tools, memory, saved sessions. Sign in with Google or Discord.</p>
      <a class="btn" href="/agent">Open the agent</a>
    </div>
    <div class="card">
      <h2>Discord bot</h2>
      <p>Add the bot to your server: AI chat channels, image generation, automod, verification, custom commands.</p>
      <a class="btn ghost" href="/dashboard">Manage your server</a>
    </div>
  </div>

  <ul>
    <li>Free model routing across open providers — no API key required to start.</li>
    <li>Optional tools: code sandbox, image generation, memory, per-server announcements.</li>
    <li>Every saved session is encrypted at rest.</li>
  </ul>

  <p class="dim">When you use the service, you agree to follow the linked terms. If you are under 18, you need a parent or guardian to supervise you to use this service.</p>

  <div class="links">
    <a href="/terms">Terms of Service</a>
    <a href="/terms-of-use">Terms of Use</a>
    <a href="/privacy">Privacy Policy</a>
  </div>
</div>
</body>
</html>`;
