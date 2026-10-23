// Phone controller: pick a look, join, then drive your fighter with twin sticks (MOVE / AIM).
// Your own movement is predicted locally every frame (zero input lag) and gently corrected by the server.
import { createPhoneCage, syncPhoneScene } from '/play-scene.js';
import * as sfx from '/ui/shared/sound.js';
import { buzz, HAPTIC } from '/ui/shared/haptics.js';
import { createVoice } from '/voice.js';
import { SKINS } from '/ui/character/skins.js';
import { createPreview } from '/ui/character/preview.js';
import { TEAM_COLORS, LASER_COLORS, GEAR } from '/ui/shared/looks.js';

// Terminated (sound + haptics come from play-scene at the exact moment): flash the screen red.
addEventListener('la:terminated', () => {
  $('deadFlash').classList.remove('hidden');
  setTimeout(() => $('deadFlash').classList.add('hidden'), 1200);
});

// Must match src/engine.js
const C = 4.5;
const FIGHTER_R = 0.32;
const SPEED = { lobby: 2.85, action: 5 };
const FIGHTER_COLORS = TEAM_COLORS;
const OUTFITS = GEAR;
const NORMALS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const params = new URLSearchParams(location.search);
// Arriving on the secure copy from the Mic button: carry the player over (storage is per address) and clean the URL.
if (params.get('token')) {
  localStorage.setItem('la-token', params.get('token'));
  if (params.get('room')) localStorage.setItem('la-room', params.get('room').toUpperCase());
  history.replaceState(null, '', `/play?room=${encodeURIComponent(params.get('room') || '')}`);
}
const wantMic = params.get('mic') === '1';

// ------------------------------------------------------------------ state

let ws;
let myId = null;
let state = null;
let server = null; // my authoritative position from the server {x,y,angle}
let pred = null; // my locally predicted position (what I see)
const others = new Map(); // id -> {x,y,angle, tx,ty,ta} smoothed lobby positions
let msLeft = 0;
let clockAt = 0;
let lastPhase = '';
let cage = null;
let move = { x: 0, y: 0 };
let aimAngle = 0;
let domKey = '';

// ------------------------------------------------------------------ join screen

$('room').value = (params.get('room') || localStorage.getItem('la-room') || '').toUpperCase();
$('name').value = localStorage.getItem('la-name') || '';
let pickColor = localStorage.getItem('la-color') || FIGHTER_COLORS[0];
let laserMatch = localStorage.getItem('la-laser-match') !== '0'; // the laser follows the team colour unless you pick one
let pickLaser = laserMatch ? pickColor : localStorage.getItem('la-laser') || pickColor;
let pickOutfit = localStorage.getItem('la-outfit') || 'cap';
if (!GEAR.some(([id]) => id === pickOutfit)) pickOutfit = 'cap'; // older saves had gear that no longer exists

/** Team colour picked: a "match team" laser follows it. */
function setTeamColor(c) {
  pickColor = c;
  localStorage.setItem('la-color', c);
  if (laserMatch) pickLaser = c;
}

/** Laser picker: "Match team" plus every neon shade. */
function paintLasers(el, onPick = () => {}) {
  el.innerHTML = `<button type="button" class="chip match${laserMatch ? ' on' : ''}" data-l="match" style="--c:${pickColor}"><i></i>Match team</button>`
    + LASER_COLORS.map(([c, n]) => `<button type="button" class="swatch${!laserMatch && c === pickLaser ? ' on' : ''}" style="--c:${c}" data-l="${c}" aria-label="${n} laser" title="${n}"></button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    laserMatch = b.dataset.l === 'match';
    pickLaser = laserMatch ? pickColor : b.dataset.l;
    localStorage.setItem('la-laser-match', laserMatch ? '1' : '0');
    localStorage.setItem('la-laser', pickLaser);
    paintLasers(el, onPick);
    onPick();
  };
}
let pickSkin = localStorage.getItem('la-skin') || 'mannequin';

/** Suit picker: a little two-tone badge + name per skin. */
function paintSkins(el, onPick = () => {}) {
  el.innerHTML = SKINS.map((k) => `<button type="button" class="skin${k.id === pickSkin ? ' on' : ''}" data-s="${k.id}">
      <span class="skin-dot" style="--a:${k.swatch[0]};--b:${k.swatch[1]}"></span><span class="skin-name">${k.name}</span></button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.skin');
    if (!b) return;
    pickSkin = b.dataset.s;
    localStorage.setItem('la-skin', pickSkin);
    paintSkins(el, onPick);
    onPick();
  };
}

