// Sous Alexa+ simulator: an Echo Show-style host for the Sous MCP server.
// It sends what you say to /api/converse (the simulated Alexa+ agent, which calls Sous over MCP),
// speaks the reply, and renders the tool's MCP App (ui://sous/*.html) in a sandboxed iframe,
// acting as the host side of the MCP Apps postMessage JSON-RPC bridge.

const $ = (id) => document.getElementById(id);
const MOCK = new URLSearchParams(location.search).has('mock');
const STAGE_W = 1280;
const APP_H = 708; // stage is 1280x800; the bottom 92px is the Alexa caption strip
const APPS_PROTOCOL = '2026-01-26';

const CHIPS = [
  'What should we cook tonight?',
  'Plan dinners for the next three nights',
  'Yes, place the order',
  "Let's cook the first one",
  'Next step',
  'Yes',
  'How much food have we saved?',
  "What's about to expire?",
  "Remember Ava doesn't like mushrooms",
];
const TRY = [
  '“Alexa, what should we cook tonight?”',
  '“Alexa, what’s about to expire?”',
  '“Alexa, how much food have we saved?”',
  '“Alexa, remember Leo is allergic to peanuts.”',
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const short = (uri) => String(uri || '').replace('ui://sous/', '');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

let sessionId = null;
try { sessionId = sessionStorage.getItem('sous.sid'); } catch { /* storage unavailable */ }
if (!sessionId) {
  sessionId = crypto.randomUUID ? crypto.randomUUID() : 's' + Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('sous.sid', sessionId); } catch { /* storage unavailable */ }
}

/* ---------- stage scaling: views render on a fixed 1280x800 canvas, like a real Echo Show ---------- */
const stage = $('stage');
const screenEl = $('screen');
const fit = () => { stage.style.transform = `scale(${screenEl.clientWidth / STAGE_W})`; };
new ResizeObserver(fit).observe(screenEl);
fit();

/* ---------- light bar + caption + toast ---------- */
function light(state) {
  $('lightbar').dataset.state = state;
  document.body.dataset.light = state;
}
let capTimer = 0;
function caption({ you, alexa }) {
  clearTimeout(capTimer);
  if (you !== undefined) $('capYou').textContent = you;
  if (alexa !== undefined) $('capAlexa').innerHTML = alexa;
  $('caption').classList.add('show');
}
function hideCaptionSoon(ms = 4500) {
  clearTimeout(capTimer);
  capTimer = setTimeout(() => $('caption').classList.remove('show'), ms);
}
let toastTimer = 0;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
}

/* ---------- speech out ---------- */
let muted = store.get('sous.muted') === '1';
const muteBtn = $('muteBtn');
function syncMute() {
  muteBtn.textContent = muted ? '🔇 Voice off' : '🔊 Voice on';
  muteBtn.setAttribute('aria-pressed', String(muted));
}
syncMute();
muteBtn.onclick = () => {
  muted = !muted;
  store.set('sous.muted', muted ? '1' : '0');
  if (muted) try { speechSynthesis.cancel(); } catch { /* no synthesis */ }
  syncMute();
};
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  for (const p of [/Samantha/i, /Google US English/i, /Aria/i, /Jenny/i, /Joanna/i, /Zira/i]) {
    const v = voices.find((x) => p.test(x.name));
    if (v) return v;
  }
  return voices.find((v) => /en[-_]US/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

let speakToken = 0;
function say(text) {
  const token = ++speakToken;
  if (!text) { light(listening ? 'listening' : 'idle'); return; }
  caption({ alexa: esc(text) });
  light('speaking');
  const finish = () => {
    if (token !== speakToken) return;
    light(listening ? 'listening' : 'idle');
    hideCaptionSoon(2500);
  };
  const estimate = Math.min(12000, 900 + text.length * 58);
  if (muted || !('speechSynthesis' in window)) { setTimeout(finish, estimate); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.04;
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
    // Some browsers never fire onend; poll as a backstop.
    const guard = () => {
      if (token !== speakToken) return;
      if (speechSynthesis.speaking || speechSynthesis.pending) setTimeout(guard, 500);
      else finish();
    };
    setTimeout(guard, 1500);
  } catch {
    setTimeout(finish, estimate);
  }
}

/* ---------- chime (WebAudio) ---------- */
let audio = null;
const unlockAudio = () => {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
};
addEventListener('pointerdown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });
function chime() {
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.9].forEach((offset) => {
    [880, 1174.66, 1567.98].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = now + offset + i * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.75);
    });
  });
}

