// TV / browser display. Opens on the game menu; shows the room QR, everyone walking around in the lobby, an empty
// cage during the secret MOVE & AIM phase (except the TV's own player, if someone plays on the TV), and the reveal.
import { CageScene } from '/ui/scene.js';
import { setFighterDead } from '/ui/character/mannequin.js';
import { revealStage, applyBand, bodyDrop } from '/ui/shared/reveal.js';
import * as sfx from '/ui/shared/sound.js';
import { createMenu } from '/tv-menu.js';
import { createTvPlayer } from '/tv-player.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let scene = null;
try {
  scene = new CageScene($('stage'), 4.5);
  scene.setShowcase(true);
} catch (e) {
  console.error('Arena failed to start:', e);
  $('nogl').classList.remove('hidden');
  $('nogl').textContent = 'This screen needs WebGL. Try Chrome, Edge, Firefox or the Fire TV Silk browser.';
}

let state = null;
let msLeft = 0;
let clockAt = performance.now();
let revealStart = 0;
let lasersShown = true; // lasers wait until the falling layer has dropped
let shownRound = 0;
let lastPhase = '';
let domKey = '';
let voiceIds = new Set(); // players with their mic on
const live = new Map(); // id -> {x,y,angle,tx,ty,ta}: smoothed lobby positions
let ws;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'display', room: sessionStorage.getItem('room') }));
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 1200);
}

function track(id, x, y, a) {
  const o = live.get(id);
  if (o) { o.tx = x; o.ty = y; o.ta = a; } else live.set(id, { x, y, angle: a, tx: x, ty: y, ta: a });
}