function paintSwatches(el, colors, selected, onPick, taken = new Set()) {
  el.innerHTML = colors.map((c) => `<button type="button" class="swatch${c === selected ? ' on' : ''}${taken.has(c) ? ' taken' : ''}" style="--c:${c}" data-c="${c}" aria-label="${c}${taken.has(c) ? ' (taken)' : ''}"${taken.has(c) ? ' disabled' : ''}></button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.swatch');
    if (!b || b.disabled) return;
    onPick(b.dataset.c);
    paintSwatches(el, colors, b.dataset.c, onPick, taken);
  };
}
function paintOutfits(el = $('outfitPick'), onPick = () => {}) {
  el.innerHTML = OUTFITS.map(([id, label]) => `<button type="button" class="chip${id === pickOutfit ? ' on' : ''}" data-o="${id}">${label}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    pickOutfit = b.dataset.o;
    localStorage.setItem('la-outfit', pickOutfit);
    paintOutfits(el, onPick);
    onPick();
  };
}

// Lobby "Customise": the same pickers, applied live (the fighter on the TV changes right away).
function sendLook() { send({ t: 'customize', color: pickColor, laserColor: pickLaser, outfit: pickOutfit, skin: pickSkin }); refreshPreview(); }
function openCustomise() {
  const me = state?.players.find((p) => p.id === myId);
  if (me) { pickColor = me.color; pickLaser = me.laserColor; pickOutfit = me.outfit; pickSkin = me.skin || pickSkin; laserMatch = me.laserColor === me.color && laserMatch; }
  paintSkins($('cSkinPick'), sendLook);
  // Team colours are one per fighter: colours other players already wear are crossed out.
  const taken = new Set((state?.players || []).filter((p) => p.id !== myId).map((p) => p.color));
  paintSwatches($('cColorPick'), FIGHTER_COLORS, pickColor, (c) => { setTeamColor(c); paintLasers($('cLaserPick'), sendLook); sendLook(); }, taken);
  paintLasers($('cLaserPick'), sendLook);
  paintOutfits($('cOutfitPick'), sendLook);
  $('customSheet').classList.remove('hidden');
  if (preview) { preview.mount($('customPreview')); refreshPreview(); }
}
$('cCustom').onclick = openCustomise;
$('cCustomDone').onclick = () => $('customSheet').classList.add('hidden');
// Live 3D preview of your fighter (join screen + Customise): changes as you pick.
let preview = null;
try { preview = createPreview(); preview.mount($('joinPreview')); } catch { $('joinPreview').classList.add('hidden'); }
const refreshPreview = () => preview?.setLook({ color: pickColor, outfit: pickOutfit, skin: pickSkin, laserColor: pickLaser, beam: true });
paintSwatches($('colorPick'), FIGHTER_COLORS, pickColor, (c) => { setTeamColor(c); paintLasers($('laserPick'), refreshPreview); refreshPreview(); });
paintLasers($('laserPick'), refreshPreview);
paintOutfits($('outfitPick'), refreshPreview);
paintSkins($('skinPick'), refreshPreview);
refreshPreview();