/* ---------- timers ---------- */
const timers = new Map();
function setTimers(list) {
  if (!Array.isArray(list)) return;
  const seen = new Set();
  for (const t of list) {
    const id = String(t.id ?? t.label);
    seen.add(id);
    const endsAt = t.endsAt ? Date.parse(t.endsAt) : Date.now() + (t.secondsFromNow ?? t.seconds ?? 0) * 1000;
    if (timers.has(id)) { timers.get(id).endsAt = endsAt; continue; }
    const el = document.createElement('div');
    el.className = 'timer';
    el.innerHTML = '<svg viewBox="0 0 46 46"><circle class="trk" cx="23" cy="23" r="19" fill="none" stroke-width="4"/>' +
      '<circle class="arc" cx="23" cy="23" r="19" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="119.4"/></svg>' +
      `<div><div class="tl">${esc(t.label || 'Timer')}</div><div class="tt">--:--</div></div>`;
    el.title = 'Click to dismiss';
    el.onclick = () => { if (timers.get(id)?.done) { el.remove(); timers.delete(id); } };
    $('timers').appendChild(el);
    timers.set(id, { id, label: t.label || 'Timer', seconds: t.seconds || 0, endsAt, el, done: false });
  }
  // Drop timers the server no longer reports, unless they are about to ring here.
  for (const [id, t] of timers) {
    if (!seen.has(id) && !t.done && t.endsAt - Date.now() > 2000) { t.el.remove(); timers.delete(id); }
  }
  tickTimers();
}
function tickTimers() {
  const now = Date.now();
  for (const t of timers.values()) {
    const left = Math.max(0, t.endsAt - now);
    const s = Math.ceil(left / 1000);
    t.el.querySelector('.tt').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const frac = t.seconds ? left / (t.seconds * 1000) : 0;
    t.el.querySelector('.arc').style.strokeDashoffset = String(119.4 * (1 - Math.min(1, frac)));
    if (left <= 0 && !t.done) {
      t.done = true;
      t.el.classList.add('done');
      chime();
      say(`Your ${t.label} timer is done.`);
      setTimeout(() => { if (timers.get(t.id) === t) { t.el.remove(); timers.delete(t.id); } }, 25000);
    }
  }
}
setInterval(tickTimers, 250);

/* ---------- engine badge ---------- */
function setEngine(engine, idle = false) {
  if (!engine) return;
  const b = $('engineBadge');
  b.className = 'badge engine ' + engine;
  b.textContent = idle
    ? (engine === 'bedrock' ? 'Amazon Bedrock ready' : 'rules engine (no LLM)')
    : (engine === 'bedrock' ? 'engine · Amazon Bedrock' : 'engine · rules');
}

/* ---------- MCP trace drawer ---------- */
let lastTurn = null;
function openTrace(open) {
  document.body.classList.toggle('trace-open', open);
  $('trace').setAttribute('aria-hidden', String(!open));
  $('traceBtn').setAttribute('aria-expanded', String(open));
  store.set('sous.trace', open ? '1' : '0');
}
$('traceBtn').onclick = () => openTrace(!document.body.classList.contains('trace-open'));
$('traceClose').onclick = () => openTrace(false);
if (store.get('sous.trace') === '1') openTrace(true);