function handle(m) {
  if (m.t === 'room') {
    roomCode = m.code;
    tv.resume(); // the TV player re-joins after a page reload
    sessionStorage.setItem('room', m.code);
    $('code').textContent = m.code;
    $('url').textContent = m.url.replace(/^https?:\/\//, '');
    $('qr').innerHTML = m.qr;
  } else if (m.t === 'pos') {
    for (const [id, x, y, a] of m.p) track(id, x, y, a);
  } else if (m.t === 'error') {
    showNotice(m.msg, 3500);
  } else if (m.t === 'pong') {
    latency = Math.round(performance.now() - m.at);
  } else if (m.t === 'stale') {
    $('staleBar').classList.remove('hidden');
  } else if (m.t === 'notice') {
    showNotice(m.msg, m.ms || 3000);
  } else if (m.t === 'clock') {
    msLeft = m.msLeft; clockAt = performance.now();
  } else if (m.t === 'voice') {
    voiceIds = new Set(m.ids);
    domKey = '';
    if (state) renderDom();
  } else if (m.t === 'state') {
    onState(m.state);
  }
}

function onState(s) {
  const entering = s.phase !== lastPhase;
  state = s;
  msLeft = s.msLeft; clockAt = performance.now();
  for (const p of s.players) track(p.id, p.x, p.y, p.angle);
  for (const id of live.keys()) if (!s.players.some((p) => p.id === id)) live.delete(id);
  scene?.purgeFighters(s.players.map((p) => p.id));

  if (s.phase === 'reveal' && s.reveal && s.reveal.round !== shownRound) {
    shownRound = s.reveal.round;
    revealStart = performance.now();
    scene?.clearLasers();
    lasersShown = false;
  }
  // Sound cues for phase changes and new players.
  if (entering && s.phase === 'action') {
    // Panic bed under the secret phase.
    const doomed = s.nextApothem < s.apothem;
    sfx.roundStart();
    sfx.tension(s.msLeft / 1000, doomed);
    lastTickSec = 0;
  }
  if (entering && s.phase !== 'action') sfx.stopTension();
  if (entering && s.phase === 'reveal') { sfx.tick(true); sfx.reveal(); }
  if (entering && s.phase === 'over' && s.winner) setTimeout(sfx.win, 900);
  if (s.phase === 'lobby' && s.players.length > lobbyCount) sfx.join();
  lobbyCount = s.phase === 'lobby' ? s.players.length : 0;
  if (entering) {
    if (s.phase === 'lobby' || s.phase === 'action') { scene?.clearLasers(); shownRound = 0; }
    if (s.phase === 'lobby' && scene) {
      scene.targetApothem = scene.shownApothem = s.apothem;
      scene.doomActive = false;
    }
    // Every new round (and the lobby) starts with everyone alive standing up: clears the fallen pose, the grey
    // body and the death timer — also for fighters brought back by sudden death.
    if ((s.phase === 'lobby' || s.phase === 'action') && scene) {
      for (const p of s.players) {
        const f = scene.fighters.get(p.id);
        if (!f || !p.alive) continue;
        f.deadAt = 0;
        f.aimer.rotation.z = 0;
        f.group.scale.setScalar(1);
        setFighterDead(f, false);
      }
    }
    // Snap (no slide) when a phase starts: positions jump between lobby / spawn / reveal spots.
    for (const p of s.players) { const o = live.get(p.id); o.x = o.tx; o.y = o.ty; o.angle = o.ta; }
    lastPhase = s.phase;
  }
  scene?.setShowcase(s.phase === 'lobby' && s.players.length === 0);
  renderDom();
}

function renderDom() {
  const s = state;
  const key = JSON.stringify([s.phase, s.round, s.hostId, s.winner, s.log, s.players.map((p) => [p.id, p.name, p.color, p.bot, p.alive, p.connected, p.wins, p.points, voiceIds.has(p.id)])]);
  if (key === domKey) return;
  domKey = key;

  const lobby = s.phase === 'lobby';
  document.body.classList.toggle('at-lobby', lobby);
  document.body.classList.toggle('show-over', s.phase === 'over');
  $('over').setAttribute('aria-hidden', s.phase === 'over' ? 'false' : 'true');

  const alive = s.players.filter((p) => p.alive).length;
  $('roundK').textContent = lobby ? 'Lobby' : s.phase === 'over' ? 'Match over' : `Round ${s.round}`;
  $('round').textContent = lobby ? (s.players.length ? `${s.players.length} ready` : 'Join now') : `${alive} left`;

  // Lobby panel
  $('lobbyCount').textContent = `${s.players.length} / 8`;
  $('lobbyRoster').innerHTML = s.players.length
    ? s.players.map((p) => `<div class="roster-row${!p.bot && !p.connected ? ' off' : ''}">
        <span class="dot" style="--c:${p.color}"></span><span class="name">${esc(p.name)}</span>
        ${p.id === s.hostId ? '<span class="tag host">Host</span>' : ''}${p.bot ? '<span class="tag bot">Bot</span>' : ''}${!p.bot && !p.connected ? '<span class="tag off">Offline</span>' : ''}${voiceIds.has(p.id) ? '<span class="tag mic">Mic</span>' : ''}
      </div>`).join('')
    : '<div class="empty">Scan the code with your phone to join. The first player to join is the host.</div>';
  $('lobbyHint').innerHTML = !s.hostName
    ? 'Waiting for the first player…'
    : s.players.length < 2
      ? `<b>${esc(s.hostName)}</b> can add bots from their phone, or wait for friends`
      : `<b>${esc(s.hostName)}</b> is the host — start from their phone or with <b>Start match</b> here`;
  // During a match: End match (everyone back to the lobby) and, for the player on this screen, Leave match.
  const inMatch = s.phase === 'action' || s.phase === 'reveal';
  $('tvEndMatch').classList.toggle('hidden', !inMatch);
  $('tvLeaveMatch').classList.toggle('hidden', !(inMatch && tv.id && s.players.find((p) => p.id === tv.id)?.alive));
  // Lobby buttons on the TV: start (needs 2 fighters), add a bot, join on this screen (laptop / TV player).
  $('tvStart').disabled = s.players.length < 2;
  $('tvStart').textContent = s.players.length < 2 ? 'Need 2 fighters' : 'Start match';
  $('tvAddBot').disabled = s.players.length >= 8;
  $('tvJoinHere').textContent = tv.id ? 'Leave this screen' : 'Join on this screen';

  // In-match roster (bottom-left)
  $('roster').innerHTML = lobby ? '' : s.players.map((p) => `<div class="roster-row${p.alive ? '' : ' dead'}" style="--c:${p.color}">
      <span class="name">${esc(p.name)}</span><span class="tag pts">${p.points || 0} pts</span>${voiceIds.has(p.id) ? '<span class="tag mic">Mic</span>' : ''}${p.wins ? `<span class="tag">${p.wins} ★</span>` : ''}${p.bot ? '<span class="tag bot">Bot</span>' : ''}
    </div>`).join('');

  $('log').innerHTML = lobby ? '' : s.log.slice(-4).map((l) => `<li class="glass">${esc(l)}</li>`).join('');

  if (s.phase === 'over') {
    const w = s.players.find((p) => p.id === s.winner);
    $('overK').textContent = w ? 'CHAMPION' : 'RESULT';
    $('winner').textContent = w ? w.name : 'DRAW';
    $('winner').style.color = w ? w.color : '#ffa020';
    // Scores this match: +5 per laser hit, +1 per round survived.
    const ranked = [...s.players].sort((a, b) => (b.points || 0) - (a.points || 0) || b.wins - a.wins);
    $('standings').innerHTML = ranked.slice(0, 5).map((p) => `<div class="roster-row"><span class="dot" style="--c:${p.color}"></span><span class="name">${esc(p.name)}</span><span class="wins">${p.points || 0} pts · ${p.wins} ★</span></div>`).join('');
    $('overNext').textContent = 'Choose here with the mouse or TV remote, or from the host phone';
    setTimeout(() => { if (document.body.classList.contains('show-over')) $('tvRematch').focus(); }, 400);
  }
}

function revealBanner(s, e) {
  const banner = $('banner');
  const deaths = s.reveal?.deaths || [];
  const fall = (s.reveal?.fallMs || 0) / 1000;
  const show = s.phase === 'reveal' && e > fall + 0.55 && e < fall + 3.8;
  if (!show) { if (!banner.classList.contains('hidden')) banner.classList.add('hidden'); return; }
  if (!banner.classList.contains('hidden')) return;
  banner.classList.remove('hidden');
  banner.classList.toggle('clear', deaths.length === 0);
  if (deaths.length) {
    $('bannerTitle').textContent = 'TERMINATED';
    $('bannerSub').textContent = deaths.map((d) => {
      const n = s.players.find((p) => p.id === d.id)?.name || '?';
      return d.cause === 'out' ? `${n} · out of the cage` : d.cause === 'clash' ? `${n} · clash` : d.cause === 'left' ? `${n} · left` : n;
    }).join('   ');
  } else {
    $('bannerTitle').textContent = 'ALL CLEAR';
    $('bannerSub').textContent = 'Every laser missed';
  }
}

let lastTickSec = 0; // countdown beep already played for this second
let lobbyCount = 0;
let mrClearedFor = 0; // the reveal (by start time) whose lasers were cleared at the drop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  fpsFrames++;
  tv.update(dt);
  last = now;
  if (!scene) return;
  const s = state;
  if (!s) { scene.render(dt, now / 1000); return; }

  // Smooth lobby movement between 20 Hz network updates.
  const k = 1 - Math.exp(-dt * 14);
  for (const o of live.values()) {
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
    o.angle += (((o.ta - o.angle + 540) % 360) - 180) * k;
  }


  const lobby = s.phase === 'lobby';
  const action = s.phase === 'action';
  const e = (now - revealStart) / 1000;
  const revealing = s.phase === 'reveal';
  // Reveal order: (1) the doomed layer drops, taking anyone on it; (2) survivors appear; (3) lasers fire.
  const fall = revealing ? (s.reveal?.fallMs || 0) / 1000 : 0;
  const falling = revealing && e < fall;
  const deaths = new Set((s.reveal?.deaths || []).map((d) => d.id));
  const fellOff = new Set((s.reveal?.deaths || []).filter((d) => d.cause === 'out').map((d) => d.id));
  const deckY = scene.ringCenter?.position.y ?? 0;
  const mv = revealStage(s, e); // shots first, then the marked layer drops
  if (mv?.dropped && mrClearedFor !== revealStart) {
    mrClearedFor = revealStart;
    if (mv.drop !== null && s.phase === 'reveal') scene.clearLasers();
  }
  if (revealing && !lasersShown && e >= fall) {
    lasersShown = true;
    s.reveal.shots.forEach((shot, i) => {
      const p = s.players.find((q) => q.id === shot.from);
      scene.addLaser(shot, p?.laserColor || p?.color);
      const n = Math.min(8, s.reveal.shots.length);
      if (i < 8) sfx.laser((shot.x1 - scene.C) / scene.C, i * 0.035, 0.85 / Math.sqrt(n)); // panned to the shooter
    });
  }

  predictTv(s, dt, lobby, action);

  for (const p of s.players) {
    const f = scene.fighter(p);
    if (f.ring) f.ring.visible = false;
    // Secret phase: the TV shows an empty cage — except the TV's own player (someone playing on this screen).
    if (action) {
      const mine = p.id === tv.id && p.alive && tvPred;
      f.group.visible = f.label.visible = !!mine;
      if (mine) {
        const [mx, mz] = scene.w(tvPred.x, tvPred.y);
        f.group.position.set(mx, scene.ringCenter.position.y, mz);
        f.aimer.rotation.y = (-tvPred.angle * Math.PI) / 180;
      }
      continue;
    }
    const diedEarlier = !lobby && p.death && (!s.reveal || p.death.round !== s.reveal.round);
    if (diedEarlier) { f.group.visible = false; continue; }
    const o = (lobby && p.id === tv.id && tvPred) || live.get(p.id) || p;
    const [x, z] = scene.w(o.x, o.y);
    f.aimer.rotation.y = (-o.angle * Math.PI) / 180;
    if (!lobby && fellOff.has(p.id) && mv) { // stands (and fires) until the layer drops, then falls with it
      const fe = mv.dropped ? mv.sinceDrop : 0;
      f.group.visible = f.label.visible = !mv.dropped || (revealing && fe < 1.2);
      f.group.position.set(x, deckY - 4.5 * fe * fe, z);
      f.group.scale.setScalar(1);
      f.aimer.rotation.z = Math.min(1.2, fe * 1.5);
      if (!mv.dropped) { f.aimer.rotation.z = 0; setFighterDead(f, false); }
      continue;
    }
    if (!lobby && fellOff.has(p.id)) {
      // Caught on the dropping layer: falls with it, then is gone.
      f.group.visible = revealing && e < fall + 0.2;
      f.label.visible = f.group.visible;
      f.group.position.set(x, deckY - 4.5 * e * e, z);
      f.group.scale.setScalar(1);
      f.aimer.rotation.z = Math.min(1.2, e * 1.5);
      continue;
    }
    if (falling) { f.group.visible = false; continue; }
    f.group.visible = true;
    f.label.visible = true;
    f.group.position.set(x, deckY, z);
    const pop = revealing ? Math.min(1, (e - fall) / 0.25) : 1;
    f.group.scale.setScalar(0.7 + 0.3 * pop);
    if (!lobby && deaths.has(p.id) && (e > fall + 0.45 || s.phase === 'over')) {
      if (!f.deadAt) { f.deadAt = now; if (s.phase === 'reveal') { scene.burst(x, z, p.color); } }
      f.aimer.rotation.z = (Math.min(1, (now - f.deadAt) / 450) * Math.PI) / 2.2;
      setFighterDead(f, true);
      const dy = bodyDrop(mv, s, o, scene.C); // shot on the layer that then dropped: falls with it
      f.group.position.y = deckY + dy;
      if (dy < -6) f.group.visible = f.label.visible = false;
    } else {
      f.deadAt = 0;
      f.aimer.rotation.z = 0;
      setFighterDead(f, false);
    }
  }

  // Cage: the doomed layer drops the moment the reveal starts (before anyone is shown).
  scene.targetApothem = mv ? mv.apothem : s.apothem;
  scene.doomActive = action && s.nextApothem < s.apothem;
  const doomKey = `${s.apothem}/${s.nextApothem}`;
  if (scene.doomActive && scene.doomBandFor !== doomKey) { scene.doomBandFor = doomKey; scene.setDoomBand(s.apothem, s.nextApothem); }
  if (!lobby) applyBand(scene, action ? (s.nextApothem < s.apothem ? [s.apothem, s.nextApothem] : null) : mv?.band);

  // HUD clock
  const box = $('clockBox');
  box.classList.toggle('hidden', !(action || s.phase === 'reveal'));
  if (action) {
    // No countdown on screen: the last 3 seconds are beeps instead.
    const left = Math.max(0, msLeft - (now - clockAt));
    const sec = Math.ceil(left / 1000);
    if (sec >= 1 && sec <= 3 && sec !== lastTickSec) { lastTickSec = sec; sfx.tick(); }
    if ($('timer').textContent !== 'MOVE & AIM') $('timer').textContent = 'MOVE & AIM';
    const where = tv.id ? 'on your phone or this TV' : 'on your phone';
    const label = s.nextApothem < s.apothem ? 'Move & aim · the red layer drops after the shots' : `Move & aim ${where}`;
    if ($('phaseLabel').textContent !== label) $('phaseLabel').textContent = label;
  } else if (s.phase === 'reveal') {
    const label = mv ? (mv.dropped && mv.drop !== null ? 'The layer drops!' : 'Lasers fire') : falling ? 'The edge falls!' : 'Lasers fire';
    if ($('timer').textContent !== 'REVEAL') { $('timer').textContent = 'REVEAL'; $('timer').classList.remove('hot'); }
    if ($('phaseLabel').textContent !== label) $('phaseLabel').textContent = label;
  }
  revealBanner(s, e);

  // The TV player's aim sight (lobby + secret phase), like on a phone.
  const tvP = tv.id && s.players.find((p) => p.id === tv.id);
  if (tvP && tvP.alive && tvPred && (lobby || action)) {
    scene.setSightLaser(tvPred.x, tvPred.y, tvPred.angle, tvP.laserColor || tvP.color, s.apothem);
  } else if (!(lobby && s.players.length === 0)) scene.hideSightLaser();

  if (scene.needsResize()) scene.resize();
  scene.render(dt, now / 1000);
}