$('joinBtn').onclick = () => {
  sfx.unlock(); // the Join tap (after scanning the QR) is what turns the phone's sound on
  const name = $('name').value.trim() || 'PLAYER';
  const room = $('room').value.trim().toUpperCase();
  if (room.length !== 4) { $('joinErr').textContent = 'Enter the 4-letter code shown on the TV'; return; }
  $('joinErr').textContent = '';
  localStorage.setItem('la-name', name);
  if (localStorage.getItem('la-room') !== room) localStorage.removeItem('la-token');
  localStorage.setItem('la-room', room);
  send({ t: 'join', room, name, token: localStorage.getItem('la-token'), color: pickColor, laserColor: pickLaser, outfit: pickOutfit, skin: pickSkin });
};
$('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

function showJoin(msg = '') {
  myId = null;
  state = null;
  $('gameView').classList.add('hidden');
  $('joinView').classList.remove('hidden');
  $('joinErr').textContent = msg;
}

// ------------------------------------------------------------------ network

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    const token = localStorage.getItem('la-token');
    if (token) send({ t: 'join', auto: true, room: $('room').value.trim().toUpperCase(), token });
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 800);
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function handle(m) {
  switch (m.t) {
    case 'joined':
      myId = m.id;
      myToken = m.token;
      httpsPort = m.httpsPort;
      localStorage.setItem('la-token', m.token);
      if (wantMic && !voice.micIsOn) setTimeout(toggleMic, 300);
      $('joinView').classList.add('hidden');
      $('gameView').classList.remove('hidden');
      ensureCage();
      break;
    case 'kicked':
      localStorage.removeItem('la-token');
      if (/new room/i.test(m.msg || '')) { $('room').value = ''; localStorage.removeItem('la-room'); }
      others.clear();
      cage?.purgeFighters?.([]);
      showJoin(m.msg || 'The host removed you');
      break;
    case 'error':
      if (!myId) {
        localStorage.removeItem('la-token');
        if (!m.quiet) $('joinErr').textContent = m.msg;
      } else toast(m.msg);
      break;
    case 'notice':
      toast(m.msg, m.ms);
      break;
    case 'rtc':
      voice.handleRtc(m.from, m.data);
      break;
    case 'voice':
      voiceIds = new Set(m.ids);
      domKey = ''; // redraw the roster with mic icons
      renderDom();
      break;
    case 'clock':
      msLeft = m.msLeft; clockAt = performance.now();
      break;
    case 'you': // action phase: my authoritative position
      server = { x: m.x, y: m.y, angle: m.angle };
      msLeft = m.msLeft; clockAt = performance.now();
      break;
    case 'pos': // lobby: everyone's position (20 Hz)
      for (const [id, x, y, a] of m.p) {
        if (id === myId) { server = { x, y, angle: a }; continue; }
        const o = others.get(id);
        if (o) { o.tx = x; o.ty = y; o.ta = a; } else others.set(id, { x, y, angle: a, tx: x, ty: y, ta: a });
      }
      break;
    case 'state':
      onState(m.state, m.me);
      break;
  }
}

function onState(s, me) {
  state = s;
  voice.setPeers(s.players.filter((p) => !p.bot && p.connected).map((p) => p.id));
  msLeft = s.msLeft; clockAt = performance.now();
  if (me) server = { x: me.x, y: me.y, angle: me.angle };

  // Network positions for everyone else (lobby uses them live; other phases use them as the reveal spots).
  for (const p of s.players) {
    if (p.id === myId) continue;
    const o = others.get(p.id);
    if (o) { o.tx = p.x; o.ty = p.y; o.ta = p.angle; } else others.set(p.id, { x: p.x, y: p.y, angle: p.angle, tx: p.x, ty: p.y, ta: p.angle });
  }
  for (const id of others.keys()) if (!s.players.some((p) => p.id === id)) others.delete(id);
  cage?.purgeFighters?.(s.players.map((p) => p.id));

  if (s.phase !== lastPhase) {
    const mine = s.players.find((p) => p.id === myId);
    if (s.phase === 'action' || s.phase === 'lobby') {
      // Fresh start each phase: snap to the server and face the way the server says.
      pred = server ? { ...server } : mine ? { x: mine.x, y: mine.y, angle: mine.angle } : null;
      if (pred) aimAngle = pred.angle;
      move = { x: 0, y: 0 };
    }
    if (s.phase === 'action') {
      // Panic bed (drone + speeding heartbeat + riser) under the secret phase; alarm buzz if a layer is doomed.
      const doomed = s.nextApothem < s.apothem;
      buzz(HAPTIC.roundStart);
      sfx.roundStart();
      sfx.tension(s.msLeft / 1000, doomed);
      if (doomed) setTimeout(() => buzz(HAPTIC.alarm), 300);
      lastTickSec = 0;
    } else sfx.stopTension();
    if (s.phase === 'reveal') { sfx.tick(true); sfx.reveal(); buzz(HAPTIC.finalTick); }
    if (s.phase === 'over' && s.winner) setTimeout(() => { sfx.win(); if (s.winner === myId) buzz(HAPTIC.win); }, 900);
    if (s.phase === 'lobby' && lastPhase && lastPhase !== 'lobby') toast('Back in the lobby');
    lastPhase = s.phase;
  }
  renderDom();
}