function addTurn(resp, origin) {
  const list = $('trList');
  list.querySelector('.tr-empty')?.remove();
  const el = document.createElement('div');
  el.className = 'turn';
  const calls = (resp.toolCalls || []).map((c) =>
    `<div class="call"><div class="call-h"><code>tools/call · ${esc(c.name)}</code><span class="ms">${esc(c.ms ?? '?')} ms</span>` +
    `<span class="${c.ok === false ? 'bad' : 'ok'}">${c.ok === false ? 'ERROR' : 'OK'}</span></div>` +
    `<pre>${esc(JSON.stringify(c.arguments ?? {}, null, 1))}</pre></div>`).join('');
  el.innerHTML =
    `<div class="turn-h"><span class="src">${origin.src === 'view' ? 'tap' : 'voice'}</span><span class="q" title="${esc(origin.label)}">${esc(origin.label)}</span>` +
    (origin.src === 'view' ? '<span class="eng view">view → host</span>' : '') +
    (resp.engine ? `<span class="eng ${esc(resp.engine)}">${esc(resp.engine)}</span>` : '') +
    `<span class="ms">${esc(origin.ms)} ms</span></div>` +
    (calls || '<div class="bridge">no tool call (answered by the agent)</div>') +
    (resp.ui ? `<div class="bridge">MCP App <b>${esc(resp.ui.resourceUri)}</b> · text/html;profile=mcp-app</div>` : '') +
    (resp.speech ? `<div class="speech">${esc(resp.speech)}</div>` : '');
  list.prepend(el);
  lastTurn = el;
  while (list.children.length > 40) list.lastElementChild.remove();
}
function bridgeNote(html) {
  if (!lastTurn) return;
  const n = document.createElement('div');
  n.className = 'bridge';
  n.innerHTML = html;
  const speech = lastTurn.querySelector('.speech');
  lastTurn.insertBefore(n, speech);
}
function traceError(label, err) {
  addTurn({ toolCalls: [], speech: '' }, { src: 'voice', label, ms: '–' });
  bridgeNote(`<span style="color:#ff9b88">error: ${esc(err.message || err)}</span>`);
}

/* ---------- MCP Apps host: sandboxed iframes + JSON-RPC over postMessage ---------- */
let entries = [];
let current = null;

function showIdle(show) { $('idle').classList.toggle('hide', !show); }

// MCP Apps order: tool-input (the call's arguments) first, then tool-result. Nothing before the view initializes.
function sendResult(entry, result, input) {
  if (!result) return;
  if (!entry.ready) { entry.pending = { result, input }; return; }
  const w = entry.frame.contentWindow;
  if (!w) return;
  w.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: input || {} } }, '*');
  w.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
}
function flushPending(entry) {
  if (!entry.pending) return false;
  const { result, input } = entry.pending;
  entry.pending = null;
  sendResult(entry, result, input);
  return true;
}

async function showUi(ui) {
  let html = ui.html;
  if (!html && MOCK) html = await mock.viewHtml(ui.resourceUri);
  if (!html) return;
  showIdle(false);
  if (current && current.uri === ui.resourceUri && current.html === html) {
    sendResult(current, ui.toolResult, ui.toolInput);
    bridgeNote(`host → view <b>tool-input</b> + <b>tool-result</b> · ${esc(short(ui.resourceUri))} (live update)`);
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'Sous MCP App · ' + short(ui.resourceUri));
  const entry = { uri: ui.resourceUri, html, frame, ready: false, pending: { result: ui.toolResult, input: ui.toolInput } };
  frame.addEventListener('load', () => {
    requestAnimationFrame(() => frame.classList.add('in'));
    // Tolerate views that skip the handshake: deliver the result anyway.
    setTimeout(() => {
      if (!entry.ready && entry.pending) {
        entry.ready = true;
        flushPending(entry);
      }
    }, 1500);
  });
  frame.srcdoc = html;
  $('appHost').appendChild(frame);
  entries.push(entry);
  const old = current;
  current = entry;
  if (old) {
    old.frame.classList.remove('in');
    old.frame.classList.add('out');
    setTimeout(() => { old.frame.remove(); entries = entries.filter((e) => e !== old); }, 500);
  }
}