const sendTv = (t) => ws?.readyState === 1 && ws.send(JSON.stringify({ t }));

let noticeTimer;
function showNotice(msg, ms) {
  const el = $('tvNotice');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.classList.add('hidden'), ms + 600);
}

$('tvNewRoom').onclick = () => {
  const n = state?.players.filter((p) => !p.bot).length || 0;
  if (n && !confirm(`Start a new room? The ${n} player${n === 1 ? '' : 's'} here will need to scan the new code.`)) return;
  sessionStorage.removeItem('room');
  sendTv('newRoom');
};
$('tvRematch').onclick = () => sendTv('rematch');
$('tvStart').onclick = () => sendTv('start');
$('tvEndMatch').onclick = (e) => {
  e.stopPropagation();
  if (!confirm('End the match for everyone and go back to the lobby?')) return;
  sendTv('endMatch');
};
$('tvLeaveMatch').onclick = (e) => {
  e.stopPropagation();
  if (!confirm('Leave this match? You will be out and can watch until it ends.')) return;
  tv.send({ t: 'leaveMatch' });
};
$('tvAddBot').onclick = () => sendTv('addBot');
$('tvJoinHere').onclick = () => {
  if (tv.id) { tv.leave(); showNotice('You left — this screen is a display again', 2500); return; }
  playOnTv(menu.look, () => showNotice('Joined on this screen — WASD to move, arrow keys or mouse to aim', 4000));
};
$('tvLobby').onclick = () => {
  const n = state?.players.filter((p) => !p.bot && p.connected).length || 0;
  if (n && !confirm('Back to the lobby? Everyone will be removed and can re-join by scanning the code.')) return;
  sendTv('lobby');
  menu.open('main'); // after a match, the TV goes back to the game menu
};
// TV remote: left/right switch between the two buttons, centre/Enter presses (native button behaviour).
addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('show-over')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { $('tvRematch').focus(); e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { $('tvLobby').focus(); e.preventDefault(); }
});