let lastTickSec = 0; // countdown beep already played for this second
const vibrate = (p) => { try { navigator.vibrate?.(p); } catch {} };
const mine = () => state?.players.find((p) => p.id === myId);
const isHost = () => !!state && state.hostId === myId;

// ------------------------------------------------------------------ DOM (only rebuilt when something visible changed)

function renderDom() {
  const s = state;
  const p = mine();
  if (!s || !p) return;
  const host = isHost();
  const key = JSON.stringify([s.phase, s.hostId, s.winner, s.round, host,
    s.players.map((q) => [q.id, q.name, q.color, q.bot, q.alive, q.connected, q.wins, q.points, voiceIds.has(q.id)])]);
  if (key === domKey) return;
  domKey = key;

  $('dot').style.setProperty('--c', p.color);
  $('myPts').textContent = `${p.points || 0} pts`;
  $('me').textContent = p.name;
  $('hostTag').classList.toggle('hidden', !host);
  const lobby = s.phase === 'lobby';
  const over = s.phase === 'over';
  $('phasePill').textContent = { lobby: 'Lobby', action: `Round ${s.round}`, reveal: 'Reveal', over: 'Match over' }[s.phase];
  $('clock').classList.add('hidden'); // no timer on screen: the countdown is heard, not shown
  $('phasePill').classList.toggle('hidden', s.phase === 'action');

  // Status line
  let status = '';
  let cls = '';
  if (lobby) status = host ? 'You are the host — walk around, then start' : 'Walk around while you wait';
  else if (!p.alive) { status = `Terminated — ${deathText(p)}`; cls = 'bad'; }
  else if (s.phase === 'action') status = s.nextApothem < s.apothem ? 'Move & aim — get off the red edge!' : 'Move & aim — only you can see yourself';
  else if (s.phase === 'reveal') status = 'Reveal! Watch the TV';
  if (over) {
    const w = s.players.find((q) => q.id === s.winner);
    status = w ? (w.id === myId ? 'You win!' : `${w.name} wins the match`) : 'Draw — nobody survived';
    cls = w?.id === myId ? 'win' : '';
  }
  const st = $('status');
  st.textContent = status;
  st.className = `status glass ${cls}`;

  // Lobby sheet: roster (+ remove buttons for the host) and host actions
  $('lobbySheet').classList.toggle('hidden', !lobby);
  if (!lobby) $('customSheet').classList.add('hidden');
  if (lobby) {
    $('lobbyCount').textContent = `${s.players.length} / 8`;
    $('lobbyList').innerHTML = s.players.map((q) => {
      const tags = [
        q.id === s.hostId ? '<span class="tag host">Host</span>' : '',
        q.bot ? '<span class="tag bot">Bot</span>' : '',
        !q.bot && !q.connected ? '<span class="tag off">Offline</span>' : '',
        q.id === myId ? '<span class="tag">You</span>' : '',
        voiceIds.has(q.id) ? '<span class="tag mic" title="Mic on">MIC</span>' : '',
      ].join('');
      const canKick = host && q.id !== myId;
      return `<div class="roster-row${q.id === myId ? ' me' : ''}${!q.bot && !q.connected ? ' off' : ''}">
        <span class="dot" style="--c:${q.color}"></span><span class="name">${esc(q.name)}</span>${tags}
        ${canKick ? `<button class="kick" data-kick="${q.id}" aria-label="Remove ${esc(q.name)}">×</button>` : ''}
      </div>`;
    }).join('');
    $('hostActions').classList.toggle('hidden', !host);
    $('cAddBot').disabled = s.players.length >= 8;
    $('cStart').disabled = s.players.length < 2;
    $('cStart').textContent = s.players.length < 2 ? 'Need 2 fighters' : 'Start match';
    $('waitHost').classList.toggle('hidden', host);
    $('waitHost').innerHTML = (s.hostName ? `Waiting for <b>${esc(s.hostName)}</b> to start` : 'Waiting for a host…');
  }

  // Result card
  $('resultCard').classList.toggle('hidden', !over);
  if (over) {
    const w = s.players.find((q) => q.id === s.winner);
    $('resultK').textContent = w ? 'CHAMPION' : 'RESULT';
    $('resultWinner').textContent = w ? w.name : 'DRAW';
    $('resultWinner').style.color = w ? w.color : '#ffa020';
    // Scores: +5 per laser hit, +1 per round survived.
    $('resultScores').innerHTML = [...s.players].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 4)
      .map((q) => `<div class="${q.id === myId ? 'me-row' : ''}"><span class="dot" style="--c:${q.color}"></span>${esc(q.name)}<b>${q.points || 0} pts</b></div>`).join('');
    $('resultActions').classList.toggle('hidden', !host);
    $('resultWait').classList.toggle('hidden', host);
    $('resultWait').innerHTML = s.hostName ? `<b>${esc(s.hostName)}</b> picks rematch or lobby` : '';
  }

  // Sticks: usable in lobby and action while alive
  // Leave / End match (action + reveal only). Leaving needs you still in the fight; ending is for the host.
  const inMatch = s.phase === 'action' || s.phase === 'reveal';
  $('matchActions').classList.toggle('hidden', !inMatch);
  $('cLeave').classList.toggle('hidden', !p.alive);
  $('cEnd').classList.toggle('hidden', !host);

  const drive = p.alive && (lobby || s.phase === 'action');
  $('sticksWrap').classList.toggle('hidden', over || (!p.alive && !lobby));
  $('controls').classList.toggle('off', !drive);
  requestAnimationFrame(() => cage?.resize());
}