addEventListener('message', async (ev) => {
  const entry = entries.find((e) => e.frame.contentWindow === ev.source);
  const m = ev.data;
  if (!entry || !m || typeof m !== 'object' || m.jsonrpc !== '2.0') return;
  const reply = (id, result, error) => ev.source.postMessage(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }, '*');

  switch (m.method) {
    case 'ui/initialize':
      reply(m.id, {
        protocolVersion: APPS_PROTOCOL,
        hostInfo: { name: 'sous-echo-sim', version: '1.0.0' },
        hostCapabilities: { serverTools: {}, message: {} },
        hostContext: {
          theme: 'dark', displayMode: 'inline', platform: 'web', locale: 'en-US',
          containerDimensions: { width: STAGE_W, height: APP_H },
          deviceCapabilities: { touch: true, hover: false },
        },
      });
      bridgeNote(`view → host <b>ui/initialize</b> · ${esc(short(entry.uri))}`);
      return;
    case 'ui/notifications/initialized':
      entry.ready = true;
      if (flushPending(entry)) bridgeNote(`host → view <b>tool-input</b> + <b>tool-result</b> · ${esc(short(entry.uri))}`);
      return;
    case 'tools/call': {
      const { name, arguments: args } = m.params || {};
      light('thinking');
      const t0 = performance.now();
      try {
        const resp = MOCK ? await mock.tool(name, args) : await post('/api/tool', { name, arguments: args || {}, sessionId });
        const result = resp.result || resp.ui?.toolResult || { content: [{ type: 'text', text: resp.speech || '' }] };
        reply(m.id, result);
        await handle(resp, { src: 'view', label: `${name} (from ${short(entry.uri)})`, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        reply(m.id, undefined, { code: -32603, message: String(err.message || err) });
        say("Sorry, that didn't work.");
      }
      return;
    }
    case 'ui/message': {
      // A view can speak for the user, as if they said it to Alexa.
      const text = m.params?.content?.text || m.params?.content?.[0]?.text;
      if (m.id != null) reply(m.id, {});
      if (text) submit(text);
      return;
    }
    case 'ui/open-link':
    case 'ui/size-changed':
    case 'ui/notifications/size-changed':
      if (m.id != null) reply(m.id, {});
      return;
    default:
      if (m.id != null && m.method) reply(m.id, undefined, { code: -32601, message: `Method not found: ${m.method}` });
  }
});

/* ---------- talking to Sous ---------- */
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || j?.error || j?.message || `HTTP ${r.status}`);
  return j;
}

async function handle(resp, origin) {
  resp = resp || {};
  setEngine(resp.engine);
  addTurn(resp, origin);
  setTimers(resp.timers);
  if (resp.ui) await showUi(resp.ui);
  say(resp.speech || '');
}

async function submit(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  $('text').value = '';
  const clean = text.replace(/^\s*(hey\s+|ok\s+)?alexa\b[\s,.:;!-]*/i, '').trim() || text;
  ++speakToken;
  try { speechSynthesis.cancel(); } catch { /* no synthesis */ }
  caption({ you: text, alexa: '' });
  light('thinking');
  markChip(clean);
  const t0 = performance.now();
  try {
    const resp = MOCK ? await mock.converse(clean) : await post('/api/converse', { text: clean, sessionId });
    await handle(resp, { src: 'voice', label: text, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    console.error(err);
    traceError(text, err);
    say("Sorry, I can't reach Sous right now.");
    toast('Sous server not reachable. Run npm start, or add ?mock=1 to preview with sample data.');
  }
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); submit($('text').value); });