connect();
requestAnimationFrame(frame);

// ------------------------------------------------------------------ sound
// Browsers keep a page silent until someone interacts with it. The TV tries to start sound by itself; otherwise the
// first click / remote key turns it on. The Sound button (top-left toolbar) and M toggle it.
function soundUi() {
  const on = sfx.isUnlocked() && !sfx.isMuted();
  $('soundLabel').textContent = on ? 'Sound on' : 'Sound off';
  $('soundBtn').classList.toggle('off', !on);
  const st = document.getElementById('sSound');
  if (st) { st.textContent = on ? 'ON' : 'OFF'; st.classList.toggle('on', on); }
}
const soundStarted = () => { sfx.ambience(true); soundUi(); };
sfx.tryAutoStart(soundStarted);
sfx.unlockOnFirstGesture(soundStarted);
function toggleSound() {
  if (!sfx.isUnlocked()) { sfx.unlock(); sfx.setMuted(false); setTimeout(soundStarted, 150); return; }
  sfx.setMuted(!sfx.isMuted());
  soundUi();
}
$('soundBtn').onclick = (e) => { e.stopPropagation(); toggleSound(); };
soundUi();

// ------------------------------------------------------------------ menu + playing on the TV
let roomCode = sessionStorage.getItem('room') || '';
let latency = null;
let fpsFrames = 0;
let fps = 0;
let showFps = localStorage.getItem('la-fps') === '1';
let quality = localStorage.getItem('la-quality') || 'auto';
let tvYou = null; // the TV player's own live position during the secret phase
let afterJoin = null; // what to do once the TV player is in (quick match / customise)
let tvPred = null; // the TV player's locally predicted position (moves instantly, corrected toward the server)
let tvPredPhase = '';

