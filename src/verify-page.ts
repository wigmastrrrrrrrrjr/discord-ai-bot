export const VERIFY_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify your Discord account</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.6; color: #1f2937; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,.06); }
  button { background: #5865f2; color: #fff; border: 0; border-radius: 8px; padding: 12px 18px; font-size: 16px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  .muted { color: #6b7280; font-size: 14px; }
  .error { color: #b91c1c; }
  .ok { color: #047857; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div class="card">
  <h1>Verify your Discord account</h1>
  <p>This server requires verification before you can access its channels.</p>
  <p class="muted">By continuing, you consent to the collection of your IP address and a device fingerprint for anti-abuse and ban-evasion prevention. See the <a href="/terms">Terms of Service and Terms of Use</a>. The attached terminal sandbox is operated by <a href="https://treysbot.xyz/">treysbot.xyz</a>; sandbox use is also subject to their <a href="https://treysbot.xyz/tos-privacy/">Terms of Service</a> and <a href="https://treysbot.xyz/tos-privacy/#privacy">Privacy Policy</a>.</p>
  <p id="status" class="muted">Checking your Discord session…</p>
  <button id="verifyButton" disabled>Connect Discord and verify</button>
  <p id="result"></p>
</div>
<script>
(function () {
  const params = new URLSearchParams(location.search);
  const guildId = params.get('guild') || '';
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const button = document.getElementById('verifyButton');

  async function api(path, options) {
    const response = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, options || {}));
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error((data && data.error) || ('HTTP ' + response.status));
    return data;
  }

  async function fingerprint() {
    const pieces = [];
    pieces.push(navigator.userAgent || '');
    pieces.push(navigator.language || '');
    pieces.push(navigator.platform || '');
    pieces.push(String(screen.width) + 'x' + String(screen.height) + 'x' + String(screen.colorDepth));
    pieces.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    pieces.push(String(navigator.hardwareConcurrency || ''));
    pieces.push(String(navigator.deviceMemory || ''));
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('verification-fingerprint', 2, 2);
      pieces.push(canvas.toDataURL());
    } catch (e) {}
    const input = pieces.join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function init() {
    if (!guildId) {
      status.textContent = 'Missing guild ID.';
      return;
    }
    try {
      const session = await api('/api/session');
      status.textContent = 'Signed in as ' + (session.user.globalName || session.user.username) + '. Ready to verify.';
      button.disabled = false;
    } catch (error) {
      status.textContent = 'You need to sign in with Discord first.';
      const login = document.createElement('a');
      login.href = '/auth/discord?next=' + encodeURIComponent('/verify?guild=' + encodeURIComponent(guildId));
      login.textContent = 'Sign in with Discord';
      login.className = 'button';
      status.appendChild(document.createElement('br'));
      status.appendChild(login);
    }
  }

  button.addEventListener('click', async function () {
    button.disabled = true;
    result.textContent = 'Verifying…';
    result.className = 'muted';
    try {
      const fp = await fingerprint();
      const data = await api('/api/verify/complete', {
        method: 'POST',
        body: JSON.stringify({ guildId: guildId, fingerprint: fp })
      });
      if (data.banned) {
        result.textContent = data.message || 'You were already banned in this server.';
        result.className = 'error';
      } else {
        result.textContent = data.message || 'You are now verified.';
        result.className = 'ok';
      }
    } catch (error) {
      result.textContent = error.message || 'Verification failed.';
      result.className = 'error';
      button.disabled = false;
    }
  });

  init();
})();
</script>
</body>
</html>`;