/* ---------- suggestion chips (demo script order) ---------- */
let chipIndex = 0;
function renderChips() {
  $('chips').innerHTML = CHIPS.map((c, i) =>
    `<button class="chip${i === chipIndex ? ' next' : ''}${i < chipIndex ? ' used' : ''}" role="listitem" data-i="${i}"><span class="n">${i + 1}</span>${esc(c)}</button>`).join('');
  $('chips').querySelector('.next')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (b) submit(CHIPS[Number(b.dataset.i)]);
});
function markChip(text) {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const i = CHIPS.findIndex((c) => c.toLowerCase().replace(/[^a-z0-9 ]/g, '') === t);
  if (i >= 0) chipIndex = i + 1;
  renderChips();
}
renderChips();

/* ---------- speech in: push-to-talk ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
let heard = '';
if (!SR) {
  $('micBtn').classList.add('unavailable');
  $('micBtn').title = 'Voice input needs Chrome or Edge (Brave and Firefox lack the Web Speech API). Type instead.';
}
function startListening() {
  if (!SR) {
    toast('Voice input needs Chrome or Edge here. Type what you would say instead.');
    $('text').focus();
    return;
  }
  if (listening) return;
  ++speakToken;
  try { speechSynthesis.cancel(); } catch { /* no synthesis */ }
  heard = '';
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) heard += r[0].transcript;
      else interim += r[0].transcript;
    }
    caption({ you: '', alexa: `<span class="interim">${esc((heard + ' ' + interim).trim() || 'Listening…')}</span>` });
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked for this page.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice input error: ' + e.error);
  };
  rec.onend = () => {
    listening = false;
    $('micBtn').classList.remove('on');
    const t = heard.trim();
    if (t) submit(t);
    else { light('idle'); hideCaptionSoon(800); }
  };
  try {
    rec.start();
    listening = true;
    $('micBtn').classList.add('on');
    light('listening');
    caption({ you: '', alexa: '<span class="interim">Listening…</span>' });
  } catch (err) {
    toast('Could not start the microphone: ' + err.message);
  }
}
function stopListening() { if (rec && listening) try { rec.stop(); } catch { /* already stopped */ } }
$('micBtn').onclick = () => (listening ? stopListening() : startListening());

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
let spaceHeld = false;
addEventListener('keydown', (e) => {
  if (typing(document.activeElement)) return;
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); spaceHeld = true; startListening(); }
  else if (e.key === 't' || e.key === 'T') openTrace(!document.body.classList.contains('trace-open'));
  else if (e.key === 'Escape') openTrace(false);
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' && spaceHeld) { e.preventDefault(); spaceHeld = false; stopListening(); }
});