/**
 * Local prediction for the TV player, like a phone: move straight away from the keys / remote / gamepad, then
 * gently pull toward the server's position (20 Hz) so it never drifts. Without this the TV player felt laggy.
 */
function predictTv(s, dt, lobby, action) {
  const p = tv.id && s.players.find((q) => q.id === tv.id);
  if (!p || !p.alive || !(lobby || action)) { tvPred = null; return; }
  const o = live.get(p.id);
  const srv = action ? tvYou : o && { x: o.tx, y: o.ty };
  if (!srv) return;
  if (!tvPred || tvPredPhase !== s.phase) { tvPred = { x: srv.x, y: srv.y, angle: tv.aim }; tvPredPhase = s.phase; }
  const mv = tv.move;
  const speed = action ? 5 : 2.85; // same as the server (src/engine.js SPEED / LOBBY_SPEED)
  tvPred.x += mv.x * speed * dt;
  tvPred.y += mv.y * speed * dt;
  // Keep inside the octagon (fighter radius 0.32).
  for (let k = 0; k < 8; k++) {
    const nx = Math.cos((k * Math.PI) / 4);
    const ny = Math.sin((k * Math.PI) / 4);
    const d = (tvPred.x - scene.C) * nx + (tvPred.y - scene.C) * ny - (s.apothem - 0.32);
    if (d > 0) { tvPred.x -= nx * d; tvPred.y -= ny * d; }
  }
  const ex = srv.x - tvPred.x;
  const ey = srv.y - tvPred.y;
  const err = Math.hypot(ex, ey);
  const moving = mv.x || mv.y;
  if (err > 1.2) { tvPred.x = srv.x; tvPred.y = srv.y; } else {
    const k = Math.min(1, dt * (moving ? (err > 0.35 ? 2 : 0) : 6));
    tvPred.x += ex * k;
    tvPred.y += ey * k;
  }
  tvPred.angle = tv.aim;
}

