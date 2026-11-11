export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord AI Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet">
<style>
  :root {
    color-scheme: dark;
    --bg: #101317;
    --panel: #181c22;
    --panel-2: #1f242c;
    --panel-3: #262c36;
    --line: #2b323d;
    --line-soft: #232933;
    --text: #f2f4f8;
    --muted: #98a1b3;
    --accent: #4f5df0;
    --accent-2: #6b78f5;
    --ok: #34c98e;
    --bad: #f2637a;
    --warn: #e5b158;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #f5f6f8;
    --panel: #ffffff;
    --panel-2: #f2f3f6;
    --panel-3: #e9ebf0;
    --line: #d9dde5;
    --line-soft: #e4e7ed;
    --text: #171a21;
    --muted: #5c6577;
    --accent: #4353e8;
    --accent-2: #5a68ee;
    --ok: #1f9d68;
    --bad: #d64560;
    --warn: #b3801c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font: 14.5px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    transition: background .18s ease, color .18s ease;
  }
  .wrap { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
  h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -.01em; }
  h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; letter-spacing: -.005em; }
  h3 { margin: 0; font-size: 15px; }
  .sub { margin: 6px 0 0; color: var(--muted); max-width: 700px; }
  .userbox { display: flex; align-items: center; gap: 12px; color: var(--muted); }
  .card {
    background: var(--panel);
    border: 1px solid var(--line-soft); border-radius: 12px; padding: 20px; margin-bottom: 14px;
    box-shadow: 0 1px 2px rgba(8,10,14,.06), 0 6px 18px rgba(8,10,14,.08);
  }
  :root[data-theme="light"] .card { box-shadow: 0 1px 2px rgba(15,18,24,.04); }
  .login { text-align: center; padding: 54px 20px; }
  .login p { color: var(--muted); margin: 0 auto 22px; max-width: 460px; }
  label { display: block; margin: 14px 0; color: var(--muted); font-size: 13px; }
  select, textarea, input[type="text"], input[type="password"], input[type="url"] {
    display: block; width: 100%; margin-top: 7px;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 10px;
    padding: 11px 12px; font: inherit; outline: none;
  }
  select:focus, textarea:focus, input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(88,101,242,.18); }
  textarea { resize: vertical; min-height: 120px; }
  .row { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
  .row label { flex: 1; min-width: 180px; }
  .row input[type="checkbox"] { width: 17px; height: 17px; accent-color: var(--accent); }
  .row input[type="file"] { color: var(--muted); font-size: 12px; }
  .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .btn, .ghost {
    border: 0; border-radius: 10px; padding: 10px 14px; font: inherit; font-weight: 600; cursor: pointer;
    text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
  }
  .btn { background: var(--accent); color: #fff; font-weight: 500; }
  .btn:hover { background: var(--accent-2); }
  .btn:disabled { opacity: .55; cursor: wait; }
  .ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  .ghost:hover { color: var(--text); border-color: #3a4459; }
  .btn-small { padding: 8px 11px; font-size: 13px; }
  .status { color: var(--muted); font-size: 13px; }
  .status.ok { color: var(--ok); }
  .status.bad { color: var(--bad); }
  .warning { color: var(--warn); background: rgba(255,204,102,.08); border: 1px solid rgba(255,204,102,.25); padding: 10px 12px; border-radius: 10px; }
  .hidden { display: none !important; }
  .status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .status-grid > div { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .label { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }
  .pill::before { content: ""; width: 8px; height: 8px; border-radius: 99px; background: var(--muted); }
  .pill.ok::before { background: var(--ok); box-shadow: 0 0 12px rgba(61,220,151,.7); }
  .pill.bad::before { background: var(--bad); box-shadow: 0 0 12px rgba(255,107,129,.7); }
  .hint { color: var(--muted); margin: 4px 0 12px; font-size: 13px; }
  .hint a { color: #aeb7ff; }
  code { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; color: #c9d2e6; font-size: 12px; word-break: break-all; }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .toolbar select { width: auto; min-width: 190px; margin: 0; }
  .list { margin-top: 12px; display: grid; gap: 8px; }
  .list-item { display: flex; align-items: center; gap: 12px; padding: 11px 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; }
  .list-item .main { flex: 1; min-width: 0; }
  .list-item .name { font-weight: 600; }
  .list-item .meta { color: var(--muted); font-size: 12px; }
  .list-item .actions { margin-left: auto; display: flex; gap: 6px; }
  .model-list { display: grid; gap: 8px; max-height: 430px; overflow: auto; padding-right: 4px; }
  .model-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; }
  .model-item input[type="checkbox"] { width: 17px; height: 17px; accent-color: var(--accent); flex: 0 0 auto; }
  .model-item .main { flex: 1; min-width: 0; }
  .model-item .name { font-weight: 600; display: block; }
  .model-item .meta { color: var(--muted); font-size: 12px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; letter-spacing: .02em; background: rgba(61,220,151,.12); color: var(--ok); border: 1px solid rgba(61,220,151,.25); }
  .badge.bad { background: rgba(255,107,129,.12); color: var(--bad); border-color: rgba(255,107,129,.25); }
  .badge.muted { background: rgba(139,149,170,.12); color: var(--muted); border-color: rgba(139,149,170,.25); }
  .switch { display: flex; align-items: center; gap: 10px; color: var(--text); font-size: 14px; margin: 0; }
  .switch input { width: 18px; height: 18px; accent-color: var(--accent); }
  .partner { display:flex; align-items:center; gap:14px; }
  .partner img.avatar { width:64px; height:64px; border-radius:50%; border:1px solid var(--line); background: var(--panel-2); object-fit: cover; }
  .provider-row { display: flex; align-items: center; gap: 10px; }
  .provider-row .main { flex: 1; min-width: 0; }
  .provider-row .meta { color: var(--muted); font-size: 12px; }
  .empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
  .icon {
    color: var(--text);
  }
  .icon {
    font-family: 'Material Symbols Rounded';
    font-weight: normal; font-style: normal; line-height: 1;
    letter-spacing: normal; text-transform: none; white-space: nowrap;
    word-wrap: normal; direction: ltr; vertical-align: -4px;
    font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24;
    font-size: 19px; margin-right: 8px; color: var(--text);
  }
  .icon-inline { font-family: 'Material Symbols Rounded'; font-weight: normal; font-style: normal; line-height: 1; font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24; font-size: 16px; vertical-align: -3px; }
  .btn .icon-inline, .ghost .icon-inline { font-size: 16px; }
  .toast {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 50;
    background: var(--panel-3); border: 1px solid var(--bad); color: var(--text);
    border-radius: 10px; padding: 10px 16px; max-width: min(640px, 90vw); font-size: 13px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45); display: none;
  }
  .toast.show { display: block; }

  /* ---- Tab drawer ---- */
  .menu-btn { padding: 8px 10px; }
  .drawer {
    position: fixed; right: 0; top: 0; bottom: 0; transform: translateX(100%);
    width: min(300px, 88vw); z-index: 60;
    background: var(--panel); border-left: 1px solid var(--line-soft);
    padding: 18px 14px; overflow-y: auto;
    transition: transform .22s ease;
    display: flex; flex-direction: column;
  }
  .drawer.open { transform: translateX(0); }
  :root:not([data-theme="light"]) .drawer { border-left-color: var(--line); }
  .drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .drawer-head h2 { margin: 0; font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .07em; }
  .drawer nav { display: grid; gap: 4px; }
  .drawer nav button {
    display: flex; align-items: center; gap: 12px; width: 100%;
    background: transparent; border: 0; border-radius: 10px;
    color: var(--muted); font: inherit; font-weight: 500;
    padding: 11px 12px; cursor: pointer; text-align: left;
  }
  .drawer nav button:hover { background: var(--panel-2); color: var(--text); }
  .drawer nav button.active { background: var(--panel-2); color: var(--text); }
  .drawer nav button.active .icon { color: var(--accent-2); }
  .drawer .icon { margin-right: 0; font-size: 21px; flex: 0 0 auto; }
  .scrim {
    position: fixed; inset: 0; background: rgba(5,8,12,.5); z-index: 55;
    opacity: 0; pointer-events: none; transition: opacity .2s ease;
  }
  .scrim.show { opacity: 1; pointer-events: auto; }
  .modal {
    position: fixed; z-index: 60; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    max-width: 420px; width: calc(100% - 32px);
    margin: 0; scroll-behavior: auto;
  }
  .tabs-note { color: var(--muted); font-size: 12px; margin: 12px 6px 0; }
  .tabbar {
    display: flex; align-items: center; gap: 10px;
    background: var(--panel-2); border: 1px solid var(--line-soft); border-radius: 10px;
    padding: 11px 14px; margin-bottom: 14px; color: var(--muted); font-size: 13px;
    cursor: pointer; width: 100%;
  }
  .tabbar:hover { color: var(--text); border-color: var(--line); }
  .tabbar .chev { margin-left: auto; }
  section[data-tab] { display: none; }
  section[data-tab].active-tab { display: block; }
  @media (max-width: 700px) {
    header { flex-direction: column; }
    .status-grid { grid-template-columns: 1fr; }
    .model-item { align-items: flex-start; flex-wrap: wrap; }
    .model-item .actions { width: 100%; margin-left: 0; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1><span class="icon" style="font-size:clamp(24px,4vw,34px);vertical-align:-6px">smart_toy</span>Discord AI Control</h1>
      <p class="sub">Configure your bot — identity, model channels, provider keys, and server automation.</p>
    </div>
    <button id="navToggle" class="ghost menu-btn" type="button" title="Menu">
      <span class="icon-inline" style="font-size:22px;vertical-align:-5px">menu</span>
    </button>
    <div id="userbox" class="userbox hidden">
      <button id="themeToggle" class="ghost btn-small" type="button" title="Toggle light and dark mode">
        <span class="icon-inline" id="themeIcon">light_mode</span><span id="themeLabel">Light</span>
      </button>
      <span id="username"></span>
      <button id="logout" class="ghost" type="button">Log out</button>
    </div>
  </header>

  <p id="errorBanner" class="warning hidden" style="margin-bottom:16px"></p>
  <div id="toast" class="toast"></div>
  <div id="scrim" class="scrim"></div>
  <aside id="drawer" class="drawer" aria-label="Sections">
    <div class="drawer-head">
      <h2>Menu</h2>
      <button id="navClose" class="ghost menu-btn" type="button" title="Close">
        <span class="icon-inline" style="font-size:22px;vertical-align:-5px">close</span>
      </button>
    </div>
    <nav id="tabNav"></nav>
    <p class="tabs-note">The server picker lives in Your server.</p>
  </aside>

  <main id="loginView" class="card login hidden">
    <h2><span class="icon">waving_hand</span>Welcome</h2>
    <p>Log in with Discord to manage your servers. Your Discord OAuth redirect is <code id="redirect"></code>.</p>
    <a id="loginLink" class="btn" href="/auth/discord">Log in with Discord</a>
  </main>

  <main id="appView" class="hidden">
    <button id="tabPicker" class="tabbar" type="button">
      <span class="icon-inline" id="tabPickerIcon">public</span>
      <strong id="tabPickerLabel" style="color:var(--text)">Your server</strong>
      <span class="chev icon-inline">expand_more</span>
    </button>

    <section class="card" data-tab="server">
      <div class="section-header">
        <div>
          <h2><span class="icon">public</span>Your server</h2>
          <p class="hint">Pick the server you want to change. Everything below happens in that one.</p>
        </div>
      </div>
      <label>Server
        <select id="guildSelect"></select>
      </label>
      <p id="guildWarning" class="warning hidden"></p>
      <div class="actions">
        <button id="runOrganize" class="ghost" type="button">Organize channels</button>
        <button id="runVerifySetup" class="btn-small btn" type="button">Set up verification</button>
        <span id="serverStatus" class="status"></span>
      </div>
      <div id="serverReport" class="list"></div>
    </section>

    <section class="card" data-tab="identity">
      <div class="section-header">
        <div>
          <h2><span class="icon">face</span>Bot identity &amp; style</h2>
          <p class="hint">Fair warning: Discord only allows one username and avatar per bot, so those show up the same everywhere. Everything below, though, is just for this server. Other servers won't notice a thing.</p>
        </div>
      </div>
      <div class="partner">
        <img id="botAvatarPreview" class="avatar" src="" alt="Bot avatar" hidden>
        <div>
          <span class="label">Current avatar</span>
          <span id="botAvatarName" class="hint">Using the default bot look</span>
        </div>
      </div>
      <div class="row">
        <div>
          <label style="margin:0">Current username</label>
          <span id="botUsernameLabel" class="hint" style="display:block"></span>
        </div>
      </div>
      <p class="hint" style="margin-top:10px">🔒 The real bot username and avatar are locked now. Editing those is what used to change every server at once, so that's gone. What's below only touches this server.</p>

      <div class="row" style="margin-top:18px">
        <label>Nickname in this server
          <input id="botNickname" maxlength="32" autocomplete="off" placeholder="Leave blank to use the username">
        </label>
        <label>Reaction emoji <span class="hint">(added to messages sent to the bot)</span>
          <input id="reactionEmoji" maxlength="24" autocomplete="off" placeholder="✅">
        </label>
        <label>Reply emoji <span class="hint">(optional, prepended to replies)</span>
          <input id="replyEmoji" maxlength="24" autocomplete="off" placeholder="💬">
        </label>
      </div>
      <label class="row">
        <input type="checkbox" id="useEmojis" checked>
        Let the bot use emojis in replies
      </label>
      <label>Persona <span class="hint">(extra character instructions layered on top of the system prompt)</span>
        <textarea id="botPersona" rows="4" placeholder="e.g. You are a friendly, playful coding buddy who loves emojis and explains things step by step."></textarea>
      </label>
      <h3 style="margin-top:22px">Per-server appearance</h3>
      <p class="hint">When you set these, replies here show up as this name and face instead of the real bot profile. It only affects this server.</p>
      <div class="row">
        <label>Display name on replies (this server)
          <input id="respondName" maxlength="80" autocomplete="off" placeholder="e.g. Dustin 🤖">
        </label>
        <div>
          <label style="margin:0">Avatar image (this server)</label>
          <input id="respondAvatarFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" style="padding:6px 0">
          <p class="hint">or paste an image URL</p>
          <input id="respondAvatarUrl" type="url" placeholder="https://example.com/avatar.png" style="margin-top:4px">
        </div>
        <button id="clearRespondAvatar" class="ghost btn-small" type="button">Clear server avatar</button>
      </div>
      <span id="respondAvatarName" class="hint"></span>
      <div class="actions">
        <button id="saveBotPersona" class="btn btn-small" type="button">Save identity &amp; style</button>
        <span id="botPersonaStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="bots">
      <div class="section-header">
        <div>
          <h2><span class="icon">forum</span>Respond to bots</h2>
          <p class="hint">Pick other bots here that your bot should talk with. Once enabled, it answers them anywhere in this server, mention or not.</p>
        </div>
      </div>
      <div class="actions">
        <button id="refreshBots" class="ghost btn-small" type="button"><span class="icon-inline">refresh</span>Scan server bots</button>
        <button id="saveRespondBots" class="btn btn-small" type="button">Save selections</button>
        <span id="botsStatus" class="status"></span>
      </div>
      <div id="botsContainer" class="list"></div>
    </section>

    <section class="card" data-tab="community">
      <div class="section-header">
        <div>
          <h2><span class="icon">category</span>Auto Community</h2>
          <p class="hint">One click builds a category with a channel for every free model. You can add more later from the list below.</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="autoCommunity">
          Enabled
        </label>
      </div>
      <div class="actions">
        <button id="autoCommunityRun" class="btn-small btn" type="button">Set up model channels</button>
        <button id="autoCommunityStop" class="ghost btn-small" type="button">Stop</button>
        <span id="autoCommunityStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="models">
      <div class="section-header">
        <div>
          <h2><span class="icon">hub</span>Model channels</h2>
          <p class="hint">Each channel talks to one model and keeps its own conversation, so chats don't bleed into each other.</p>
        </div>
      </div>
      <div class="toolbar">
        <select id="modelProviderFilter"><option value="">All providers</option></select>
        <button id="refreshModels" class="ghost btn-small" type="button"><span class="icon-inline">refresh</span>Refresh models</button>
        <button id="createSelected" class="btn-small btn" type="button">Create selected</button>
        <button id="createRecommended" class="ghost btn-small" type="button">Create starter set</button>
      </div>
      <div id="modelList" class="model-list" style="margin-top:12px"></div>
      <p id="modelsStatus" class="status"></p>

      <div class="section-header" style="margin-top:22px">
        <h3>Connected model channels</h3>
        <button id="checkAllModels" class="ghost btn-small" type="button">Check all</button>
      </div>
      <div id="modelChannelsContainer" class="list"></div>
      <p id="modelChannelsStatus" class="status"></p>
    </section>

    <section class="card" data-tab="keys">
      <div class="section-header">
        <div>
          <h2><span class="icon">key</span>Provider API keys</h2>
          <p class="hint">Keys are stored encrypted. Workers AI runs on the account itself, so it needs no key.</p>
        </div>
      </div>
      <div class="row">
        <label>Provider
          <select id="keyProvider"></select>
        </label>
        <label>API key
          <input id="keyValue" type="password" autocomplete="off" placeholder="Paste the provider key">
        </label>
        <button id="saveKey" class="btn btn-small" type="button">Save key</button>
      </div>
      <p id="providerNote" class="hint"></p>
      <div id="keysContainer" class="list"></div>
      <p id="keysStatus" class="status"></p>
    </section>

    <section class="card" data-tab="agent">
      <div class="section-header">
        <div>
          <h2><span class="icon">chat_bubble</span>Agent trigger</h2>
          <p class="hint">Pick a channel where the bot replies whenever someone mentions it. Discord needs this redirect: <code id="redirectInline"></code></p>
        </div>
      </div>
      <label>Channel
        <select id="channelSelect"></select>
      </label>
      <label class="row">
        <input type="checkbox" id="autoReply">
        Reply to every human message in that channel (no mention needed)
      </label>
      <label>System prompt
        <textarea id="systemPrompt" rows="6" placeholder="Leave blank to use the default prompt."></textarea>
      </label>
      <div class="actions">
        <button id="saveConfig" class="btn" type="button">Save settings</button>
        <span id="saveStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="commands">
      <div class="section-header">
        <div>
          <h2><span class="icon">keyboard_command_key</span>Your slash commands</h2>
          <p class="hint">Make your own slash commands, like /explain, that run whatever prompt you write.</p>
        </div>
        <button id="syncCommands" class="ghost btn-small" type="button">Sync to Discord</button>
      </div>
      <div class="row">
        <label>Command name <span class="hint">(letters, digits, dashes)</span>
          <input id="commandName" maxlength="32" autocomplete="off" placeholder="e.g. explain">
        </label>
        <label>Description
          <input id="commandDescription" maxlength="100" autocomplete="off" placeholder="Shown in Discord (/explain)">
        </label>
      </div>
      <label>Prompt
        <textarea id="commandPrompt" rows="3" placeholder="What the bot should do when someone runs the command."></textarea>
      </label>
      <label class="row">
        <input type="checkbox" id="commandEnabled" checked>
        Enabled
      </label>
      <div class="actions">
        <button id="saveCommand" class="btn btn-small" type="button">Save command</button>
        <span id="commandStatus" class="status"></span>
      </div>
      <div id="commandsContainer" class="list"></div>
    </section>

    <section class="card" data-tab="moderation">
      <div class="section-header">
        <div>
          <h2><span class="icon">shield</span>Auto moderation</h2>
          <p class="hint">The bot deletes messages that break your rules before they go anywhere. Uses its normal powers, so it needs the Delete Messages permission.</p>
        </div>
      </div>
      <label class="row">
        <input type="checkbox" id="automodEnabled">
        Turn on auto moderation for this server
      </label>
      <label>Banned words <span class="hint">(comma or line separated, case does not matter, up to 200)</span>
        <textarea id="automodWords" rows="4" placeholder="spam, harassment, invite-link"></textarea>
      </label>
      <label>Notice when something is removed <span class="hint">({user} inserts the member mention; empty posts nothing)</span>
        <input id="automodNotice" maxlength="300" autocomplete="off" placeholder="{user} your message broke the rules and was removed.">
      </label>
      <div class="actions">
        <button id="saveAutomod" class="btn btn-small" type="button">Save rules</button>
        <span id="automodStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="welcome">
      <div class="section-header">
        <div>
          <h2><span class="icon">notifications_active</span>Welcome &amp; goodbyes</h2>
          <p class="hint">Use {user} to mention the member, {username} for their plain name. Empty text means nothing gets sent.</p>
        </div>
      </div>
      <div class="row">
        <label>Welcome channel
          <select id="welcomeChannel"></select>
        </label>
        <label>Goodbye channel
          <select id="goodbyeChannel"></select>
        </label>
      </div>
      <label>Welcome message
        <textarea id="welcomeText" rows="3" placeholder="Welcome {user} to the server!  Say hi in <#chat>…"></textarea>
      </label>
      <label class="row">
        <input type="checkbox" id="welcomeDm">
        Also send the newcomer a private message
      </label>
      <label>DM text
        <textarea id="welcomeDmText" rows="2" placeholder="Thanks for joining!  Start with <#start-here>…"></textarea>
      </label>
      <label>Goodbye message
        <textarea id="goodbyeText" rows="2" placeholder="{user} left.  Their corner of the server feels emptier."></textarea>
      </label>
      <div class="actions">
        <button id="saveWelcome" class="btn btn-small" type="button">Save settings</button>
        <span id="welcomeStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="announcements">
      <div class="section-header">
        <div>
          <h2><span class="icon">campaign</span>Announcements</h2>
          <p class="hint">One-off posts to a chosen channel. Channel picker fills once the server tab loads its channels.</p>
        </div>
      </div>
      <div class="row">
        <label>Channel
          <select id="announceChannel"></select>
        </label>
        <label class="switch">
          <input type="checkbox" id="announceEveryone">
          Lead with @everyone
        </label>
        <button id="sendAnnouncement" class="btn btn-small" type="button">Post it</button>
        <span id="announceStatus" class="status"></span>
      </div>
      <label>Text
        <textarea id="announceText" rows="6" placeholder="Downtime tonight 01:00-02:00 UTC.  Nothing else changes."></textarea>
      </label>
    </section>

    <section class="card" data-tab="playground">
      <div class="section-header">
        <div>
          <h2><span class="icon">science</span>Playground</h2>
          <p class="hint">Send a prompt through this server's setup and see the reply without touching Discord. The servers panel above picks the provider.</p>
        </div>
      </div>
      <label>Message
        <textarea id="testPrompt" rows="4" placeholder="Try a line you'd ask the bot on Discord…"></textarea>
      </label>
      <div class="actions">
        <button id="runTest" class="btn btn-small" type="button">Run it</button>
        <button id="clearTest" class="ghost btn-small" type="button">Clear</button>
        <span id="testStatus" class="status"></span>
      </div>
      <div id="testReply" class="list" style="margin-top:12px"></div>
    </section>

    <section class="card" data-tab="log">
      <div class="section-header">
        <div>
          <h2><span class="icon">fact_check</span>Activity log</h2>
          <p class="hint">Auto moderation, welcomes, announcements and other actions by the bot, newest first.</p>
        </div>
        <button id="clearLog" class="ghost btn-small" type="button">Clear log</button>
      </div>
      <div id="logContainer" class="list"></div>
    </section>

    <section class="card" data-tab="updates">
      <div class="section-header">
        <div>
          <h2><span class="icon">today</span>Bot updates</h2>
          <p class="hint">Every server gets a read-only ai-chatbot-announcements channel. Turn it on to get pings for new features and fixes; leave it off and the channel stays quiet. No verification needed.</p>
        </div>
      </div>
      <label class="row">
        <input type="checkbox" id="updatesOptIn">
        Send update announcements to this server (pings @everyone)
      </label>
      <div class="actions">
        <span id="updatesChannelStatus" class="status"></span>
      </div>
      <div class="section-header" style="margin-top:16px">
        <div>
          <h3>Latest update</h3>
          <p class="hint" id="updatesLast">Checking…</p>
        </div>
      </div>
      <label>New update announcement
        <textarea id="updateMessage" rows="3" placeholder="Added image generation with the generate_img tool…"></textarea>
      </label>
      <div class="actions">
        <button id="postUpdate" class="btn btn-small" type="button">Push announcement</button>
        <span id="updatePostStatus" class="status"></span>
      </div>
    
      <div class="section-header" style="margin-top:16px">
        <div>
          <h3>Usage restrictions (creator only)</h3>
          <p class="hint">Autonomous ToS bans. Only the bot creator can lift them.</p>
        </div>
      </div>
      <div class="actions">
        <button id="loadBans" class="btn btn-small" type="button">Refresh ban list</button>
        <span id="bansStatus" class="status"></span>
      </div>
      <pre id="bansList" class="mono" style="font-size:12px;white-space:pre-wrap;max-height:220px;overflow:auto"></pre>
      <label>Unban user
        <input id="unbanUserId" type="text" placeholder="Discord user ID" inputmode="numeric">
      </label>
      <div class="actions">
        <button id="unbanBtn" class="btn btn-small" type="button">Unban</button>
        <span id="unbanStatus" class="status"></span>
      </div>
    </section>

    <section class="card" data-tab="gateway">
      <div class="section-header"><h2><span class="icon">satellite_alt</span>Gateway</h2></div>
      <div class="status-grid">
        <div><span class="label">Connection</span><span id="gwConnected" class="pill">checking</span></div>
        <div><span class="label">Last event</span><span id="gwLast">—</span></div>
        <div><span class="label">Sequence</span><span id="gwSeq">—</span></div>
      </div>
      <p id="gwError" class="warning hidden" style="margin-top:12px"></p>
      <div class="actions">
        <button id="restartGateway" class="ghost" type="button">Restart gateway</button>
        <span id="gwStatus" class="status"></span>
      </div>
    </section>

  </main>
</div>

<script>
(function () {
  'use strict';

  var state = {
    guilds: [],
    guildId: '',
    channels: [],
    config: null,
    providers: [],
    keyProviders: [],
    models: [],
    modelChannels: [],
    autoCommunityRunning: false,
    autoCommunityCancelled: false,
    botProfile: null,
    commandEditing: null,
    bots: [],
    enabledBots: []
  };

  // ---- Defensive DOM helpers: nothing may ever throw on a missing element.
  function byId(id) { return document.getElementById(id); }
  function set(id, text) {
    var el = byId(id);
    if (el) el.textContent = text == null ? '' : String(text);
  }
  function warn(id, message) {
    var el = byId(id);
    if (!el) return;
    if (message) { el.textContent = message; el.classList.remove('hidden'); }
    else { el.textContent = ''; el.classList.add('hidden'); }
  }
  function status(id, message, kind) {
    var el = byId(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '');
  }
  function fill(el, html) { if (el) el.innerHTML = html; }
  function on(id, event, handler) {
    var el = byId(id);
    if (el) el.addEventListener(event, handler);
  }
  function val(id) { var el = byId(id); return el ? el.value : ''; }
  function checked(id) { var el = byId(id); return !!(el && el.checked); }
  function toast(message) {
    var el = byId('toast');
    if (!el) { console.error(message); return; }
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () { el.classList.remove('show'); }, 8000);
  }
  window.addEventListener('error', function (event) {
    toast(event.message || 'Something went wrong.');
  });

  function makePopup(title, message) {
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.style.display = 'none';
    var box = document.createElement('div');
    box.className = 'card modal';
    var heading = document.createElement('h3');
    heading.textContent = title;
    var body = document.createElement('p');
    body.className = 'hint';
    body.style.margin = '8px 0 16px';
    body.textContent = message;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-small';
    close.textContent = 'Got it';
    box.appendChild(heading);
    box.appendChild(body);
    box.appendChild(close);
    document.body.appendChild(scrim);
    document.body.appendChild(box);
    function shut() {
      scrim.remove();
      box.remove();
    }
    close.addEventListener('click', shut);
    scrim.addEventListener('click', shut);
    return shut;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleTimeString(); } catch (e) { return '—'; }
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch (e) { return '—'; }
  }
  function providerName(id) {
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].id === id) return state.providers[i].name;
    }
    return id;
  }
  function providerInfo(id) {
    for (var i = 0; i < state.providers.length; i++) {
      if (state.providers[i].id === id) return state.providers[i];
    }
    return null;
  }

  async function api(path, options) {
    var init = Object.assign({ headers: { 'content-type': 'application/json' } }, options || {});
    var response = await fetch(path, init);
    var data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok) {
      var error = new Error((data && data.error) || ('HTTP ' + response.status));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ---- Theme (dark default, light mode supported)

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    var icon = byId('themeIcon');
    var label = byId('themeLabel');
    if (icon) icon.textContent = mode === 'light' ? 'dark_mode' : 'light_mode';
    if (label) label.textContent = mode === 'light' ? 'Dark' : 'Light';
  }

  function currentTheme() {
    var saved = null;
    try { saved = localStorage.getItem('discord-ai-theme'); } catch (e) { saved = null; }
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  applyTheme(currentTheme());
  on('themeToggle', 'click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('discord-ai-theme', next); } catch (e) { /* private mode */ }
  });


  // ---- Tabs
  var TABS = [
    { id: 'server',    label: 'Your server',        icon: 'public' },
    { id: 'identity',  label: 'Identity & style',   icon: 'face' },
    { id: 'bots',      label: 'Bot responders',     icon: 'forum' },
    { id: 'community', label: 'Auto Community',     icon: 'category' },
    { id: 'models',    label: 'Model channels',     icon: 'hub' },
    { id: 'keys',      label: 'API keys',           icon: 'key' },
    { id: 'agent',     label: 'Agent trigger',      icon: 'chat_bubble' },
    { id: 'commands',  label: 'Slash commands',     icon: 'keyboard_command_key' },
    { id: 'gateway',   label: 'Gateway',            icon: 'satellite_alt' },
    { id: 'updates',   label: 'Bot updates',        icon: 'today' },
    { id: 'moderation', label: 'Auto moderation',   icon: 'shield' },
    { id: 'welcome',    label: 'Welcome & goodbyes', icon: 'notifications_active' },
    { id: 'announcements', label: 'Announcements',  icon: 'campaign' },
    { id: 'playground', label: 'Playground',        icon: 'science' },
    { id: 'log',        label: 'Activity log',      icon: 'fact_check' }
  ];
  var activeTab = 'server';

  function buildTabNav() {
    var nav = byId('tabNav');
    if (!nav) return;
    nav.innerHTML = '';
    TABS.forEach(function (tab) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-tab-id', tab.id);
      var icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = tab.icon;
      var label = document.createElement('span');
      label.textContent = tab.label;
      button.appendChild(icon);
      button.appendChild(label);
      button.addEventListener('click', function () {
        showTab(tab.id);
        closeDrawer();
      });
      nav.appendChild(button);
    });
  }

  function showTab(id) {
    activeTab = TABS.some(function (t) { return t.id === id; }) ? id : 'server';
    var sections = document.querySelectorAll('section[data-tab]');
    for (var i = 0; i < sections.length; i++) {
      var el = sections[i];
      el.classList.toggle('active-tab', el.getAttribute('data-tab') === activeTab);
    }
    var buttons = (byId('tabNav') || { children: [] }).children;
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.toggle('active', buttons[j].getAttribute('data-tab-id') === activeTab);
    }
    var tab = TABS.filter(function (t) { return t.id === activeTab; })[0] || TABS[0];
    var icon = byId('tabPickerIcon');
    var label = byId('tabPickerLabel');
    if (icon) icon.textContent = tab.icon;
    if (label) label.textContent = tab.label;
    try { localStorage.setItem('discord-ai-tab', activeTab); } catch (e) { /* ignore */ }
  }

  function openDrawer() {
    var drawer = byId('drawer');
    var scrim = byId('scrim');
    if (drawer) drawer.classList.add('open');
    if (scrim) scrim.classList.add('show');
  }
  function closeDrawer() {
    var drawer = byId('drawer');
    var scrim = byId('scrim');
    if (drawer) drawer.classList.remove('open');
    if (scrim) scrim.classList.remove('show');
  }

  // ---- Rendering

  function renderGuilds() {
    var select = byId('guildSelect');
    if (!select) return;
    select.innerHTML = '';
    if (!state.guilds.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No manageable servers found';
      select.appendChild(empty);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    state.guilds.forEach(function (guild) {
      var option = document.createElement('option');
      option.value = guild.id;
      option.textContent = guild.name + (guild.installed ? '' : ' (bot not installed)');
      select.appendChild(option);
    });
    select.value = state.guildId;
  }

  function renderChannels(selectedId) {
    var select = byId('channelSelect');
    if (!select) return;
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.channels.length ? 'Choose a channel' : 'No text channels found';
    select.appendChild(placeholder);
    state.channels.forEach(function (channel) {
      var option = document.createElement('option');
      option.value = channel.id;
      option.textContent = '#' + channel.name;
      select.appendChild(option);
    });
    if (selectedId && !state.channels.some(function (c) { return c.id === selectedId; })) {
      var missing = document.createElement('option');
      missing.value = selectedId;
      missing.textContent = 'Previously selected channel (unavailable)';
      select.appendChild(missing);
    }
    select.value = selectedId || '';
    select.disabled = !state.channels.length;
  }

  function applyConfig(config) {
    state.config = config;
    var autoReply = byId('autoReply');
    if (autoReply) autoReply.checked = Boolean(config && config.autoReply);
    var systemPrompt = byId('systemPrompt');
    if (systemPrompt) systemPrompt.value = (config && config.systemPrompt) || '';
    renderChannels(config && config.channelId);
  }

  function renderServerReport(report) {
    var container = byId('serverReport');
    if (!container) return;
    container.innerHTML = '';
    if (!report) return;
    var items = [];
    if (report.categoriesCreated && report.categoriesCreated.length) items.push('Categories created: ' + report.categoriesCreated.join(', '));
    if (report.channelsCreated && report.channelsCreated.length) items.push('Channels created: ' + report.channelsCreated.join(', '));
    if (report.channelsReused && report.channelsReused.length) items.push('Channels reused: ' + report.channelsReused.join(', '));
    if (report.roleCreated) items.push('Verified role created.');
    if (report.unverifiedRoleCreated) items.push('Unverified role created.');
    if (report.unverifiedMembersAssigned) items.push('Unverified members assigned: ' + report.unverifiedMembersAssigned);
    if (report.verifyChannelId) items.push('Verify channel: ' + report.verifyChannelId);
    if (report.verificationMessageSent) items.push('Verification message sent and pinned.');
    if (report.errors && report.errors.length) items.push('Errors: ' + report.errors.join(' | '));
    if (!items.length) items.push('Setup completed.');
    items.forEach(function (text) {
      var row = document.createElement('div');
      row.className = 'list-item';
      row.textContent = text;
      container.appendChild(row);
    });
  }

  function renderStatus(data) {
    var statusData = data || {};
    var connected = Boolean(statusData.connected);
    var pill = byId('gwConnected');
    if (pill) {
      pill.textContent = connected ? 'Connected' : (statusData.connecting ? 'Connecting' : 'Disconnected');
      pill.className = 'pill ' + (connected ? 'ok' : 'bad');
    }
    set('gwLast', fmtTime(statusData.lastEventAt));
    set('gwSeq', statusData.sequence != null ? String(statusData.sequence) : '—');
    var message = statusData.lastError;
    if (statusData && !statusData.botConfigured) {
      message = 'DISCORD_BOT_TOKEN is not set on the Worker.';
    }
    warn('gwError', message || '');
  }

  function renderProviderList() {
    var keySelect = byId('keyProvider');
    if (keySelect) {
      var previous = keySelect.value;
      keySelect.innerHTML = '';
      state.keyProviders.forEach(function (provider) {
        var option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name + (provider.configured ? ' (configured)' : '');
        keySelect.appendChild(option);
      });
      if (previous && state.keyProviders.some(function (p) { return p.id === previous; })) {
        keySelect.value = previous;
      }
    }
    renderProviderNote();

    var filter = byId('modelProviderFilter');
    if (filter) {
      var oldFilter = filter.value;
      var first = document.createElement('option');
      first.value = '';
      first.textContent = 'All providers';
      filter.innerHTML = '';
      filter.appendChild(first);
      state.providers.forEach(function (provider) {
        var option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        filter.appendChild(option);
      });
      filter.value = oldFilter;
    }
  }

  function renderProviderNote() {
    var keySelect = byId('keyProvider');
    var note = byId('providerNote');
    if (!keySelect || !note) return;
    var info = providerInfo(keySelect.value);
    if (!info) { note.innerHTML = ''; return; }
    note.innerHTML = esc(info.freeNote || '') +
      (info.docsUrl ? ' <a href="' + esc(info.docsUrl) + '" target="_blank" rel="noopener">Get a key</a>' : '');
  }

  function renderBots() {
    var container = byId('botsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!state.bots.length) {
      fill(container, '<p class="empty">No other bots here yet. Hit “Scan server bots” to look.</p>');
      return;
    }
    state.bots.forEach(function (bot) {
      var row = document.createElement('div');
      row.className = 'list-item';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = bot.id;
      checkbox.setAttribute('data-bot-id', bot.id);
      checkbox.checked = state.enabledBots.indexOf(bot.id) !== -1;
      var avatar = document.createElement('img');
      avatar.style.width = '36px';
      avatar.style.height = '36px';
      avatar.style.borderRadius = '50%';
      avatar.style.border = '1px solid var(--line)';
      avatar.style.flex = '0 0 auto';
      if (bot.avatarUrl) avatar.src = bot.avatarUrl;
      else avatar.alt = '';
      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = bot.displayName;
      name.appendChild(document.createElement('br'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = '@' + bot.username + ' · ' + bot.id;
      main.appendChild(name);
      main.appendChild(meta);
      var badge = document.createElement('span');
      badge.className = 'badge muted';
      badge.textContent = 'Bot';
      row.appendChild(checkbox);
      row.appendChild(avatar);
      row.appendChild(main);
      row.appendChild(badge);
      container.appendChild(row);
    });
  }

  function renderModelList() {
    var container = byId('modelList');
    if (!container) return;
    container.innerHTML = '';
    var filter = val('modelProviderFilter');
    var models = state.models.filter(function (model) {
      return !filter || model.provider === filter;
    });
    if (!models.length) {
      fill(container, '<p class="empty">No free models found for this filter.</p>');
      return;
    }
    models.forEach(function (model) {
      var row = document.createElement('div');
      row.className = 'model-item';

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('data-provider', model.provider);
      checkbox.setAttribute('data-model', model.id);

      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = model.name;
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = providerName(model.provider) + ' · ' + model.id +
        (model.contextLength ? ' · ' + model.contextLength + ' tokens' : '');
      main.appendChild(name);
      main.appendChild(meta);

      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Free';

      var create = document.createElement('button');
      create.className = 'btn btn-small';
      create.type = 'button';
      create.textContent = 'Create channel';
      create.addEventListener('click', function () { createModelChannel(model.provider, model.id); });

      row.appendChild(checkbox);
      row.appendChild(main);
      row.appendChild(badge);
      row.appendChild(create);
      container.appendChild(row);
    });
  }

  function renderModelChannels() {
    var container = byId('modelChannelsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!state.modelChannels.length) {
      fill(container, '<p class="empty">No model channels yet. Create one above or turn on Auto Community.</p>');
      return;
    }
    state.modelChannels.forEach(function (channel) {
      var row = document.createElement('div');
      row.className = 'list-item';

      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = '#' + channel.displayName;
      name.appendChild(document.createElement('br'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = providerName(channel.provider) + ' · ' + channel.model +
        (channel.lastError ? ' · ' + channel.lastError.slice(0, 120) : '');
      main.appendChild(name);
      main.appendChild(meta);

      var badge = document.createElement('span');
      badge.className = 'badge ' + (channel.available ? '' : 'bad');
      badge.textContent = channel.available ? 'Available' : 'Locked';

      var actions = document.createElement('div');
      actions.className = 'actions';
      var check = document.createElement('button');
      check.className = 'ghost btn-small';
      check.type = 'button';
      check.textContent = 'Check';
      check.addEventListener('click', function () { checkModelChannel(channel.channelId); });
      var remove = document.createElement('button');
      remove.className = 'ghost btn-small';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { removeModelChannel(channel.channelId); });
      actions.appendChild(check);
      actions.appendChild(remove);

      row.appendChild(main);
      row.appendChild(badge);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function renderKeys(keys) {
    var container = byId('keysContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!keys || !keys.length) {
      fill(container, '<p class="empty">No encrypted provider keys configured.</p>');
      return;
    }
    keys.forEach(function (key) {
      var row = document.createElement('div');
      row.className = 'list-item provider-row';

      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = providerName(key.provider);
      name.appendChild(document.createElement('br'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = key.provider + ' · updated ' + fmtDate(key.updatedAt);
      main.appendChild(name);
      main.appendChild(meta);

      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Encrypted';

      var actions = document.createElement('div');
      actions.className = 'actions';
      var remove = document.createElement('button');
      remove.className = 'ghost btn-small';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { deleteKey(state.guildId, key.provider); });
      actions.appendChild(remove);

      row.appendChild(main);
      row.appendChild(badge);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function renderCommands(commands) {
    var container = byId('commandsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!commands || !commands.length) {
      fill(container, '<p class="empty">No custom commands yet.</p>');
      return;
    }
    commands.forEach(function (command) {
      var row = document.createElement('div');
      row.className = 'list-item';
      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = '/' + command.name;
      name.appendChild(document.createElement('br'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = (command.description || '') + (command.enabled ? '' : ' · disabled');
      main.appendChild(name);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'actions';
      var edit = document.createElement('button');
      edit.className = 'btn btn-small';
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', function () {
        state.commandEditing = command.name;
        var nameInput = byId('commandName');
        if (nameInput) { nameInput.value = command.name; nameInput.disabled = true; }
        set('commandDescription', command.description || '');
        set('commandPrompt', command.prompt || '');
        var enabledInput = byId('commandEnabled');
        if (enabledInput) enabledInput.checked = Boolean(command.enabled);
        nameInput && nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      var del = document.createElement('button');
      del.className = 'ghost btn-small';
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', function () { deleteCommand(state.guildId, command.name); });
      actions.appendChild(edit);
      actions.appendChild(del);

      row.appendChild(main);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function resetCommandForm() {
    state.commandEditing = null;
    var nameInput = byId('commandName');
    if (nameInput) { nameInput.disabled = false; nameInput.value = ''; }
    set('commandDescription', '');
    set('commandPrompt', '');
    var enabledInput = byId('commandEnabled');
    if (enabledInput) enabledInput.checked = true;
  }

  // ---- Data loading

  async function loadChannels(guildId) {
    state.channels = [];
    try {
      var data = await api('/api/channels?guild_id=' + encodeURIComponent(guildId));
      state.channels = data.channels || [];
      warn('guildWarning', '');
    } catch (error) {
      warn('guildWarning', error.message);
    }
  }

  async function loadProviders(guildId) {
    try {
      var data = await api('/api/providers?guild_id=' + encodeURIComponent(guildId));
      state.providers = data.providers || [];
      state.keyProviders = data.keyProviders || [];
      renderProviderList();
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadModels(refresh) {
    var params = [];
    if (refresh) params.push('refresh=1');
    if (state.guildId) params.push('guild_id=' + encodeURIComponent(state.guildId));
    status('modelsStatus', refresh ? 'Refreshing free models…' : 'Loading free models…');
    try {
      var data = await api('/api/models' + (params.length ? '?' + params.join('&') : ''));
      state.models = data.models || [];
      renderModelList();
      status('modelsStatus', state.models.length + ' free-plan model(s) available.', 'ok');
    } catch (error) {
      status('modelsStatus', error.message, 'bad');
    }
  }

  async function loadModelChannels(guildId) {
    try {
      var data = await api('/api/model-channels?guild_id=' + encodeURIComponent(guildId));
      state.modelChannels = data.channels || [];
      renderModelChannels();
    } catch (error) {
      status('modelChannelsStatus', error.message, 'bad');
    }
  }

  async function loadKeys(guildId) {
    if (!guildId) { renderKeys([]); return; }
    try {
      var data = await api('/api/keys?guild_id=' + encodeURIComponent(guildId));
      renderKeys(data.keys || []);
    } catch (error) {
      status('keysStatus', error.message, 'bad');
    }
  }

  async function loadCommands(guildId) {
    if (!guildId) { renderCommands([]); return; }
    try {
      var data = await api('/api/commands?guild_id=' + encodeURIComponent(guildId));
      renderCommands(data.commands || []);
    } catch (error) {
      status('commandStatus', 'Could not load commands: ' + error.message, 'bad');
    }
  }

  async function loadBots(guildId) {
    if (!guildId) { state.bots = []; state.enabledBots = []; renderBots(); return; }
    status('botsStatus', 'Scanning server bots…');
    try {
      var data = await api('/api/bots?guild_id=' + encodeURIComponent(guildId));
      state.bots = data.bots || [];
      state.enabledBots = data.enabled || [];
      renderBots();
      status('botsStatus', state.bots.length + ' bot(s) found in this server.', 'ok');
    } catch (error) {
      status('botsStatus', error.message, 'bad');
    }
  }

  async function loadGuild(guildId) {
    if (!guildId) { renderChannels(null); return; }
    status('saveStatus', 'Loading…');
    state.guildId = guildId;
    await loadChannels(guildId);
    try {
      var results = await Promise.all([
        api('/api/config?guild_id=' + encodeURIComponent(guildId)),
        loadProviders(guildId),
        loadKeys(guildId),
        loadCommands(guildId),
        loadModelChannels(guildId),
        loadBotPersona(guildId),
        loadBots(guildId),
        loadServerStats(),
        loadModeration(),
        loadWelcomeConfig(),
        loadActivityLog(),
        loadUpdatesCard()
      ]);
      applyConfig(results[0].config);
      refreshPickers();
      await loadModels(false);
      status('saveStatus', '');
    } catch (error) {
      warn('errorBanner', error.message);
    }
  }

  async function loadBotProfile() {
    var preview = byId('botAvatarPreview');
    try {
      var data = await api('/api/bot/profile');
      state.botProfile = data.profile;
      set('botUsernameLabel', data.profile.username ? '@' + data.profile.username : 'unknown');
      if (preview) {
        if (data.profile.avatarUrl) {
          preview.src = data.profile.avatarUrl;
          preview.hidden = false;
        } else {
          preview.hidden = true;
        }
      }
      set('botAvatarName', data.profile.avatarUrl ? 'Custom avatar active' : 'No custom avatar');
    } catch (error) {
      set('botAvatarName', 'Could not load: ' + error.message);
    }
  }

  async function loadBotPersona(guildId) {
    try {
      var data = await api('/api/bot/persona?guild_id=' + encodeURIComponent(guildId));
      var nickname = byId('botNickname');
      if (nickname && nickname !== document.activeElement) nickname.value = data.persona.botNickname || '';
      set('reactionEmoji', data.persona.reactionEmoji || '✅');
      set('replyEmoji', data.persona.replyEmoji || '');
      var useEmojis = byId('useEmojis');
      if (useEmojis) useEmojis.checked = data.persona.useEmojis !== false;
      var persona = byId('botPersona');
      if (persona && persona !== document.activeElement) persona.value = data.persona.persona || '';
      set('respondName', data.persona.respondName || '');
      set('respondAvatarName', data.persona.hasRespondAvatar ? 'Custom server avatar active' : 'Using default bot avatar');
    } catch (error) {
      status('botPersonaStatus', 'Could not load identity settings: ' + error.message, 'bad');
    }
  }

  // ---- Actions

  async function refreshStatus() {
    try {
      var data = await api('/api/gateway/status');
      renderStatus(data.status);
    } catch (error) {
      status('gwStatus', error.message, 'bad');
    }
  }

  async function runServerAction(kind) {
    if (!state.guildId) return;
    var organize = kind === 'organize';
    var button = byId(organize ? 'runOrganize' : 'runVerifySetup');
    if (button) button.disabled = true;
    status('serverStatus', organize ? 'Organizing channels…' : 'Setting up verification…');
    try {
      var data = await api(organize ? '/api/server/organize' : '/api/server/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId })
      });
      renderServerReport(data.report);
      status('serverStatus', organize ? 'Channel setup finished.' : 'Verification setup finished.', 'ok');
      await loadChannels(state.guildId);
    } catch (error) {
      status('serverStatus', error.message, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveConfig() {
    if (!state.guildId) return;
    var button = byId('saveConfig');
    if (button) button.disabled = true;
    status('saveStatus', 'Saving…');
    try {
      var autoCommunity = checked('autoCommunity');
      var data = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          channelId: val('channelSelect') || null,
          autoReply: checked('autoReply'),
          systemPrompt: val('systemPrompt')
        })
      });
      applyConfig(data.config);
      var autoToggle = byId('autoCommunity');
      if (autoToggle) autoToggle.checked = autoCommunity;
      status('saveStatus', 'Saved. Gateway will start automatically.', 'ok');
      refreshStatus();
    } catch (error) {
      status('saveStatus', '', '');
      warn('errorBanner', error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function restart() {
    var button = byId('restartGateway');
    if (button) button.disabled = true;
    status('gwStatus', 'Restarting…');
    try {
      var data = await api('/api/gateway/restart', { method: 'POST', body: '{}' });
      renderStatus(data.status);
      status('gwStatus', 'Restart requested.', 'ok');
    } catch (error) {
      status('gwStatus', error.message, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveKey() {
    if (!state.guildId) return;
    var key = val('keyValue').trim();
    if (!key) { toast('Enter an API key first.'); return; }
    try {
      await api('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, provider: val('keyProvider'), key: key })
      });
      set('keyValue', '');
      await loadKeys(state.guildId);
      await loadProviders(state.guildId);
      await loadModels(true);
      status('keysStatus', 'Key saved and encrypted.', 'ok');
    } catch (error) {
      status('keysStatus', error.message, 'bad');
    }
  }

  async function deleteKey(guildId, provider) {
    if (!confirm('Remove the API key for ' + providerName(provider) + '?')) return;
    try {
      await api('/api/keys?guild_id=' + encodeURIComponent(guildId) + '&provider=' + encodeURIComponent(provider), { method: 'DELETE' });
      await loadKeys(guildId);
      await loadProviders(guildId);
      status('keysStatus', 'Key removed.', 'ok');
    } catch (error) {
      status('keysStatus', error.message, 'bad');
    }
  }

  async function saveCommand() {
    if (!state.guildId) return;
    try {
      await api('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          name: val('commandName').trim(),
          description: val('commandDescription').trim(),
          prompt: val('commandPrompt').trim(),
          enabled: checked('commandEnabled')
        })
      });
      resetCommandForm();
      await loadCommands(state.guildId);
      status('commandStatus', 'Command saved and encrypted.', 'ok');
    } catch (error) {
      status('commandStatus', error.message, 'bad');
    }
  }

  async function deleteCommand(guildId, name) {
    if (!confirm('Delete /' + name + '?')) return;
    try {
      await api('/api/commands?guild_id=' + encodeURIComponent(guildId) + '&name=' + encodeURIComponent(name), { method: 'DELETE' });
      if (state.commandEditing === name) resetCommandForm();
      await loadCommands(guildId);
      status('commandStatus', 'Command deleted.', 'ok');
    } catch (error) {
      status('commandStatus', error.message, 'bad');
    }
  }

  async function syncCommands() {
    if (!state.guildId) return;
    try {
      var result = await api('/api/commands/sync', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId })
      });
      status('commandStatus', 'Synced ' + (result.count || 0) + ' command(s) to Discord.', 'ok');
    } catch (error) {
      status('commandStatus', error.message, 'bad');
    }
  }

  async function createModelChannel(provider, model) {
    if (!state.guildId) return;
    status('modelChannelsStatus', 'Creating channel…');
    try {
      var result = await api('/api/model-channels', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, provider: provider, model: model })
      });
      status('modelChannelsStatus', result.created ? 'Channel created.' : 'Channel already exists.', 'ok');
      await loadModelChannels(state.guildId);
    } catch (error) {
      status('modelChannelsStatus', error.message, 'bad');
    }
  }

  async function createSelected() {
    if (!state.guildId) return;
    var boxes = Array.prototype.slice.call((byId('modelList') || { querySelectorAll: function () { return []; } }).querySelectorAll('input[type="checkbox"]:checked'));
    if (!boxes.length) { status('modelChannelsStatus', 'Select at least one model.', 'bad'); return; }
    for (var i = 0; i < boxes.length; i++) {
      await createModelChannel(boxes[i].getAttribute('data-provider'), boxes[i].getAttribute('data-model'));
    }
    status('modelChannelsStatus', 'Finished creating ' + boxes.length + ' channel(s).', 'ok');
  }

  async function createRecommended() {
    if (!state.guildId) return;
    var models = state.models.filter(function (model) { return model.recommended; });
    if (!models.length) { status('modelChannelsStatus', 'No starter models found.', 'bad'); return; }
    status('modelChannelsStatus', 'Creating starter set…');
    for (var i = 0; i < models.length; i++) {
      await createModelChannel(models[i].provider, models[i].id);
    }
    status('modelChannelsStatus', 'Starter set finished.', 'ok');
  }

  async function checkModelChannel(channelId) {
    if (!state.guildId) return;
    status('modelChannelsStatus', 'Checking model…');
    try {
      var result = await api('/api/model-channels/check', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, channelId: channelId })
      });
      var first = result.results && result.results[0];
      status('modelChannelsStatus', first && first.available ? 'Model is available.' : 'Model is unavailable and the channel was locked.', 'ok');
      await loadModelChannels(state.guildId);
    } catch (error) {
      status('modelChannelsStatus', error.message, 'bad');
    }
  }

  async function checkAllModels() {
    if (!state.guildId) return;
    status('modelChannelsStatus', 'Checking all model channels…');
    try {
      var result = await api('/api/model-channels/check', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId })
      });
      status('modelChannelsStatus', 'Checked ' + ((result.results && result.results.length) || 0) + (result.results && result.results.length === 1 ? ' channel.' : ' channels.'), 'ok');
      await loadModelChannels(state.guildId);
    } catch (error) {
      status('modelChannelsStatus', error.message, 'bad');
    }
  }

  async function removeModelChannel(channelId) {
    if (!state.guildId) return;
    if (!confirm('Delete this model channel from Discord and the dashboard?')) return;
    try {
      await api('/api/model-channels?guild_id=' + encodeURIComponent(state.guildId) + '&channel_id=' + encodeURIComponent(channelId), { method: 'DELETE' });
      await loadModelChannels(state.guildId);
      status('modelChannelsStatus', 'Channel removed.', 'ok');
    } catch (error) {
      status('modelChannelsStatus', error.message, 'bad');
    }
  }

  async function setAutoCommunity(enabled) {
    if (!state.guildId) return;
    if (!enabled) {
      try {
        await api('/api/server/auto-community', {
          method: 'POST',
          body: JSON.stringify({ guildId: state.guildId, enabled: false })
        });
        status('autoCommunityStatus', 'Auto Community disabled.', 'ok');
      } catch (error) {
        status('autoCommunityStatus', error.message, 'bad');
      }
      return;
    }
    if (state.autoCommunityRunning) return;
    state.autoCommunityRunning = true;
    state.autoCommunityCancelled = false;
    var offset = 0;
    var created = 0;
    var skipped = 0;
    try {
      while (!state.autoCommunityCancelled) {
        status('autoCommunityStatus', 'Setting up channels… ' + offset + ' processed');
        var result = await api('/api/server/auto-community', {
          method: 'POST',
          body: JSON.stringify({ guildId: state.guildId, enabled: true, offset: offset, limit: 6 })
        });
        created += result.created || 0;
        skipped += result.skipped || 0;
        if (result.errors && result.errors.length) {
          status('autoCommunityStatus', 'Some channels failed: ' + result.errors[0].error, 'bad');
        }
        if (result.nextOffset == null) break;
        offset = result.nextOffset;
      }
      status('autoCommunityStatus',
        (state.autoCommunityCancelled ? 'Stopped. ' : 'Finished. ') +
        'Created ' + created + ', skipped ' + skipped + '.', 'ok');
      await loadModelChannels(state.guildId);
    } catch (error) {
      status('autoCommunityStatus', error.message, 'bad');
    } finally {
      state.autoCommunityRunning = false;
    }
  }

  async function saveBotPersona() {
    if (!state.guildId) return;
    status('botPersonaStatus', 'Saving…');
    try {
      var respondAvatarUrl = val('respondAvatarUrl').trim();
      var respondFile = byId('respondAvatarFile');
      if (respondFile && respondFile.files && respondFile.files[0]) {
        var file = respondFile.files[0];
        if (file.size > 1.5 * 1024 * 1024) throw new Error('Server avatar is too large (max ~1.5 MB)');
        respondAvatarUrl = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result)); };
          reader.onerror = function () { reject(new Error('Could not read the image file')); };
          reader.readAsDataURL(file);
        });
      }
      var body = {
        guildId: state.guildId,
        botNickname: val('botNickname'),
        useEmojis: checked('useEmojis'),
        reactionEmoji: val('reactionEmoji'),
        replyEmoji: val('replyEmoji'),
        persona: val('botPersona'),
        respondName: val('respondName')
      };
      if (respondAvatarUrl) body.respondAvatarUrl = respondAvatarUrl;
      await api('/api/bot/persona', { method: 'POST', body: JSON.stringify(body) });
      status('botPersonaStatus', 'Saved. The change is live in this server.', 'ok');
    } catch (error) {
      status('botPersonaStatus', error.message, 'bad');
    }
  }

  async function saveBots() {
    if (!state.guildId) return;
    status('botsStatus', 'Saving…');
    try {
      var boxes = Array.prototype.slice.call(
        (byId('botsContainer') || { querySelectorAll: function () { return []; } })
          .querySelectorAll('input[type="checkbox"]:checked')
      );
      var botIds = boxes.map(function (box) { return box.getAttribute('data-bot-id'); })
        .filter(function (id) { return id; });
      var result = await api('/api/bots/respond', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, botIds: botIds })
      });
      state.enabledBots = result.botIds || [];
      status('botsStatus', 'Saved. Your bot now answers ' + state.enabledBots.length + (state.enabledBots.length === 1 ? ' bot here.' : ' bots here.'), 'ok');
    } catch (error) {
      status('botsStatus', error.message, 'bad');
    }
  }


  // ---- Moderation, welcome, announcements, playground, log ----

  function renderLog(events) {
    var container = byId('logContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!events || !events.length) {
      fill(container, '<p class="empty">Nothing logged yet.</p>');
      return;
    }
    events.forEach(function (event) {
      var row = document.createElement('div');
      row.className = 'list-item';
      var main = document.createElement('div');
      main.className = 'main';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = event.kind;
      name.appendChild(document.createElement('br'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = fmtDate(event.at) + ' · ' + event.message;
      main.appendChild(name);
      main.appendChild(meta);
      row.appendChild(main);
      container.appendChild(row);
    });
  }

  async function loadServerStats() {
    if (!state.guildId) return;
    try {
      var data = await api('/api/server/stats?guild_id=' + encodeURIComponent(state.guildId));
      var label = data.stats.name + (data.stats.memberCount != null ? ' · ' + data.stats.memberCount + ' members' : '');
      setTextIfExists('serverStatsLine', label);
    } catch (error) {
      setTextIfExists('serverStatsLine', 'Could not load member count: ' + error.message);
    }
  }

  function setTextIfExists(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  async function loadModeration() {
    if (!state.guildId) return;
    try {
      var data = await api('/api/server/automod?guild_id=' + encodeURIComponent(state.guildId));
      var enabledInput = byId('automodEnabled');
      if (enabledInput) enabledInput.checked = Boolean(data.automod.enabled);
      set('automodWords', data.automod.bannedWords || '');
      set('automodNotice', data.automod.notice || '');
      status('automodStatus', '');
    } catch (error) {
      status('automodStatus', error.message, 'bad');
    }
  }

  async function saveModeration() {
    if (!state.guildId) return;
    status('automodStatus', 'Saving…');
    try {
      await api('/api/server/automod', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          enabled: checked('automodEnabled'),
          bannedWords: val('automodWords'),
          notice: val('automodNotice')
        })
      });
      status('automodStatus', 'Saved. The rules apply right away.', 'ok');
    } catch (error) {
      status('automodStatus', error.message, 'bad');
    }
  }

  async function loadWelcomeConfig() {
    if (!state.guildId) return;
    try {
      var data = await api('/api/server/welcome?guild_id=' + encodeURIComponent(state.guildId));
      renderChannelPickers('welcomeChannel', data.welcome.channelId || 'none', 'None');
      renderChannelPickers('goodbyeChannel', data.welcome.goodbyeChannelId || 'none', 'None');
      set('welcomeText', data.welcome.messageText || '');
      set('welcomeDmText', data.welcome.dmText || '');
      var dm = byId('welcomeDm');
      if (dm) dm.checked = Boolean(data.welcome.dmEnabled);
      set('goodbyeText', data.welcome.goodbyeText || '');
    } catch (error) {
      status('welcomeStatus', error.message, 'bad');
    }
  }

  function renderChannelPickers(selectId, selectedId, emptyLabel) {
    var select = byId(selectId);
    if (!select) return;
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = emptyLabel;
    select.appendChild(first);
    state.channels.forEach(function (channel) {
      var option = document.createElement('option');
      option.value = channel.id;
      option.textContent = '#' + channel.name;
      select.appendChild(option);
    });
    var exists = state.channels.some(function (c) { return c.id === selectedId; });
    if (selectedId && selectedId !== 'none') {
      if (!exists) {
        var missing = document.createElement('option');
        missing.value = selectedId;
        missing.textContent = '(channel not found)';
        select.appendChild(missing);
      }
      select.value = selectedId;
    } else {
      select.value = '';
    }
  }

  async function saveWelcomeConfig() {
    if (!state.guildId) return;
    status('welcomeStatus', 'Saving…');
    try {
      await api('/api/server/welcome', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          channelId: val('welcomeChannel'),
          messageText: val('welcomeText'),
          dmEnabled: checked('welcomeDm'),
          dmText: val('welcomeDmText'),
          goodbyeChannelId: val('goodbyeChannel'),
          goodbyeText: val('goodbyeText')
        })
      });
      status('welcomeStatus', 'Saved. New members get the updated greeting.', 'ok');
    } catch (error) {
      status('welcomeStatus', error.message, 'bad');
    }
  }

  async function postAnnouncement() {
    if (!state.guildId) return;
    var text = val('announceText').trim();
    if (!text) { status('announceStatus', 'Write something first.', 'bad'); return; }
    status('announceStatus', 'Posting…');
    try {
      var result = await api('/api/server/announce', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          channelId: val('announceChannel'),
          text: text,
          mentionEveryone: checked('announceEveryone')
        })
      });
      status('announceStatus', result.sent ? 'Posted.' : 'Not sent.', result.sent ? 'ok' : 'bad');
    } catch (error) {
      status('announceStatus', error.message, 'bad');
    }
  }

  async function runPlayground() {
    if (!val('testPrompt').trim()) { status('testStatus', 'Type a message first.', 'bad'); return; }
    var button = byId('runTest');
    if (button) button.disabled = true;
    status('testStatus', 'Thinking…');
    try {
      var result = await api('/api/agent/test', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, prompt: val('testPrompt').trim() })
      });
      var container = byId('testReply');
      if (container) {
        container.innerHTML = '';
        var row = document.createElement('div');
        row.className = 'list-item';
        var main = document.createElement('div');
        main.className = 'main';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = result.provider + ' · ' + result.model;
        name.appendChild(document.createElement('br'));
        var meta = document.createElement('span');
        meta.className = 'meta';
        meta.style.whiteSpace = 'pre-wrap';
        meta.textContent = result.reply;
        main.appendChild(name);
        main.appendChild(meta);
        row.appendChild(main);
        container.appendChild(row);
      }
      status('testStatus', '', '');
    } catch (error) {
      status('testStatus', error.message, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadActivityLog() {
    if (!state.guildId) return;
    try {
      var data = await api('/api/server/log?guild_id=' + encodeURIComponent(state.guildId));
      renderLog(data.events);
    } catch (error) {
      status('logStatus', error.message, 'bad');
    }
  }

  async function clearActivityLog() {
    if (!state.guildId) return;
    try {
      await api('/api/server/log?guild_id=' + encodeURIComponent(state.guildId) + '&clear=1', { method: 'GET' });
      renderLog([]);
      if (byId('clearLog')) byId('clearLog').disabled = true;
    } catch (error) {
      status('logStatus', error.message, 'bad');
    }
  }

  function refreshPickers() {
    renderChannelPickers('welcomeChannel', val('welcomeChannel') || 'none', 'None');
    renderChannelPickers('goodbyeChannel', val('goodbyeChannel') || 'none', 'None');
    renderChannelPickers('announceChannel', val('announceChannel'), 'Pick a channel');
  }

  // ---- Bot updates ----

  async function loadUpdatesCard() {
    if (!state.guildId) return;
    var statusEl = byId('updatesChannelStatus');
    if (statusEl) { statusEl.textContent = 'Opening the channel…'; statusEl.className = 'status'; }
    try {
      var data = await api('/api/server/updates?guild_id=' + encodeURIComponent(state.guildId));
      var box = byId('updatesOptIn');
      if (box) box.checked = Boolean(data.updates.optedIn);
      if (statusEl) {
        statusEl.textContent = data.updates.created && data.updates.optedIn === undefined
          ? ''
          : '';
        statusEl.textContent = '#' + data.updates.channelName + ' is ready in this server.';
      }
    } catch (error) {
      if (statusEl) { statusEl.textContent = error.message; statusEl.className = 'status bad'; }
    }
    try {
      var last = await api('/api/bot/update');
      set('updatesLast', last.optedInServers + ' server(s) currently get update pings.');
    } catch {
      set('updatesLast', '');
    }
    loadBans();
  }

  // ---- Creator-only ToS ban management ----

  async function loadBans() {
    status('bansStatus', 'Loading…');
    try {
      var data = await api('/api/moderation/bans');
      var bans = data.bans || [];
      if (!bans.length) {
        set('bansList', 'No active restrictions.');
      } else {
        set('bansList', bans.map(function (b) {
          return b.user_id + (b.until ? ' — until ' + b.until : ' — PERMANENT') +
            '\\n  ' + (b.reason || '(no reason)') + '  [' + b.created_at + ']';
        }).join('\\n'));
      }
      status('bansStatus', bans.length + ' active.', 'ok');
    } catch (error) {
      status('bansStatus', error.message, 'bad');
      set('bansList', '');
    }
  }

  async function runUnban() {
    var userId = String(byId('unbanUserId') ? byId('unbanUserId').value : '').trim();
    if (!userId) { status('unbanStatus', 'Enter a user ID first.', 'bad'); return; }
    status('unbanStatus', 'Unbanning…');
    try {
      var data = await api('/api/moderation/unban', {
        method: 'POST',
        body: JSON.stringify({ userId: userId })
      });
      status('unbanStatus', data.removed ? 'Unbanned.' : 'No such ban.', data.removed ? 'ok' : 'bad');
      if (data.removed) { set('unbanUserId', ''); loadBans(); }
    } catch (error) {
      status('unbanStatus', error.message, 'bad');
    }
  }

  async function saveUpdatesOptIn() {
    if (!state.guildId) return;
    status('updatesChannelStatus', 'Saving…');
    try {
      var data = await api('/api/server/updates', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, optedIn: checked('updatesOptIn') })
      });
      status('updatesChannelStatus', data.updates.optedIn
        ? 'On. This server gets pinged for every update.'
        : 'Off. The channel stays quiet.', 'ok');
    } catch (error) {
      status('updatesChannelStatus', error.message, 'bad');
    }
  }

  async function postBotUpdate() {
    var message = val('updateMessage').trim();
    if (!message) { status('updatePostStatus', 'Write the update note first.', 'bad'); return; }
    status('updatePostStatus', 'Sending to every opted-in server…');
    try {
      var result = await api('/api/bot/update', {
        method: 'POST',
        body: JSON.stringify({ message: message })
      });
      status('updatePostStatus', result.sent + ' server(s) pinged' + (result.failed ? '; ' + result.failed + ' skipped.' : '.'), 'ok');
      set('updateMessage', '');
    } catch (error) {
      status('updatePostStatus', error.message, 'bad');
    }
  }

  // ---- Init

  async function init() {
    buildTabNav();
    var savedTab = null;
    try { savedTab = localStorage.getItem('discord-ai-tab'); } catch (e) { savedTab = null; }
    showTab(TABS.some(function (t) { return t.id === savedTab; }) ? savedTab : 'server');
    var redirect = location.origin + '/auth/callback';
    set('redirect', redirect);
    set('redirectInline', redirect);
    var loginLink = byId('loginLink');
    if (loginLink) loginLink.href = '/auth/discord';

    var params = new URLSearchParams(location.search);
    var urlError = params.get('error');
    if (urlError) {
      warn('errorBanner', urlError);
      toast('Login failed: ' + urlError);
      history.replaceState(null, '', '/dashboard');
    }

    try {
      var session = await api('/api/session');
      var loginView = byId('loginView');
      var appView = byId('appView');
      var userbox = byId('userbox');
      if (loginView) loginView.classList.add('hidden');
      if (appView) appView.classList.remove('hidden');
      if (userbox) userbox.classList.remove('hidden');
      set('username', session.user.globalName || session.user.username);

      var results = await Promise.all([
        api('/api/guilds'),
        loadBotProfile(),
        refreshStatus()
      ]);
      state.guilds = results[0].guilds || [];
      if (results[0].botError) warn('errorBanner', results[0].botError);
      renderGuilds();

      var saved = localStorage.getItem('discord-ai-guild');
      var selected = state.guilds.some(function (g) { return g.id === saved; })
        ? saved
        : (state.guilds[0] && state.guilds[0].id);
      state.guildId = selected || '';
      if (selected) {
        var guildSelect = byId('guildSelect');
        if (guildSelect) guildSelect.value = selected;
        await loadGuild(selected);
      }
      setInterval(function () { refreshStatus(); }, 10000);
    } catch (error) {
      if (error.status === 401) {
        var loginView2 = byId('loginView');
        var appView2 = byId('appView');
        var userbox2 = byId('userbox');
        if (loginView2) loginView2.classList.remove('hidden');
        if (appView2) appView2.classList.add('hidden');
        if (userbox2) userbox2.classList.add('hidden');
      } else {
        warn('errorBanner', error.message);
      }
    }
  }

  // ---- Event wiring (all targets exist in the static markup above)

  on('guildSelect', 'change', function () {
    var guildId = val('guildSelect');
    state.guildId = guildId;
    localStorage.setItem('discord-ai-guild', guildId);
    loadGuild(guildId);
  });
  on('logout', 'click', async function () {
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ }
    location.reload();
  });
  on('runOrganize', 'click', function () { runServerAction('organize'); });
  on('runVerifySetup', 'click', function () { runServerAction('verify'); });
  on('saveBotPersona', 'click', saveBotPersona);
  on('clearRespondAvatar', 'click', async function () {
    if (!state.guildId) return;
    status('botPersonaStatus', 'Clearing server avatar…');
    try {
      await api('/api/bot/persona', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          botNickname: val('botNickname'),
          useEmojis: checked('useEmojis'),
          reactionEmoji: val('reactionEmoji'),
          replyEmoji: val('replyEmoji'),
          persona: val('botPersona'),
          respondName: val('respondName'),
          removeRespondAvatar: true
        })
      });
      var preview = byId('respondAvatarPreview');
      if (preview) preview.hidden = true;
      status('botPersonaStatus', 'Server avatar cleared.', 'ok');
    } catch (error) {
      status('botPersonaStatus', error.message, 'bad');
    }
  });
  on('autoCommunity', 'change', function () { setAutoCommunity(checked('autoCommunity')); });
  on('autoCommunityRun', 'click', function () {
    var toggle = byId('autoCommunity');
    if (toggle) toggle.checked = true;
    setAutoCommunity(true);
  });
  on('autoCommunityStop', 'click', function () {
    state.autoCommunityCancelled = true;
    var toggle = byId('autoCommunity');
    if (toggle) toggle.checked = false;
    setAutoCommunity(false);
  });
  on('modelProviderFilter', 'change', renderModelList);
  on('refreshModels', 'click', function () { loadModels(true); });
  on('createSelected', 'click', createSelected);
  on('createRecommended', 'click', createRecommended);
  on('checkAllModels', 'click', checkAllModels);
  on('keyProvider', 'change', renderProviderNote);
  on('saveKey', 'click', saveKey);
  on('saveConfig', 'click', saveConfig);
  on('saveCommand', 'click', saveCommand);
  on('syncCommands', 'click', syncCommands);
  on('refreshBots', 'click', function () { loadBots(state.guildId); });
  on('saveRespondBots', 'click', saveBots);
  on('restartGateway', 'click', restart);
  on('saveAutomod', 'click', saveModeration);
  on('saveWelcome', 'click', saveWelcomeConfig);
  on('sendAnnouncement', 'click', postAnnouncement);
  on('runTest', 'click', runPlayground);
  on('clearTest', 'click', function () {
    set('testPrompt', '');
    var container = byId('testReply');
    if (container) container.innerHTML = '';
  });
  on('clearLog', 'click', clearActivityLog);
  on('updatesOptIn', 'change', saveUpdatesOptIn);
  on('postUpdate', 'click', postBotUpdate);
  on('loadBans', 'click', loadBans);
  on('unbanBtn', 'click', runUnban);

  on('navToggle', 'click', openDrawer);
  on('navClose', 'click', closeDrawer);
  on('scrim', 'click', closeDrawer);
  on('tabPicker', 'click', openDrawer);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
</body>
</html>`;