function deathText(p) {
  const by = (p.death?.by || []).map((id) => state.players.find((q) => q.id === id)?.name).filter(Boolean).join(' & ');
  return { laser: `hit by ${by}`, clash: `clashed with ${by}`, out: 'left outside the cage', left: 'left the match' }[p.death?.cause] || 'out';
}

$('lobbyList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kick]');
  if (!b) return;
  const id = b.dataset.kick;
  const who = state?.players.find((q) => q.id === id);
  if (!who) return;
  if (!who.bot && !confirm(`Remove ${who.name} from the lobby?`)) return;
  send({ t: 'kick', id });
});
$('cAddBot').onclick = () => send({ t: 'addBot' });
$('cStart').onclick = () => send({ t: 'start' });
$('cLeave').onclick = () => {
  if (!confirm('Leave this match? You will be out and can watch until it ends.')) return;
  send({ t: 'leaveMatch' });
};
$('cEnd').onclick = () => {
  if (!confirm('End the match for everyone and go back to the lobby?')) return;
  send({ t: 'endMatch' });
};
$('cRematch').onclick = () => send({ t: 'rematch' });
$('cLobby').onclick = () => send({ t: 'lobby' });

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ------------------------------------------------------------------ sticks

function makeStick(el, onChange) {
  const s = { el, x: 0, y: 0, active: false, id: null, cx: 0, cy: 0, R: 1 };
  const update = (e) => {
    let x = (e.clientX - s.cx) / (s.R * 0.78);
    let y = (e.clientY - s.cy) / (s.R * 0.78);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    s.x = x; s.y = y;
    onChange(s);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect(); // measure once per touch, not on every move
    s.cx = r.left + r.width / 2; s.cy = r.top + r.height / 2; s.R = r.width / 2;
    el.setPointerCapture(e.pointerId);
    s.active = true; s.id = e.pointerId;
    update(e);
  });
  el.addEventListener('pointermove', (e) => { if (s.active && e.pointerId === s.id) update(e); });
  const end = (e) => { if (e.pointerId !== s.id) return; s.active = false; s.x = 0; s.y = 0; onChange(s); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  return s;
}

const DEAD = 0.12;
const moveStick = makeStick($('moveStick'), (s) => {
  const m = Math.hypot(s.x, s.y);
  move = m < DEAD ? { x: 0, y: 0 } : { x: s.x, y: s.y };
  sendInput();
});
const aimStick = makeStick($('aimStick'), (s) => {
  if (Math.hypot(s.x, s.y) > 0.3) aimAngle = ((Math.atan2(s.y, s.x) * 180) / Math.PI + 360) % 360;
  sendInput();
});

// Input: sent when it changes (throttled to 30/s) plus a 10/s heartbeat so a dropped packet can't leave you running.
let lastSent = '';
let lastSentAt = 0;
let pendingSend = null;
function sendInput(force = false) {
  const ph = state?.phase;
  if (!(ph === 'lobby' || ph === 'action') || !mine()?.alive) return;
  const msg = { t: 'input', mx: +move.x.toFixed(2), my: +move.y.toFixed(2), aim: Math.round(aimAngle) };
  const key = `${msg.mx},${msg.my},${msg.aim}`;
  if (key === lastSent && !force) return;
  const now = performance.now();
  const wait = 33 - (now - lastSentAt);
  if (wait > 0 && !force) {
    if (!pendingSend) pendingSend = setTimeout(() => { pendingSend = null; sendInput(); }, wait);
    return;
  }
  lastSent = key;
  lastSentAt = now;
  send(msg);
}
setInterval(() => sendInput(true), 100);

