// Owner console: a single-page command center for the bot owner (Discord
// user 1536981526451982431). Everything reads decrypted where data is
// encrypted at rest; legacy plaintext values are shown as-is.

const OWNER_USER_ID = "1536981526451982431";

const OWNER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Owner Console — theAIchatbot</title>
<style>
  :root { --bg:#0a0e14; --panel:#111826; --line:#1e2937; --text:#dbe4f0; --dim:#7d8da3; --accent:#4f8ef7; --danger:#e5484d; --ok:#2f8f57; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  a { color:var(--accent); }
  header { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:5; flex-wrap:wrap; }
  header h1 { font-size:16px; font-weight:700; }
  header .who { color:var(--dim); font-size:12px; }
  nav { display:flex; gap:4px; flex-wrap:wrap; padding:10px 20px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:49px; z-index:5; }
  nav button { background:transparent; color:var(--dim); border:1px solid transparent; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:13px; }
  nav button:hover { color:var(--text); }
  nav button.active { background:#16223a; color:var(--text); border-color:var(--line); }
  main { padding:20px; max-width:1200px; margin:0 auto; }
  section { display:none; }
  section.active { display:block; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; margin-bottom:16px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
  .card .n { font-size:22px; font-weight:700; }
  .card .l { color:var(--dim); font-size:12px; margin-top:2px; }
  .card .n.err { color:var(--danger); font-size:13px; }
  h2 { font-size:15px; margin:18px 0 8px; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-word; }
  th { color:var(--dim); font-weight:600; font-size:12px; }
  tr:hover td { background:#131c2b; }
  button.act { background:#16223a; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 12px; cursor:pointer; font-size:13px; }
  button.act:hover { border-color:var(--accent); }
  button.danger { color:#ff8f92; border-color:#5a2729; }
  button.danger:hover { border-color:var(--danger); }
  input, select, textarea { background:#0d1420; border:1px solid var(--line); color:var(--text); border-radius:8px; padding:8px 10px; font-size:13px; font-family:inherit; }
  textarea { width:100%; min-height:140px; font-family:ui-monospace,Menlo,monospace; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .msg { padding:10px 14px; border-radius:8px; font-size:14px; margin:4px 0; max-width:760px; }
  .msg.user { background:#16223a; margin-left:auto; text-align:right; }
  .msg.assistant { background:#101722; border:1px solid var(--line); }
  .badge { display:inline-block; padding:2px 8px; border-radius:6px; font-size:11px; }
  .badge.enc { background:#3a2a12; color:#ffb454; }
  .badge.plain { background:#12301f; color:#6fd39a; }
  pre { white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#0d1420; border:1px solid var(--line); border-radius:8px; padding:12px; max-height:400px; overflow:auto; }
  .muted { color:var(--dim); }
  .err { color:#ff8f92; }
  .ok { color:#6fd39a; }
  .clickkey { color:var(--accent); cursor:pointer; text-decoration:underline dotted; }
  .hidden { display:none; }
  #login-gate { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:50; }
  #login-gate .box { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:28px; width:min(360px,90vw); }
  #login-gate h2 { margin:0 0 10px; color:var(--text); text-transform:none; letter-spacing:0; font-size:17px; }
  #login-gate input { width:100%; margin-bottom:10px; }
  #login-gate button { width:100%; }
  #login-gate .err { margin-top:8px; }
  #top-err { position:fixed; top:0; left:0; right:0; background:var(--danger); color:#fff; padding:8px 16px; font-size:13px; z-index:40; display:none; }
  main { padding-top:0; }
</style>
</head>
<body>
<header>
  <h1>Owner Console</h1>
  <span class="who">uid ${OWNER_USER_ID} · everything is decrypted for you</span>
</header>
<nav>
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="convos">Conversations</button>
  <button data-tab="webagent">Web Agent</button>
  <button data-tab="memory">Agent Memory</button>
  <button data-tab="bans">Bans &amp; ToS</button>
  <button data-tab="d1">D1 Tables</button>
  <button data-tab="kv">KV Browser</button>
  <button data-tab="sessions">Login Sessions</button>
  <button data-tab="tools">Controls</button>
</nav>
<div id="top-err"></div>
<div id="login-gate">
  <div class="box">
    <h2>Owner login</h2>
    <input type="password" id="login-pass" placeholder="Owner password" autocomplete="current-password">
    <button class="act" id="login-btn">Unlock console</button>
    <div class="err err hidden" id="login-err"></div>
    <div class="muted" style="margin-top:10px; font-size:12px">Password set via the OWNER_PASSWORD secret. Your session lasts 30 days.</div>
  </div>
</div>
<main>

<section id="tab-overview" class="active">
  <div class="row"><button class="act" onclick="loadOverview()">Refresh</button><span id="ov-refreshed" class="muted"></span></div>
  <h2>Workers KV (by prefix)</h2>
  <div class="cards" id="ov-kv"></div>
  <h2>D1 Tables (rows)</h2>
  <div class="cards" id="ov-d1"></div>
  <h2>Gateway</h2>
  <div class="panel" id="ov-gateway"></div>
  <h2>Provider Cooldowns</h2>
  <div class="panel" id="ov-cooldowns"></div>
  <h2>Recent infra_log</h2>
  <div class="panel"><table id="ov-logs"></table></div>
</section>

<section id="tab-convos">
  <div class="row">
    <select id="conv-prefix">
      <option value="conv:">conv: (Discord, legacy+live)</option>
      <option value="ghconv:">ghconv: (GitHub-linked users)</option>
      <option value="tos:">tos: (strikes/notice)</option>
      <option value="provider-cooldown:">provider-cooldown:</option>
    </select>
    <button class="act" onclick="loadConvs()">List</button>
  </div>
  <div class="panel"><table id="conv-table"></table></div>
  <div id="conv-view" class="hidden panel" style="margin-top:12px"></div>
</section>

<section id="tab-webagent">
  <div class="row">
    <input id="wa-user" placeholder="Discord user id (blank = all rows)" style="width:300px">
    <button class="act" onclick="loadWaSessions()">List sessions</button>
  </div>
  <div class="panel"><table id="wa-table"></table></div>
  <div id="wa-view" class="hidden" style="margin-top:12px"></div>
</section>

<section id="tab-memory">
  <div class="row">
    <input id="mem-user" placeholder="Discord user id" style="width:300px">
    <button class="act" onclick="loadMemory()">Load memory</button>
    <span id="mem-state" class="muted"></span>
  </div>
  <div id="mem-edit" class="hidden">
    <div class="row">
      <label class="row" style="margin:0"><input type="checkbox" id="mem-enabled"> agent mode enabled</label>
      <button class="act" onclick="saveMemory()">Save (re-encrypts)</button>
      <button class="act" onclick="loadMemory()">Discard</button>
      <span id="mem-chars" class="muted"></span>
    </div>
    <textarea id="mem-text"></textarea>
  </div>
</section>

<section id="tab-bans">
  <div class="row"><button class="act" onclick="loadBans()">Refresh bans</button></div>
  <div class="panel"><table id="ban-table"></table></div>
</section>

<section id="tab-d1">
  <div class="row">
    <select id="d1-table">
      <option>agent_state</option><option>user_bans</option><option>webagent_index</option>
      <option>webagent_sessions</option><option>webagent_jobs</option><option>infra_log</option>
      <option>guild_config</option><option>model_channels</option><option>custom_commands</option>
      <option>blob_files</option><option>updates_channel</option><option>agent_relay_tokens</option>
    </select>
    <button class="act" onclick="loadD1()">Query</button>
    <span id="d1-count" class="muted"></span>
  </div>
  <div class="panel" style="overflow:auto"><table id="d1-table-view"></table></div>
</section>

<section id="tab-kv">
  <div class="row">
    <input id="kv-prefix" placeholder="prefix, e.g. conv: or gw:" style="width:260px" value="gw:">
    <button class="act" onclick="loadKv()">List</button>
  </div>
  <div class="panel"><table id="kv-table"></table></div>
  <div id="kv-view" class="hidden panel" style="margin-top:12px"></div>
</section>

<section id="tab-sessions">
  <div class="row"><button class="act" onclick="loadWebsess()">List login sessions</button></div>
  <div class="panel"><table id="sess-table"></table></div>
</section>

<section id="tab-tools">
  <h2>AI chain test</h2>
  <div class="row">
    <input id="chain-prompt" placeholder="prompt" style="width:340px" value="Reply with the single word OK.">
    <button class="act" onclick="testChain()">Run</button>
  </div>
  <pre id="chain-out" class="hidden"></pre>

  <h2>Gateway</h2>
  <div class="row">
    <button class="act" onclick="restartGateway()">Restart gateway</button>
    <button class="act" onclick="clearCooldowns()">Clear provider cooldowns</button>
  </div>

  <h2>Decrypt any blob</h2>
  <div class="row"><textarea id="dec-in" placeholder="paste v1.iv.ciphertext…"></textarea></div>
  <div class="row"><button class="act" onclick="decryptBlob()">Decrypt</button></div>
  <pre id="dec-out" class="hidden"></pre>
</section>

</main>
<script>
var OWNER = '${OWNER_USER_ID}';

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function $(id) { return document.getElementById(id); }
function show(id, on) { $(id).classList.toggle('hidden', !on); }

function showError(msg) {
  var b = $('top-err');
  b.textContent = msg;
  b.style.display = 'block';
  clearTimeout(showError.t);
  showError.t = setTimeout(function () { b.style.display = 'none'; }, 6000);
}

async function api(path, opts) {
  var res = await fetch('/api/owner' + path, opts);
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) {
    showLogin(true);
    throw new Error(data.error || 'Not unlocked');
  }
  if (!res.ok) {
    var msg = data.error || ('HTTP ' + res.status + ' ' + res.statusText);
    showError(msg);
    throw new Error(msg);
  }
  return data;
}

function showLogin(on) { $('login-gate').style.display = on ? 'flex' : 'none'; }

async function initAuth() {
  try {
    var d = await api('/whoami');
    if (d.ok) showLogin(false);
  } catch (e) {
    showLogin(true);
  }
}

async function doLogin() {
  var errEl = $('login-err');
  errEl.classList.add('hidden');
  try {
    await api('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: $('login-pass').value })
    });
    $('login-pass').value = '';
    showLogin(false);
    loadOverview().catch(function (e) { if (String(e.message).indexOf('Not unlocked') === -1) showError(e.message); });
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

$('login-btn').onclick = doLogin;
$('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
initAuth();
function badge(enc) {
  var b = el('span', 'badge ' + (enc ? 'enc' : 'plain'), enc ? 'encrypted' : 'plaintext');
  return b;
}

document.querySelectorAll('nav button').forEach(function (btn) {
  btn.onclick = function () {
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('section').forEach(function (s) { s.classList.remove('active'); });
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  };
});

/* ---------- overview ---------- */
async function loadOverview() {
  var d = await api('/overview');
  var kv = $('ov-kv'); kv.innerHTML = '';
  Object.keys(d.kvCounts).forEach(function (p) {
    var c = el('div', 'card');
    c.appendChild(el('div', 'n', d.kvCounts[p]));
    c.appendChild(el('div', 'l', p));
    c.style.cursor = 'pointer';
    c.onclick = function () {
      document.querySelector('nav button[data-tab="convos"]').click();
      $('conv-prefix').value = p.indexOf('conv') === 0 ? p : ($('conv-prefix').value = p, p);
      loadConvs();
    };
    kv.appendChild(c);
  });
  var d1 = $('ov-d1'); d1.innerHTML = '';
  Object.keys(d.tables).forEach(function (t) {
    var v = d.tables[t];
    var c = el('div', 'card');
    var n = el('div', 'n' + (v < 0 ? ' err' : ''), v < 0 ? 'n/a' : v);
    c.appendChild(n);
    c.appendChild(el('div', 'l', t));
    d1.appendChild(c);
  });
  var gw = $('ov-gateway'); gw.innerHTML = '';
  var gwOk = d.gateway && d.gateway.connected;
  gw.appendChild(el('span', gwOk ? 'ok' : 'err', (gwOk ? 'connected' : 'disconnected') + (d.gateway.lastError ? ' — ' + d.gateway.lastError : '')));
  if (d.gateway.sequence != null) gw.appendChild(el('span', 'muted', ' · seq ' + d.gateway.sequence));
  var cd = $('ov-cooldowns'); cd.innerHTML = '';
  if (!d.cooldowns.length) cd.appendChild(el('span', 'ok', 'none — all providers healthy'));
  d.cooldowns.forEach(function (c) { cd.appendChild(el('div', 'err', c)); });
  var tbl = $('ov-logs'); tbl.innerHTML = '';
  if (!d.recentLogs.length) tbl.innerHTML = '<tr><td class="muted">no log entries</td></tr>';
  d.recentLogs.forEach(function (row) {
    var tr = el('tr');
    tr.appendChild(el('td', 'muted', new Date(row.at * 1000).toLocaleString()));
    tr.appendChild(el('td', null, row.guild_id));
    tr.appendChild(el('td', null, row.kind));
    tr.appendChild(el('td', null, row.message));
    tbl.appendChild(tr);
  });
  $('ov-refreshed').textContent = 'at ' + new Date().toLocaleTimeString();
}

/* ---------- conversations ---------- */
var convRows = [];
async function loadConvs() {
  var prefix = $('conv-prefix').value;
  var d = await api('/kv/list?prefix=' + encodeURIComponent(prefix));
  convRows = d.keys;
  var t = $('conv-table'); t.innerHTML = '';
  if (!d.keys.length) t.innerHTML = '<tr><td class="muted">no keys with this prefix</td></tr>';
  d.keys.forEach(function (k) {
    var tr = el('tr');
    var name = el('td');
    name.appendChild(el('span', 'clickkey', k.name));
    name.querySelector('span').onclick = function () { viewKey(k.name); };
    tr.appendChild(name);
    tr.appendChild(el('td', 'muted', k.expires ? new Date(k.expires * 1000).toLocaleString() : 'no expiry'));
    var del = el('button', 'act danger', 'delete');
    del.onclick = function () { delKey(k.name, loadConvs); };
    var td = el('td'); td.appendChild(del); tr.appendChild(td);
    t.appendChild(tr);
  });
}
async function viewKey(key) {
  var d = await api('/kv/value?key=' + encodeURIComponent(key));
  var v = $('conv-view'); v.classList.remove('hidden'); v.innerHTML = '';
  v.appendChild(el('div', null, key + '  '));
  v.appendChild(badge(d.encrypted));
  var del = el('button', 'act danger', 'delete'); del.style.marginLeft = '10px';
  del.onclick = function () { delKey(key, function () { v.classList.add('hidden'); loadConvs(); }); };
  v.appendChild(del);
  var box = el('pre');
  if (d.parsed && Array.isArray(d.parsed)) {
    var wrap = el('div');
    d.parsed.forEach(function (m) {
      var who = m.role || 'user';
      var whoEl = el('div', 'muted', who + ' · ' + new Date((m.at || Date.now() / 1000) * (m.at && m.at < 1e12 ? 1000 : 1)).toLocaleString());
      wrap.appendChild(whoEl);
      wrap.appendChild(el('div', 'msg ' + (who === 'user' ? 'user' : 'assistant'), m.content));
    });
    box.appendChild(wrap);
  } else {
    box.textContent = d.parsed ? JSON.stringify(d.parsed, null, 2) : (d.text ?? '');
  }
  v.appendChild(box);
}
async function delKey(key, done) {
  if (!confirm('Delete ' + key + '?')) return;
  await api('/kv/value?key=' + encodeURIComponent(key), { method: 'DELETE' });
  if (done) done();
}

/* ---------- web agent ---------- */
async function loadWaSessions() {
  var uid = $('wa-user').value.trim();
  var d = uid
    ? await api('/webagent/sessions?userId=' + encodeURIComponent(uid))
    : await api('/webagent/sessions');
  var t = $('wa-table'); t.innerHTML = '';
  if (d.rows) {
    if (!d.rows.length) t.innerHTML = '<tr><td class="muted">no rows</td></tr>';
    d.rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r.user_id));
      var sid = el('td');
      var link = el('span', 'clickkey', r.session_id);
      link.onclick = function () { viewWaSession(r.user_id, r.session_id); };
      sid.appendChild(link); tr.appendChild(sid);
      tr.appendChild(el('td', 'muted', new Date(r.updated_at).toLocaleString()));
      tr.appendChild(el('td', 'muted', r.bytes + ' B (encrypted)'));
      t.appendChild(tr);
    });
  } else {
    if (!d.sessions.length) t.innerHTML = '<tr><td class="muted">no sessions</td></tr>';
    d.sessions.forEach(function (s) {
      var tr = el('tr');
      var title = el('td');
      var link = el('span', 'clickkey', s.title);
      link.onclick = function () { viewWaSession(uid, s.id); };
      title.appendChild(link); tr.appendChild(title);
      tr.appendChild(el('td', 'muted', new Date(s.updatedAt).toLocaleString()));
      t.appendChild(tr);
    });
  }
}
async function viewWaSession(userId, sessionId) {
  var d = await api('/webagent/session?userId=' + encodeURIComponent(userId) + '&session=' + encodeURIComponent(sessionId));
  var v = $('wa-view'); v.classList.remove('hidden'); v.innerHTML = '';
  v.appendChild(el('h2', null, d.session.title + ' · ' + userId + ' · ' + sessionId));
  var del = el('button', 'act danger', 'delete session');
  del.onclick = async function () {
    if (!confirm('Delete this session?')) return;
    await api('/webagent/session?userId=' + encodeURIComponent(userId) + '&session=' + encodeURIComponent(sessionId), { method: 'DELETE' });
    v.classList.add('hidden'); loadWaSessions();
  };
  v.appendChild(del);
  var wrap = el('div');
  d.session.messages.forEach(function (m) {
    wrap.appendChild(el('div', 'muted', m.role + ' · ' + new Date(m.at).toLocaleString()));
    wrap.appendChild(el('div', 'msg ' + (m.role === 'user' ? 'user' : 'assistant'), m.content));
  });
  v.appendChild(wrap);
}

/* ---------- agent memory ---------- */
async function loadMemory() {
  var uid = $('mem-user').value.trim();
  if (!uid) { $('mem-state').textContent = 'enter a user id'; return; }
  var d = await api('/memory?userId=' + encodeURIComponent(uid));
  show('mem-edit', true);
  $('mem-enabled').checked = d.enabled;
  $('mem-text').value = d.memory;
  $('mem-chars').textContent = d.chars + ' chars (decrypted)';
  $('mem-state').textContent = '';
}
async function saveMemory() {
  var uid = $('mem-user').value.trim();
  await api('/memory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: uid, memory: $('mem-text').value, enabled: $('mem-enabled').checked })
  });
  $('mem-state').textContent = 'saved (encrypted)';
}

/* ---------- bans ---------- */
async function loadBans() {
  var d = await api('/bans');
  var t = $('ban-table'); t.innerHTML = '';
  if (!d.bans.length) t.innerHTML = '<tr><td class="muted">no ban records</td></tr>';
  d.bans.forEach(function (b) {
    var tr = el('tr');
    tr.appendChild(el('td', null, b.userId));
    tr.appendChild(el('td', null, b.reason || '—'));
    tr.appendChild(el('td', null, b.until ? new Date(b.until).toLocaleString() : 'permanent'));
    tr.appendChild(el('td', null, b.active ? el('span', 'err', 'active') : el('span', 'ok', 'lifted')));
    if (b.active) {
      var btn = el('button', 'act', 'unban');
      btn.onclick = async function () {
        await api('/bans/unban', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: b.userId }) });
        loadBans();
      };
      var td = el('td'); td.appendChild(btn); tr.appendChild(td);
    } else {
      tr.appendChild(el('td', 'muted', '—'));
    }
    t.appendChild(tr);
  });
}

/* ---------- d1 ---------- */
async function loadD1() {
  var table = $('d1-table').value;
  var d = await api('/d1/' + table + '?limit=50');
  $('d1-count').textContent = (d.count < 0 ? 'count n/a' : d.count + ' rows total') + ' · latest 50';
  var t = $('d1-table-view'); t.innerHTML = '';
  if (!d.rows.length) { t.innerHTML = '<tr><td class="muted">empty</td></tr>'; return; }
  var cols = Object.keys(d.rows[0]);
  var hr = el('tr'); cols.forEach(function (c) { hr.appendChild(el('th', null, c)); }); t.appendChild(hr);
  d.rows.forEach(function (row) {
    var tr = el('tr');
    cols.forEach(function (c) {
      var val = row[c];
      var text = val == null ? 'null' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
      if (text.length > 300) text = text.slice(0, 300) + '…';
      var td = el('td', null, text);
      if (/^v1\\./.test(String(val))) {
        td.appendChild(document.createTextNode(' '));
        var btn = el('button', 'act', 'decrypt');
        var raw = String(val);
        btn.onclick = async function () {
          var out = await api('/decrypt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: raw }) });
          td.textContent = out.text;
        };
        td.appendChild(btn);
      }
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
}

/* ---------- kv ---------- */
async function loadKv() {
  var prefix = $('kv-prefix').value.trim();
  var d = await api('/kv/list?prefix=' + encodeURIComponent(prefix));
  var t = $('kv-table'); t.innerHTML = '';
  if (!d.keys.length) t.innerHTML = '<tr><td class="muted">no keys</td></tr>';
  d.keys.forEach(function (k) {
    var tr = el('tr');
    var name = el('td');
    var link = el('span', 'clickkey', k.name);
    link.onclick = function () { viewKv(k.name); };
    name.appendChild(link); tr.appendChild(name);
    tr.appendChild(el('td', 'muted', k.expires ? new Date(k.expires * 1000).toLocaleString() : 'no expiry'));
    var del = el('button', 'act danger', 'delete');
    del.onclick = function () { delKey(k.name, loadKv); };
    var td = el('td'); td.appendChild(del); tr.appendChild(td);
    t.appendChild(tr);
  });
}
async function viewKv(key) {
  var d = await api('/kv/value?key=' + encodeURIComponent(key));
  var v = $('kv-view'); v.classList.remove('hidden'); v.innerHTML = '';
  v.appendChild(el('div', null, key + '  '));
  v.appendChild(badge(d.encrypted));
  var del = el('button', 'act danger', 'delete'); del.style.marginLeft = '10px';
  del.onclick = function () { delKey(key, function () { v.classList.add('hidden'); loadKv(); }); };
  v.appendChild(del);
  var box = el('pre');
  box.textContent = d.parsed ? JSON.stringify(d.parsed, null, 2) : (d.text ?? '');
  v.appendChild(box);
}

/* ---------- login sessions ---------- */
async function loadWebsess() {
  var d = await api('/websess');
  var t = $('sess-table'); t.innerHTML = '';
  if (!d.sessions.length) t.innerHTML = '<tr><td class="muted">none</td></tr>';
  d.sessions.forEach(function (s) {
    var tr = el('tr');
    var who = s.session ? (s.session.name || s.session.sub || '?') : '(unreadable)';
    tr.appendChild(el('td', null, who));
    tr.appendChild(el('td', 'muted', s.session ? JSON.stringify({ sub: s.session.sub, kind: s.session.kind || 'google' }) : '—'));
    tr.appendChild(el('td', 'muted', s.expires ? new Date(s.expires * 1000).toLocaleString() : 'no expiry'));
    var del = el('button', 'act danger', 'revoke');
    del.onclick = async function () {
      await api('/websess?key=' + encodeURIComponent(s.key), { method: 'DELETE' });
      loadWebsess();
    };
    var td = el('td'); td.appendChild(del); tr.appendChild(td);
    t.appendChild(tr);
  });
}

/* ---------- controls ---------- */
async function testChain() {
  var out = $('chain-out'); out.classList.remove('hidden'); out.textContent = 'running…';
  var d = await api('/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: $('chain-prompt').value }) });
  out.textContent = JSON.stringify(d, null, 2);
}
async function restartGateway() {
  await api('/gateway/restart', { method: 'POST' });
  alert('Gateway restart requested.');
}
async function clearCooldowns() {
  var d = await api('/cooldowns/clear', { method: 'POST' });
  alert('Cleared ' + d.cleared + ' cooldowns.');
}
async function decryptBlob() {
  var out = $('dec-out'); out.classList.remove('hidden'); out.textContent = '…';
  var d = await api('/decrypt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: $('dec-in').value.trim() }) });
  out.textContent = d.text;
}

loadOverview().catch(function (e) { if (String(e.message).indexOf('Not unlocked') === -1) showError(e.message); });
</script>
</body>
</html>`;

export { OWNER_HTML };