const tv = createTvPlayer({
  room: () => roomCode,
  onMessage(m) {
    if (m.t === 'you') tvYou = { x: m.x, y: m.y, angle: m.angle };
    else if (m.t === 'joined') { const go = afterJoin; afterJoin = null; setTimeout(() => go?.(), 300); }
    else if (m.t === 'error' && !m.quiet) showNotice(m.msg, 3500);
    else if (m.t === 'kicked') showNotice(m.msg || 'The TV player was removed', 3500);
    else if (m.t === 'state' && m.state.phase !== 'action') tvYou = null;
  },
});

/** Join as the TV player (if not already), then run `then` (e.g. start a quick match). */
function playOnTv(look, then) {
  if (!roomCode) return;
  if (tv.id) { tv.send({ t: 'customize', ...look }); then?.(); return; }
  afterJoin = then;
  tv.join(look);
}

/** Fill the lobby with bots up to `fighters` and start (only the host can; bots never host). */
function startWithBots(fighters, label) {
  const s = state;
  if (!s) return;
  if (s.phase !== 'lobby') { showNotice('A match is already running — it continues', 3000); menu.close(); return; }
  if (s.hostId !== tv.id) { showNotice(`${s.hostName || 'The host'} is the host — they start the match from their phone`, 4000); menu.close(); return; }
  const add = Math.max(0, fighters - s.players.length);
  for (let i = 0; i < add; i++) setTimeout(() => tv.send({ t: 'addBot' }), i * 120);
  setTimeout(() => tv.send({ t: 'start' }), add * 120 + 350);
  showNotice(label, 2500);
  menu.close();
}