/* ---------- idle / ambient screen ---------- */
function clock() {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  $('clock').innerHTML = `${h}:${String(d.getMinutes()).padStart(2, '0')}<small>${d.getHours() >= 12 ? 'PM' : 'AM'}</small>`;
  $('idleDate').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
clock();
setInterval(clock, 5000);
let tryIdx = 0;
setInterval(() => {
  if ($('idle').classList.contains('hide')) return;
  tryIdx = (tryIdx + 1) % TRY.length;
  $('tryText').textContent = TRY[tryIdx];
}, 7000);

const listNames = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
async function loadState() {
  try {
    const st = MOCK ? await mock.state() : await (await fetch('/api/state')).json();
    if (!st) return;
    if (st.household?.name) $('idleHouse').textContent = st.household.name;
    if (st.impact) {
      $('savedUsd').textContent = money(st.impact.rescuedUsd);
      $('savedText').textContent = `${st.impact.mealsCooked ?? 0} use-it-up meals this week`;
    }
    if (st.bedrock !== undefined && !lastTurn) setEngine(st.bedrock ? 'bedrock' : 'rules', true);
    setTimers(st.timers);
    let risk = st.atRisk || null;
    if (!risk && !MOCK) {
      try {
        const r = await post('/api/tool', { name: 'pantry_check', arguments: {}, sessionId });
        const d = r?.result?.structuredContent?.data || r?.ui?.toolResult?.structuredContent?.data;
        if (d) {
          const soon = (d.expiringSoon?.length ? d.expiringSoon : (d.items || []).filter((i) => i.expiresInDays != null && i.expiresInDays <= 3));
          risk = { atRiskValueUsd: d.atRiskValueUsd, items: soon.map((i) => i.name) };
        }
      } catch { /* idle teaser is optional */ }
    }
    if (risk) {
      $('riskUsd').textContent = money(risk.atRiskValueUsd);
      const names = (risk.items || []).slice(0, 3).map((n) => String(n).toLowerCase());
      $('riskText').textContent = names.length ? `expires soon: ${listNames(names)}` : 'of food expires in the next 3 days';
    }
  } catch (err) {
    console.warn('state unavailable', err);
  }
}

$('resetBtn').onclick = async () => {
  try {
    if (MOCK) mock.reset();
    else await post('/api/reset', {});
  } catch (err) {
    toast('Reset failed: ' + err.message);
    return;
  }
  ++speakToken;
  try { speechSynthesis.cancel(); } catch { /* no synthesis */ }
  for (const e of entries) e.frame.remove();
  entries = [];
  current = null;
  for (const t of timers.values()) t.el.remove();
  timers.clear();
  chipIndex = 0;
  renderChips();
  $('trList').innerHTML = '<p class="tr-empty">Demo reset. Talk to Alexa to start a new trace.</p>';
  lastTurn = null;
  $('caption').classList.remove('show');
  $('capYou').textContent = '';
  $('capAlexa').textContent = '';
  light('idle');
  showIdle(true);
  loadState();
  toast('Demo household reset');
};

/* ---------- mock mode (?mock=1): sample responses, no server needed ---------- */
const mock = (() => {
  let fx = null;
  let cookPos = 0;
  let active = [];
  const load = async () => (fx ||= await (await fetch('/device/mock/fixtures.json')).json());
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function respond(key, timerOverride) {
    if (key === '@next') key = fx.cookSequence[(cookPos = Math.min(cookPos + 1, fx.cookSequence.length - 1))];
    else if (key === '@back') key = fx.cookSequence[(cookPos = Math.max(cookPos - 1, 0))];
    else if (key === 'cook1') cookPos = 0;
    const r = clone(fx.responses[key] || fx.responses.fallback);
    for (const t of r.timers || []) {
      const seconds = timerOverride?.seconds || t.seconds;
      const label = timerOverride?.label || t.label;
      active.push({ id: `${t.id}_${Date.now()}`, label, seconds, endsAt: new Date(Date.now() + seconds * 1000).toISOString() });
      if (timerOverride) r.toolCalls = [{ name: 'timer_set', arguments: { label, seconds }, ms: 4, ok: true }];
    }
    active = active.filter((t) => Date.parse(t.endsAt) > Date.now() - 1000);
    r.timers = clone(active);
    return new Promise((res) => setTimeout(() => res(r), 300 + Math.random() * 300));
  }
  return {
    async converse(text) {
      await load();
      const route = fx.routes.find((r) => new RegExp(r.match, 'i').test(text));
      return respond(route ? route.key : 'fallback');
    },
    async tool(name, args) {
      await load();
      let key = fx.tools[name] || 'fallback';
      if (key === '@step') key = args?.action === 'back' ? '@back' : '@next';
      return respond(key, name === 'timer_set' ? args : undefined);
    },
    async viewHtml(uri) { return (await fetch('/ui/' + short(uri))).text(); },
    async state() { await load(); return clone(fx.state); },
    reset() { cookPos = 0; active = []; },
  };
})();

loadState();
if (MOCK) toast('Mock mode: sample data, no server calls');