// Desktop testing: WASD move, arrow keys aim.
const keys = new Set();
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') { keys.add(e.key.toLowerCase()); keyInput(); } });
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); keyInput(); });
function keyInput() {
  if (moveStick.active) return;
  const mx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const my = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const m = Math.hypot(mx, my) || 1;
  move = { x: mx / m, y: my / m };
  const ax = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
  const ay = (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
  if (ax || ay) aimAngle = ((Math.atan2(ay, ax) * 180) / Math.PI + 360) % 360;
  sendInput();
}

// ------------------------------------------------------------------ prediction

function clampToCage(x, y, apothem) {
  for (let i = 0; i < 3; i++) {
    for (const [nx, ny] of NORMALS) {
      const d = (x - C) * nx + (y - C) * ny - (apothem - FIGHTER_R);
      if (d > 0) { x -= nx * d; y -= ny * d; }
    }
  }
  return [x, y];
}

function stepPrediction(dt) {
  const ph = state?.phase;
  const p = mine();
  if (!p || !p.alive || !(ph === 'lobby' || ph === 'action')) { pred = null; return; }
  if (!pred) pred = server ? { ...server } : { x: p.x, y: p.y, angle: p.angle };
  const sp = SPEED[ph];
  [pred.x, pred.y] = clampToCage(pred.x + move.x * sp * dt, pred.y + move.y * sp * dt, state.apothem);
  pred.angle = aimAngle;
  // Server correction: the server is ~1 round-trip behind us, so only nudge, and only when we're really off.
  if (server) {
    const ex = server.x - pred.x;
    const ey = server.y - pred.y;
    const err = Math.hypot(ex, ey);
    const moving = move.x || move.y;
    if (err > 1.2) { pred.x = server.x; pred.y = server.y; }
    else if (!moving) { const k = Math.min(1, dt * 6); pred.x += ex * k; pred.y += ey * k; }
    else if (err > 0.35) { const k = Math.min(1, dt * 2); pred.x += ex * k; pred.y += ey * k; }
  }
}

function smoothOthers(dt) {
  const k = 1 - Math.exp(-dt * 14);
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
    let da = ((o.ta - o.angle + 540) % 360) - 180;
    o.angle += da * k;
  }
}

// ------------------------------------------------------------------ render loop

function ensureCage() {
  if (cage) return;
  try {
    cage = createPhoneCage($('board3d'));
    requestAnimationFrame(() => cage.resize());
    addEventListener('orientationchange', () => setTimeout(() => cage?.resize(), 250));
  } catch (e) {
    console.error(e);
    toast('3D view failed to start — try refreshing');
  }
}

function drawStick(s, color, aimMode) {
  const canvas = s.el.querySelector('canvas');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  if (w < 20) return; // sticks hidden (e.g. match over): nothing to draw
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = canvas.height = Math.round(w * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, w);
  const c = w / 2;
  const R = c - 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c, c, R * 0.55, 0, Math.PI * 2); ctx.stroke();
  let kx = s.x; let ky = s.y;
  if (aimMode && !s.active) { const a = (aimAngle * Math.PI) / 180; kx = Math.cos(a) * 0.78; ky = Math.sin(a) * 0.78; }
  if (aimMode) {
    const a = Math.atan2(ky, kx);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(c, c, R - 2, a - 0.35, a + 0.35); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const kr = R * 0.34;
  const g = ctx.createRadialGradient(c + kx * R * 0.78, c + ky * R * 0.78, 2, c + kx * R * 0.78, c + ky * R * 0.78, kr);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = g;
  ctx.globalAlpha = s.active ? 1 : 0.75;
  ctx.beginPath(); ctx.arc(c + kx * R * 0.78, c + ky * R * 0.78, kr, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

let last = performance.now();
let stickKey = '';
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state || $('gameView').classList.contains('hidden')) return;

  stepPrediction(dt);
  smoothOthers(dt);
  if (cage) {
    if (cage.needsResize()) cage.resize();
    syncPhoneScene(cage, state, myId, pred, others, now);
    cage.render(dt, now / 1000);
  }

  if (state.phase === 'action') {
    // Countdown beeps (and a short buzz) for the last 3 seconds.
    const sec = Math.ceil(Math.max(0, msLeft - (now - clockAt)) / 1000);
    if (sec >= 1 && sec <= 3 && sec !== lastTickSec) { lastTickSec = sec; sfx.tick(); buzz(HAPTIC.heartbeat); }
  }

  const p = mine();
  const color = p?.laserColor || p?.color || '#d4ff28';
  const key = `${moveStick.x.toFixed(2)}|${moveStick.y.toFixed(2)}|${moveStick.active}|${aimStick.active}|${Math.round(aimAngle)}|${color}`;
  if (key !== stickKey) {
    stickKey = key;
    drawStick(moveStick, '#c9d3df', false);
    drawStick(aimStick, color, true);
  }
}