const menu = createMenu({
  enter() { menu.close(); },
  quick(look) { playOnTv(look, () => startWithBots(4, 'Quick match — you vs 3 bots')); },
  lockerPlay(look) { playOnTv(look, () => menu.close()); },
  onLook(look) {
    scene?.setShowcaseLook({ ...look, beam: menu.view === 'locker' }); // the Customise screen shows the laser too
    if (tv.id && state?.phase === 'lobby') tv.send({ t: 'customize', color: look.color, laserColor: look.laserColor, outfit: look.outfit, skin: look.skin });
  },
  onView(v, look) {
    scene?.setLocker(v === 'locker');
    scene?.setShowcaseLook({ ...look, beam: v === 'locker' });
  },
  onOpenChange(open) { tv.setEnabled(!open); },
  canClose: () => !!state,
  takenColors: () => new Set((state?.players || []).filter((p) => p.id !== tv.id).map((p) => p.color)),
  terminate() {
    const n = state?.players.filter((p) => !p.bot && p.id !== tv.id).length || 0;
    if (!confirm(n ? `End this session? The ${n} player${n === 1 ? '' : 's'} here will need to scan a new code.` : 'End this session and open a fresh room?')) return;
    tv.leave();
    sessionStorage.removeItem('room');
    sendTv('newRoom');
    menu.show('main');
  },
  setSound() { toggleSound(); },
  setQuality() {
    quality = { auto: 'high', high: 'low', low: 'auto' }[quality];
    localStorage.setItem('la-quality', quality);
    scene?.setQuality(quality);
    paintSettings();
  },
  setFps() { showFps = !showFps; localStorage.setItem('la-fps', showFps ? '1' : '0'); paintSettings(); },
  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => showNotice('Fullscreen is not available in this browser', 2500));
  },
  leaveTv() {
    if (!tv.id) { showNotice('Nobody is playing on this TV — use Quick Match or the Locker', 3000); return; }
    tv.leave();
    showNotice('The TV player left', 2500);
    paintSettings();
  },
  paintSettings,
});

function paintSettings() {
  soundUi();
  const set = (id, txt, on) => { const el = $(id); el.textContent = txt; el.classList.toggle('on', !!on); };
  set('sQuality', quality.toUpperCase(), quality !== 'low');
  set('sFps', showFps ? 'ON' : 'OFF', showFps);
  set('sTv', tv.id ? 'LEAVE' : '—', false);
  $('sTvSub').textContent = tv.id ? 'PLAYING ON THIS TV // PRESS TO LEAVE' : 'NOT PLAYING // USE QUICK MATCH OR THE LOCKER';
  $('fpsBox').classList.toggle('hidden', !showFps);
}

$('menuBtn').onclick = (e) => { e.stopPropagation(); menu.open('main'); };

// Mouse aim for the player on this screen (laptop): aim from your fighter toward the mouse on the arena floor.
addEventListener('pointermove', (e) => {
  if (!tv.id || !tvPred || menu.isOpen || e.pointerType === 'touch' || !scene) return;
  const g = scene.screenToGame(e.clientX, e.clientY);
  if (g) tv.pointerAim((Math.atan2(g.y - tvPred.y, g.x - tvPred.x) * 180) / Math.PI);
});
scene?.setShowcaseLook(menu.look);
if (quality !== 'auto') scene?.setQuality(quality);
paintSettings();
menu.open('main');

// Status bar: frame rate, latency to the server, room and players.
setInterval(() => {
  fps = fpsFrames;
  fpsFrames = 0;
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping', at: performance.now() }));
  const humans = state?.players.filter((p) => !p.bot && p.connected).length || 0;
  menu.setStatus({ fps, latency, room: roomCode, players: state?.players.length || 0, online: ws?.readyState === 1, active: humans, tvPlaying: !!tv.id });
  if (showFps) $('fpsBox').textContent = `${fps} FPS · ${latency ?? '—'} MS`;
}, 1000);
