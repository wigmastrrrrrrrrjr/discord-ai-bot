export const WEB_AGENT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Agent</title>
<style>
  :root { --bg:#0b0f14; --panel:#121821; --line:#1f2937; --text:#e5edf5; --dim:#8ea0b3; --accent:#4f8cff; --bad:#ff5470; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; height:100vh; overflow:hidden; }
  a { color:var(--accent); }
  .app { display:flex; height:100vh; }
  .side { width:260px; background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:12px; gap:8px; }
  .side h1 { font-size:15px; margin:4px 4px 10px; }
  .newchat { background:var(--accent); border:0; color:#fff; padding:9px 12px; border-radius:8px; font-size:14px; cursor:pointer; }
  .sessions { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
  .sess { padding:8px 10px; border-radius:8px; cursor:pointer; color:var(--dim); font-size:13px; display:flex; justify-content:space-between; gap:6px; align-items:center; }
  .sess:hover { background:#182130; }
  .sess.active { background:#1c2a42; color:var(--text); }
  .sess .del { opacity:.5; cursor:pointer; }
  .sess .del:hover { opacity:1; color:var(--bad); }
  .me { display:flex; gap:8px; align-items:center; padding:8px; border-top:1px solid var(--line); }
  .me img, .me .pic { width:28px; height:28px; border-radius:50%; background:#24344d; }
  .me .who { font-size:12px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .main { flex:1; display:flex; flex-direction:column; }
  .chat { flex:1; overflow-y:auto; padding:24px 18vw 24px; display:flex; flex-direction:column; gap:14px; }
  @media (max-width:900px){ .chat{padding:18px 14px;} .side{width:200px;} }
  .msg { max-width:760px; white-space:pre-wrap; word-wrap:break-word; }
  .msg.user { align-self:flex-end; background:#1c2a42; padding:10px 14px; border-radius:14px 14px 4px 14px; }
  .msg.bot { align-self:flex-start; }
  .msg.bot .who { font-size:11px; color:var(--dim); margin-bottom:2px; }
  .login { max-width:420px; margin:12vh auto; padding:28px; background:var(--panel); border:1px solid var(--line); border-radius:14px; text-align:center; }
  .login h2 { margin:0 0 6px; }
  .login p { color:var(--dim); font-size:13px; margin:0 0 22px; }
  .oauth { display:flex; flex-direction:column; gap:10px; }
  .btn-oauth { display:flex; align-items:center; justify-content:center; gap:10px; padding:11px; border-radius:8px; border:1px solid var(--line); background:#0e141d; color:var(--text); font-size:14px; cursor:pointer; text-decoration:none; }
  .btn-oauth:hover { background:#16202e; }
  .btn-oauth svg { width:18px; height:18px; flex:none; }
  .composer { border-top:1px solid var(--line); padding:14px 18vw; display:flex; gap:10px; }
  @media (max-width:900px){ .composer{padding:12px 14px;} }
  .composer textarea { flex:1; background:#0e141d; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:11px 12px; font:inherit; resize:none; min-height:44px; max-height:160px; }
  .composer button { background:var(--accent); border:0; color:#fff; border-radius:10px; padding:0 18px; cursor:pointer; font-size:15px; }
  .composer button:disabled { opacity:.45; cursor:default; }
  .status { font-size:11px; color:var(--dim); min-height:14px; }
  .err { color:var(--bad); font-size:13px; padding:0 18vw 10px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  'use strict';
  var GOOGLE_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
  var DISCORD_ICON = '<svg viewBox="0 0 24 24" fill="#5865F2"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.9 3l-.6 1.2a18 18 0 0 0-6.6 0L8.1 3a19.8 19.8 0 0 0-4.4 1.4C.9 8.6.2 12.7.5 16.7a20 20 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 11.4 0l.5.4a12.9 12.9 0 0 1-2 1l1.3 2c2.2-.7 4.2-1.7 6-3 .4-4.6-.7-8.6-3.2-12.3zM8.7 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';

  var state = { me: null, sessions: [], active: null, messages: [], busy: false };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function byId(id) { return document.getElementById(id); }
  function svg(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }

  async function api(path, options) {
    var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
    var data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function renderLogin(message) {
    var root = byId('root');
    root.innerHTML = '';
    var box = el('div', 'login');
    var h = el('h2', null, 'Web Agent');
    box.appendChild(h);
    box.appendChild(el('p', null, message || 'Sign in to start. Every chat is saved and encrypted.'));
    var oauth = el('div', 'oauth');

    var g = el('a', 'btn-oauth'); g.href = '/auth/google'; g.appendChild(svg(GOOGLE_ICON)); g.appendChild(document.createTextNode('Log in with Google')); oauth.appendChild(g);
    var d = el('a', 'btn-oauth'); d.href = '/auth/discord?next=' + encodeURIComponent('/agent'); d.appendChild(svg(DISCORD_ICON)); d.appendChild(document.createTextNode('Log in with Discord')); oauth.appendChild(d);

    box.appendChild(oauth);
    root.appendChild(box);
  }

  function renderApp() {
    var root = byId('root');
    root.innerHTML = '';
    var app = el('div', 'app');
    var side = el('div', 'side');
    side.appendChild(el('h1', null, 'Web Agent'));
    var newChat = el('button', 'newchat', '+ New chat');
    newChat.addEventListener('click', newSession);
    side.appendChild(newChat);
    var list = el('div', 'sessions');
    state.sessions.forEach(function (s) {
      var row = el('div', 'sess' + (s.id === state.active ? ' active' : ''));
      row.appendChild(el('span', null, s.title || 'New chat'));
      var del = el('span', 'del', '×');
      del.addEventListener('click', function (e) { e.stopPropagation(); delSession(s.id); });
      row.appendChild(del);
      row.addEventListener('click', function () { openSession(s.id); });
      list.appendChild(row);
    });
    side.appendChild(list);
    var me = el('div', 'me');
    if (state.me && state.me.picture) { var img = document.createElement('img'); img.src = state.me.picture; img.referrerPolicy = 'no-referrer'; me.appendChild(img); }
    else me.appendChild(el('div', 'pic'));
    var who = el('div', 'who');
    who.textContent = (state.me ? state.me.name : '') + (state.me && state.me.provider ? ' (' + state.me.provider + ')' : '');
    me.appendChild(who);
    var logout = el('a', null, 'log out');
    logout.href = state.me && state.me.provider === 'google' ? '/auth/google/logout' : '/auth/google/logout';
    logout.style.cssText = 'margin-left:auto;font-size:12px;cursor:pointer;color:var(--dim)';
    me.appendChild(logout);
    side.appendChild(me);
    app.appendChild(side);

    var main = el('div', 'main');
    var chat = el('div', 'chat'); chat.id = 'chat'; main.appendChild(chat);
    var err = el('div', 'err'); err.id = 'err'; main.appendChild(err);
    var status = el('div', 'status'); status.id = 'status'; status.style.cssText = 'padding:0 18vw 6px;'; main.appendChild(status);
    var composer = el('div', 'composer');
    var ta = document.createElement('textarea');
    ta.id = 'prompt'; ta.placeholder = 'Message the agent…'; ta.rows = 1;
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    composer.appendChild(ta);
    var sendBtn = el('button', null, 'Send');
    sendBtn.id = 'send'; sendBtn.addEventListener('click', send);
    composer.appendChild(sendBtn);
    main.appendChild(composer);
    app.appendChild(main);
    root.appendChild(app);
    drawMessages();
    var t = byId('prompt'); if (t) t.focus();
  }

  function drawMessages() {
    var chat = byId('chat');
    if (!chat) return;
    chat.innerHTML = '';
    if (!state.messages.length) {
      var empty = el('div', 'msg bot');
      empty.appendChild(el('div', 'who', 'Web Agent'));
      empty.appendChild(el('span', null, 'Start typing — I run with the same tools as the Discord bot, and every session here is saved encrypted.'));
      chat.appendChild(empty);
    }
    state.messages.forEach(function (m, idx) {
      var node = el('div', 'msg ' + (m.role === 'user' ? 'user' : 'bot'));
      if (m.role !== 'user') {
        var who = el('div', 'who', 'Web Agent');
        node.appendChild(who);
        var span = el('span');
        span.textContent = m.content;
        node.appendChild(span);
      } else {
        node.textContent = m.content;
      }
      chat.appendChild(node);
    });
    chat.scrollTop = chat.scrollHeight;
  }

  async function refresh() {
    try {
      var me = await api('/api/web/me2');
      state.me = me.identity;
    } catch (e) {
      renderLogin(e.status === 401 ? null : e.message);
      return;
    }
    var data = await api('/api/web/agent/sessions');
    state.sessions = data.sessions || [];
    if (!state.active && state.sessions.length) state.active = state.sessions[0].id;
    if (state.active) {
      try {
        var s = await api('/api/web/agent/session?id=' + encodeURIComponent(state.active));
        state.messages = s.session.messages || [];
      } catch (e) { state.messages = []; }
    } else state.messages = [];
    renderApp();
  }

  async function newSession() {
    state.active = null;
    state.messages = [];
    var data = await api('/api/web/agent/sessions', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) });
    state.active = data.session.id;
    state.messages = [];
    var refreshed = await api('/api/web/agent/sessions');
    state.sessions = refreshed.sessions || [];
    renderApp();
  }

  async function openSession(id) {
    state.active = id;
    var data = await api('/api/web/agent/session?id=' + encodeURIComponent(id));
    state.messages = data.session.messages || [];
    renderApp();
  }

  async function delSession(id) {
    await api('/api/web/agent/session/delete', { method: 'POST', body: JSON.stringify({ id: id }) });
    if (state.active === id) { state.active = null; state.messages = []; }
    var data = await api('/api/web/agent/sessions');
    state.sessions = data.sessions || [];
    renderApp();
  }

  async function send() {
    if (state.busy) return;
    var ta = byId('prompt');
    var text = (ta.value || '').trim();
    if (!text) return;
    state.busy = true;
    byId('send').disabled = true;
    ta.value = '';
    state.messages.push({ role: 'user', content: text, at: Date.now() });
    state.messages.push({ role: 'assistant', content: '', at: Date.now() });
    var botIdx = state.messages.length - 1;
    drawMessages();
    var statusEl = byId('status');
    statusEl.textContent = 'Thinking…';
    try {
      var res = await fetch('/api/web/agent/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: state.active, prompt: text })
      });
      if (!res.ok) {
        var errData = {}; try { errData = await res.json(); } catch (e) {}
        throw new Error(errData.error || ('HTTP ' + res.status));
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var createdSession = null;
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\\n\\n');
        buffer = events.pop();
        for (var i = 0; i < events.length; i++) {
          var line = events[i];
          if (!line.startsWith('data:')) continue;
          var payload = {};
          try { payload = JSON.parse(line.slice(5).trim()); } catch (e2) { continue; }
          if (payload.event === 'meta') { createdSession = payload.sessionId; state.active = payload.sessionId; }
          if (payload.event === 'delta' && payload.text) {
            state.messages[botIdx].content += payload.text;
            drawMessages();
          }
          if (payload.event === 'status' && payload.status) statusEl.textContent = payload.status;
          if (payload.event === 'done') { state.messages[botIdx].content = payload.text || state.messages[botIdx].content; }
          if (payload.event === 'error') throw new Error(payload.text || 'Agent failed');
        }
      }
      var data = await api('/api/web/agent/sessions');
      state.sessions = data.sessions || [];
      statusEl.textContent = '';
    } catch (error) {
      byId('err').textContent = 'Agent failed: ' + error.message;
      if (!state.messages[botIdx].content) state.messages.splice(botIdx, 1);
    } finally {
      state.busy = false;
      byId('send').disabled = false;
      drawMessages();
      statusEl.textContent = '';
    }
  }

  refresh();
})();
</script>
</body>
</html>`;