// Block pinch-zoom / scroll gestures during play (iOS ignores user-scalable=no).
document.addEventListener('gesturestart', (e) => e.preventDefault());
$('gameView').addEventListener('touchmove', (e) => { if (!e.target.closest('.sheet-list')) e.preventDefault(); }, { passive: false });

// ------------------------------------------------------------------ sound
// Sound needs a tap first (browser rule): the Join button or any touch turns it on. The chip in the top bar shows
// whether sound is on, and tapping it turns sound on / off (a chirp + buzz confirms it works).
function soundChip() {
  const on = sfx.isUnlocked() && !sfx.isMuted();
  $('soundChipLabel').textContent = on ? 'On' : 'Off';
  $('soundChip').classList.toggle('off', !on);
}
let soundChipReady = false; // false until the chip has shown sound as on once
sfx.unlockOnFirstGesture(() => { soundChip(); setTimeout(() => { soundChipReady = true; }, 400); });
sfx.tryAutoStart(soundChip); // phones that rejoin automatically get sound without a tap when the browser allows
setInterval(soundChip, 1000); // reflects iOS interrupting audio (lock screen, calls)
$('soundChip').onclick = (e) => {
  e.stopPropagation();
  // Sound not started yet: this tap is the one that turns it on (never mute on it).
  if (!sfx.isUnlocked() || !soundChipReady) { soundChipReady = true; sfx.unlock(); sfx.setMuted(false); setTimeout(() => { buzz(HAPTIC.tick); soundChip(); }, 150); return; }
  sfx.setMuted(!sfx.isMuted());
  if (!sfx.isMuted()) buzz(HAPTIC.tick);
  soundChip();
};


// ------------------------------------------------------------------ voice chat
// Everyone hears everyone (even with their own mic off). The Mic button turns your microphone on/off. Microphones
// only work on secure pages, so on the plain-http link the first tap moves you to the https copy of the game (same
// room, same fighter) and turns the mic on there.
let myToken = null;
let httpsPort = null;
let voiceIds = new Set();
const voice = createVoice({ send, myId: () => myId });
function micUi() {
  const on = voice.micIsOn;
  $('micBtn').textContent = on ? 'Mic on' : 'Mic';
  $('micBtn').classList.toggle('on', on);
}
async function toggleMic() {
  voice.resumePlayback();
  if (voice.micIsOn) { voice.micOff(); micUi(); return; }
  const r = await voice.micOn();
  if (r === 'insecure') {
    if (httpsPort && myToken) {
      toast('Opening the secure link for the mic — if the phone warns you, tap Advanced → Proceed', 4000);
      setTimeout(() => {
        const room = encodeURIComponent(state?.room || localStorage.getItem('la-room') || $('room').value || '');
        location.href = `https://${location.hostname}:${httpsPort}/play?room=${room}&token=${encodeURIComponent(myToken)}&mic=1`;
      }, 1200);
    } else toast('Voice chat needs a secure (https) link on this network');
    return;
  }
  if (r === 'denied') toast('Microphone blocked — allow it in the browser settings for this page');
  else buzz(HAPTIC.tick);
  micUi();
}
$('micBtn').onclick = (e) => { e.stopPropagation(); toggleMic(); };
addEventListener('pointerdown', () => voice.resumePlayback(), { capture: true, once: true });

connect();
requestAnimationFrame(frame);

