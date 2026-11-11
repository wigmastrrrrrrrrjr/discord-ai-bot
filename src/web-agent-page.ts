export const WEB_AGENT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Agent</title>
<style>
  :root { --bg:#0b0f14; --panel:#121821; --line:#1f2937; --text:#e5edf5; --dim:#8ea0b3; --accent:#4f8cff; --bad:#ff5470; }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; height:100dvh; overflow:hidden; }
  a { color:var(--accent); }
  .app { display:flex; height:100dvh; }
  @media (max-width:700px) { .side { width:56px; padding:10px 8px; } .side h1 { display:none; } .sess span:first-child { display:none; } .sess { justify-content:center; } .me .who { display:none; } .me { justify-content:center; } .me a { display:none; } }
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
  .chat { flex:1; overflow-y:auto; padding:24px 18vw 24px; display:flex; flex-direction:column; gap:14px; scroll-behavior:smooth; }
  @media (max-width:900px){ .chat{padding:18px 14px;} .composer{padding:12px 14px;} }
  .msg { max-width:760px; white-space:pre-wrap; word-wrap:break-word; animation: rise .28s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes pop { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:none; } }
  .composer textarea { transition: border-color .2s, box-shadow .25s; }
  .composer textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,140,255,.18); }
  .composer button { transition: transform .15s, opacity .2s, box-shadow .25s; box-shadow:0 2px 10px rgba(79,140,255,.25); }
  .composer button:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 16px rgba(79,140,255,.35); }
  .composer button:active:not(:disabled) { transform:translateY(0); }
  .newchat { transition: transform .15s, filter .2s; }
  .newchat:hover { transform:translateY(-1px); filter:brightness(1.1); }
  .sess { transition: background .15s, color .15s, transform .12s; }
  .sess:hover { transform:translateX(2px); }
  .btn-oauth { transition: transform .15s, background .2s, border-color .2s; }
  .btn-oauth:hover { transform:translateY(-2px); border-color:#2f4a73; }
  .btn-oauth:active { transform:translateY(0); }
  .login { animation: pop .3s ease both; }
  .app, .side { transition: width .2s; }
  .typing { display:inline-flex; gap:4px; padding:6px 2px; }
  .typing i { width:6px; height:6px; border-radius:50%; background:var(--dim); animation: blink 1.2s infinite ease-in-out; }
  .typing i:nth-child(2) { animation-delay:.2s; }
  .typing i:nth-child(3) { animation-delay:.4s; }
  @keyframes blink { 0%,80%,100% { opacity:.25; transform:translateY(0);} 40% { opacity:1; transform:translateY(-3px);} }
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
  .composer textarea { flex:1; background:#0e141d; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:11px 12px; font:16px/1.5 inherit; font-family:inherit; resize:none; min-height:44px; max-height:160px; overflow-y:auto; }
  .composer button { background:var(--accent); border:0; color:#fff; border-radius:10px; padding:0 18px; cursor:pointer; font-size:15px; }
  .composer button:disabled { opacity:.45; cursor:default; }
  .status { font-size:11px; color:var(--dim); min-height:16px; }
  .activity { align-self:flex-start; font-size:13px; padding:4px 0; min-height:22px; transition: opacity .28s ease, transform .28s ease; }
  .activity.fading { opacity:0; transform:translateY(4px); }
  .step { align-self:flex-start; font-size:12px; color:var(--dim); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:#101722; border:1px solid var(--line); border-left:3px solid #2f4a73; border-radius:6px; padding:4px 10px; max-width:760px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; animation: rise .25s ease both; }
  .step.done { border-left-color:#2f8f57; }
  .step b { color:#9fc1ff; font-weight:600; }
  .cmd { display:inline-block; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; background:#101722; border:1px solid var(--line); border-radius:6px; padding:2px 8px; margin-right:6px; color:#9fc1ff; }
  .cmd.out { color:#9be6a8; border-color:#1e3b2a; background:#0e1812; }
  .shimmer {
    background: linear-gradient(90deg, #8ea0b3 25%, #e8f1fb 50%, #8ea0b3 75%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: shine 1.4s linear infinite;
    letter-spacing: .3px;
  }
  @keyframes shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .err { color:var(--bad); font-size:13px; padding:0 18vw 10px; }
</style>
</head>
<body>
<div id="root"></div>
<div style="position:fixed;top:0;left:0;right:0;z-index:60;background:#16223a;border-bottom:1px solid var(--line);padding:4px 12px;font-size:11px;color:var(--dim);text-align:center">
  Agent V2 beta, bound to change &middot; Agent V1 is getting sunset on June 1st 2027
</div>
<script>
(function () {
  'use strict';
  var GOOGLE_ICON = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
  var DISCORD_ICON = '<svg viewBox="0 0 24 24" fill="#5865F2"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.9 3l-.6 1.2a18 18 0 0 0-6.6 0L8.1 3a19.8 19.8 0 0 0-4.4 1.4C.9 8.6.2 12.7.5 16.7a20 20 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 11.4 0l.5.4a12.9 12.9 0 0 1-2 1l1.3 2c2.2-.7 4.2-1.7 6-3 .4-4.6-.7-8.6-3.2-12.3zM8.7 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';

  var state = { me: null, sessions: [], active: null, messages: [], busy: false, activity: null };
  var runStepsGlobal = [];

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
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '')));
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

    var d = el('a', 'btn-oauth'); d.href = '/auth/discord?next=' + encodeURIComponent('/agent'); d.appendChild(svg(DISCORD_ICON)); d.appendChild(document.createTextNode('Log in with Discord')); oauth.appendChild(d);

    box.appendChild(oauth);
    var legal = el('p', null, '');
    legal.style.cssText = 'margin:22px 0 0;font-size:12px;color:var(--dim)';
    var agree = document.createElement('span');
    agree.textContent = 'When you use the service, you agree to follow the ';
    legal.appendChild(agree);
    var tos = document.createElement('a'); tos.href = '/terms'; tos.textContent = 'Terms of Service'; legal.appendChild(tos);
    var andTou = document.createElement('span'); andTou.textContent = ' and '; legal.appendChild(andTou);
    var tou = document.createElement('a'); tou.href = '/terms-of-use'; tou.textContent = 'Terms of Use'; legal.appendChild(tou);
    var comma = document.createElement('span'); comma.textContent = ', and the '; legal.appendChild(comma);
    var priv = document.createElement('a'); priv.href = '/privacy'; priv.textContent = 'Privacy Policy'; legal.appendChild(priv);
    var dot = document.createElement('span'); dot.textContent = '.'; legal.appendChild(dot);
    legal.appendChild(document.createElement('br'));
    var minor = document.createElement('span');
    minor.textContent = 'If you are under 18, you need a parent or guardian to supervise you to use this service.';
    legal.appendChild(minor);
    box.appendChild(legal);
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
    var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; };
    ta.addEventListener('input', grow);
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
    var act = byId('activity');
    if (!state.messages.length) {
      var empty = el('div', 'msg bot');
      empty.appendChild(el('div', 'who', 'Web Agent'));
      empty.appendChild(el('span', null, 'Start typing — I run with the same tools as the Discord bot, and every session here is saved encrypted.'));
      chat.appendChild(empty);
    }
    state.messages.forEach(function (m, idx) {
      if (m.role === 'step') {
        var stepNode = el('div', 'step' + (m.done ? ' done' : ''));
        var name = el('b', null, m.tool + ' ');
        stepNode.appendChild(name);
        stepNode.appendChild(document.createTextNode(m.content));
        chat.appendChild(stepNode);
        return;
      }
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
    var line = el('div', 'activity');
    line.id = 'activity';
    if (state.busy && state.activity) {
      line.textContent = state.activity;
      line.classList.add('shimmer');
    } else if (state.busy) {
      var dots = el('span', 'typing');
      dots.appendChild(document.createElement('i'));
      dots.appendChild(document.createElement('i'));
      dots.appendChild(document.createElement('i'));
      line.appendChild(dots);
    }
    chat.appendChild(line);
    chat.scrollTop = chat.scrollHeight;
  }

  function setActivity(label) {
    state.activity = label || null;
    var line = byId('activity');
    if (line) {
      line.textContent = state.activity || '';
      line.classList.toggle('shimmer', Boolean(state.activity));
    }
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

  function shimmer(node, text) {
    if (!node) return;
    node.textContent = text;
    node.classList.add('shimmer');
  }

  function setActivity(label) {
    state.activity = label || null;
    var line = byId('activity');
    if (!line) return;
    if (state.activity) {
      line.classList.add('fading');
      setTimeout(function () {
        line.classList.remove('fading');
        line.textContent = state.activity;
        line.classList.add('shimmer');
      }, 150);
    } else {
      line.classList.add('fading');
      setTimeout(function () {
        line.classList.remove('fading', 'shimmer');
        line.innerHTML = '';
        var dots = document.createElement('span');
        dots.className = 'typing';
        for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
        line.appendChild(dots);
      }, 150);
    }
  }

  // Renders a tool activity line: | command | output… | or | command | done |
  function renderToolLine(name, args, preview) {
    var line = byId('activity');
    if (!line) return;
    line.classList.remove('fading', 'shimmer');
    line.innerHTML = '';
    var open = document.createElement('span'); open.textContent = '| '; line.appendChild(open);
    var cmd = document.createElement('span'); cmd.className = 'cmd';
    var shown = args || name;
    try {
      var parsed = JSON.parse(args);
      var keys = Object.keys(parsed);
      if (keys.length) shown = String(parsed[keys[0]]).slice(0, 80) || name;
    } catch (e) {}
    cmd.textContent = name + ' ' + shown;
    line.appendChild(cmd);
    var sep = document.createElement('span'); sep.textContent = '| '; line.appendChild(sep);
    var out = document.createElement('span'); out.className = 'cmd out';
    out.textContent = preview ? (preview.replace(/\s+/g, ' ').slice(0, 60) + '…') : '…';
    line.appendChild(out);
    var close = document.createElement('span'); close.textContent = ' |'; line.appendChild(close);
  }

  function pollJob(sessionId) {
    var attempts = 0;
    var timer = setInterval(async function () {
      attempts++;
      try {
        var job = await api('/api/web/agent/job?session=' + encodeURIComponent(sessionId));
        if (job.status === 'running') {
          state.busy = true;
          if (job.activity) setActivity(job.activity); else setActivity(null);
        }
        if (job.status === 'done' || attempts > 300) {
          clearInterval(timer);
          await finishLocally(sessionId);
        }
        if (job.status === 'error') {
          clearInterval(timer);
          throw new Error(job.error || 'Agent failed');
        }
      } catch (error) {
        clearInterval(timer);
        state.busy = false;
        byId('send').disabled = false;
        state.activity = null;
        drawMessages();
        var errEl = byId('err');
        if (errEl) errEl.textContent = 'Agent failed: ' + error.message;
      }
    }, 1800);
  }

  function withSteps(messages) {
    if (!runStepsGlobal.length) return messages;
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      out.push(messages[i]);
      if (messages[i].role === 'user' && i + 1 < messages.length && messages[i + 1].role === 'assistant') {
        for (var j = 0; j < runStepsGlobal.length; j++) out.push(runStepsGlobal[j]);
      }
    }
    return out;
  }

  async function finishLocally(sessionId) {
    var data = await api('/api/web/agent/sessions');
    state.sessions = data.sessions || [];
    var sess = await api('/api/web/agent/session?id=' + encodeURIComponent(sessionId));
    state.messages = withSteps(sess.session.messages || []);
    state.busy = false;
    byId('send').disabled = false;
    state.activity = null;
    drawMessages();
  }

  async function send() {
    if (state.busy) return;
    var ta = byId('prompt');
    var text = (ta.value || '').trim();
    if (!text) return;
    state.busy = true;
    byId('send').disabled = true;
    ta.value = '';
    ta.style.height = 'auto';
    var errEl = byId('err'); if (errEl) errEl.textContent = '';
    state.messages.push({ role: 'user', content: text, at: Date.now() });
    state.messages.push({ role: 'assistant', content: '', at: Date.now() });
    var botIdx = state.messages.length - 1;
    var stepIdx = null;
    runStepsGlobal = [];
    var runSteps = runStepsGlobal;
    state.activity = 'thinking…';
    drawMessages();
    try {
      var res = await fetch('/api/web/agent/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: state.active, prompt: text })
      });
      if (!res.ok) {
        var errData = {}; try { errData = await res.json(); } catch (e) {}
        throw new Error(errData.error || ('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '')));
      }
      if (dataLooksJson(res)) {
        // fallback (no ctx streaming) — poll the job
        var started = await res.json();
        if (started.sessionId && started.sessionId !== state.active) {
          state.active = started.sessionId;
          var refreshed = await api('/api/web/agent/sessions');
          state.sessions = refreshed.sessions || [];
          drawMessages();
        }
        pollJob(state.active);
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var sessionId = state.active;
      var gotDone = false;
      var streamDead = false;
      while (true) {
        var chunk = await reader.read().catch(function () { return { done: true }; });
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\\n\\n');
        buffer = events.pop();
        for (var i = 0; i < events.length; i++) {
          var line = events[i];
          if (!line.startsWith('data:')) continue;
          var payload = {};
          try { payload = JSON.parse(line.slice(5).trim()); } catch (e2) { continue; }
          if (payload.event === 'meta') sessionId = payload.sessionId;
          if (payload.event === 'delta' && payload.text) {
            state.messages[botIdx].content += payload.text;
            drawMessages();
            setActivity('writing…');
          }
          if (payload.event === 'status' && payload.status) setActivity(payload.status);
          if (payload.event === 'tool') {
            if (payload.phase === 'start') {
              var argsPreview = '';
              try {
                var parsedA = JSON.parse(payload.args || '{}');
                var keysA = Object.keys(parsedA);
                if (keysA.length) argsPreview = String(parsedA[keysA[0]]).slice(0, 70);
              } catch (eA) { argsPreview = (payload.args || '').slice(0, 70); }
              runSteps.push({ role: 'step', tool: payload.name, done: false, content: argsPreview || 'running', at: Date.now() });
              stepIdx = state.messages.push(runSteps[runSteps.length - 1]) - 1;
              renderToolLine(payload.name, payload.args, null);
              setActivity('running ' + payload.name.replace(/_/g, ' ') + '…');
              drawMessages();
            } else {
              var outPreview = (payload.preview || '').replace(/\s+/g, ' ').slice(0, 70);
              if (stepIdx != null) {
                state.messages[stepIdx].done = true;
                state.messages[stepIdx].content = outPreview || 'done';
              }
              renderToolLine(payload.name, payload.args, outPreview);
              setActivity('reading ' + payload.name.replace(/_/g, ' ') + ' results…');
              drawMessages();
            }
          }
          if (payload.event === 'done') {
            gotDone = true;
            state.messages[botIdx].content = payload.text || state.messages[botIdx].content;
            setActivity(null);
            var data3 = await api('/api/web/agent/sessions');
            state.sessions = data3.sessions || [];
          }
          if (payload.event === 'error') throw new Error(payload.text || 'Agent failed');
        }
      }
      if (!gotDone) {
        // browser closed mid-stream or server kept running — recover by polling
        pollJob(sessionId);
      } else {
        state.busy = false;
        byId('send').disabled = false;
        state.activity = null;
        drawMessages();
      }
    } catch (error) {
      state.busy = false;
      byId('send').disabled = false;
      state.activity = null;
      drawMessages();
      var e3 = byId('err');
      if (e3) e3.textContent = 'Agent failed: ' + error.message;
    }
  }

  function dataLooksJson(res) {
    var ct = res.headers.get('content-type') || '';
    return ct.indexOf('json') >= 0;
  }

  refresh();
})();
</script>
</body>
</html>`;
