// Sound effects, synthesized live with the Web Audio API (no audio files, nothing to download or license).
// Browsers only allow sound after a user gesture, so call unlock() from a click / key / tap handler.

let ctx = null;
let master = null;
let noiseBuf = null;
let hum = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // Master chain: gain → gentle compressor, so stacked lasers never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// Recorded samples (in public/sounds), decoded once after sound is unlocked.
const samples = {};
function loadSample(name, url) {
  if (samples[name] !== undefined) return;
  samples[name] = null;
  fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { samples[name] = buf; })
    .catch(() => { delete samples[name]; });
}

/** Start audio (must run inside a user gesture). Safe to call often. */
let silentEl = null;

/** A tiny silent WAV, looped in an <audio> element: on iPhones this moves the page into the "playback" audio
 *  session, so game sound plays even when the ring/silent switch is on silent. */
function silentWav() {
  const n = 800;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const str = (o, s) => [...s].forEach((ch, i) => { b[o + i] = ch.charCodeAt(0); });
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  let s = '';
  b.forEach((x) => { s += String.fromCharCode(x); });
  return `data:audio/wav;base64,${btoa(s)}`;
}

export function unlock() {
  const c = ensure();
  if (!c) return false;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!silentEl) {
    silentEl = document.createElement('audio');
    silentEl.setAttribute('playsinline', '');
    silentEl.loop = true;
    silentEl.src = silentWav();
  }
  silentEl.play?.().catch(() => {});
  if (c.state !== 'running') c.resume().catch(() => {});
  // iOS only "opens" audio once something actually plays inside the gesture: play one silent sample.
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
  } catch {}
  loadSample('laser', '/sounds/laser.mp3');
  return !!c && c.state !== 'closed';
}

export const isUnlocked = () => !!ctx && ctx.state === 'running';

/** Try to start sound without a gesture (works when the browser already trusts this site). Calls back once on. */
export function tryAutoStart(onStart) {
  const c = ensure();
  if (!c) return;
  loadSample('laser', '/sounds/laser.mp3');
  c.resume().then(() => { if (c.state === 'running') onStart?.(); }).catch(() => {});
}

/** Unlock on the first gesture anywhere on the page (pointer, touch, click or key). Also re-wakes audio after the
 *  phone locks or the tab is switched (iOS "interrupts" the audio then). */
export function unlockOnFirstGesture(onStart) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
  ['touchend', 'click'].forEach((e) => addEventListener(e, () => { if (ctx && ctx.state !== 'running') unlock(); }, true));
  const evs = ['pointerdown', 'touchend', 'click', 'keydown'];
  const go = () => {
    unlock();
    setTimeout(() => {
      if (!isUnlocked()) return;
      evs.forEach((e) => removeEventListener(e, go, true));
      onStart?.();
    }, 120);
  };
  evs.forEach((e) => addEventListener(e, go, true));
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

const ready = () => ctx && ctx.state === 'running' && !muted;

/** Envelope helper: a gain node that rises to `peak` in `a` s and decays to silence over `d` s. */
function env(t, peak, a, d, dest = master) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.connect(dest);
  return g;
}

function osc(type, freq, t, dur, dest) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function noise(t, dur, dest, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}

function filter(type, freq, q = 1, dest = master) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** Stereo position (-1 left … 1 right) for an effect. */
function pan(x, dest = master) {
  if (!ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, x));
  p.connect(dest);
  return p;
}

// ------------------------------------------------------------------ effects

/** Countdown beep for the last seconds of MOVE & AIM. `final` = the higher "time's up" tone. */
export function tick(final = false) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const f = final ? 1320 : 880;
  const g = env(t, final ? 0.35 : 0.25, 0.005, final ? 0.45 : 0.18);
  osc('sine', f, t, 0.5, g);
  osc('triangle', f * 2, t, 0.2, env(t, 0.06, 0.005, 0.1));
}

/** Soft "secret phase begins" swell. */
export function roundStart() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const g = env(t, 0.18, 0.25, 0.9, filter('lowpass', 1400));
  const o = osc('sawtooth', 110, t, 1.2, g);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.9);
  osc('sawtooth', 165, t, 1.2, g).frequency.exponentialRampToValueAtTime(330, t + 0.9);
}

/** REVEAL sting: a bright rising whoosh. */
export function reveal() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const bp = filter('bandpass', 400, 2);
  bp.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
  noise(t, 0.7, env(t, 0.5, 0.35, 0.35, bp));
  osc('square', 220, t + 0.4, 0.3, env(t + 0.4, 0.12, 0.01, 0.3, filter('lowpass', 2000)));
}

/** One laser shot: the recorded laser (public/sounds/laser.mp3), panned to the shooter's side (-1…1), with a
 *  slight random pitch so a volley doesn't phase. Falls back to a synth zap until the file has loaded. */
export function laser(x = 0, delay = 0, volume = 0.75) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  if (samples.laser) {
    const src = ctx.createBufferSource();
    src.buffer = samples.laser;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(pan(x));
    src.start(t);
    return;
  }
  const out = pan(x);
  const f0 = 2400 * (0.9 + Math.random() * 0.2);
  const g = env(t, 0.22, 0.004, 0.32, out);
  const o = osc('sawtooth', f0, t, 0.35, filter('lowpass', 5000, 1, g));
  o.frequency.exponentialRampToValueAtTime(140, t + 0.3);
  const o2 = osc('square', f0 * 0.5, t, 0.25, env(t, 0.07, 0.004, 0.2, out));
  o2.frequency.exponentialRampToValueAtTime(90, t + 0.22);
  noise(t, 0.08, env(t, 0.12, 0.002, 0.06, filter('highpass', 3000, 1, out)));
}

// ------------------------------------------------------------------ tension bed (MOVE & AIM)
let tensionNodes = [];

/**
 * Panic bed for the secret phase, `seconds` long: a dark drone whose filter slowly opens, a heartbeat that speeds
 * up as time runs out, and a rising noise sweep over the last 3 seconds. Everything is scheduled up front.
 */
export function tension(seconds, danger = false) {
  stopTension();
  if (!ready() || seconds < 1) return;
  const t = ctx.currentTime;
  const end = t + seconds;
  const keep = (n) => { tensionNodes.push(n); return n; };

  // Drone: detuned low saws through a lowpass that opens over the round.
  const dg = keep(ctx.createGain());
  dg.gain.setValueAtTime(0.0001, t);
  dg.gain.exponentialRampToValueAtTime(danger ? 0.2 : 0.15, t + 1.2);
  dg.gain.setValueAtTime(danger ? 0.2 : 0.15, end - 0.15);
  dg.gain.exponentialRampToValueAtTime(0.0001, end);
  dg.connect(master);
  const lp = keep(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(140, t);
  lp.frequency.exponentialRampToValueAtTime(1100, end);
  lp.connect(dg);
  for (const [f, d] of [[55, 0], [55, 9], [82.4, -6]]) {
    const o = keep(osc('sawtooth', f, t, seconds, lp));
    o.detune.value = d;
  }

  // Heartbeat: "lub-dub" thumps, 0.95 s apart at first, 0.36 s apart at the end.
  for (let bt = 0.4; bt < seconds - 0.1;) {
    const k = bt / seconds;
    for (const [off, amp, f] of [[0, 0.7, 62], [0.14, 0.45, 52]]) {
      const tb = t + bt + off;
      if (tb >= end) continue;
      const o = keep(osc('sine', f * 1.6, tb, 0.25, env(tb, amp, 0.008, 0.2)));
      o.frequency.exponentialRampToValueAtTime(f, tb + 0.12);
    }
    bt += 0.95 - 0.59 * k * k;
  }

  // Riser over the last 3 seconds.
  const rs = Math.max(t, end - 3);
  const bp = keep(ctx.createBiquadFilter());
  bp.type = 'bandpass';
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(300, rs);
  bp.frequency.exponentialRampToValueAtTime(5000, end);
  const rg = keep(ctx.createGain());
  rg.gain.setValueAtTime(0.0001, rs);
  rg.gain.exponentialRampToValueAtTime(0.35, end);
  rg.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
  bp.connect(rg).connect(master);
  keep(noise(rs, end - rs + 0.05, bp));
}

export function stopTension() {
  if (!ctx) return;
  for (const n of tensionNodes) {
    try { if (n.stop) n.stop(); else n.disconnect(); } catch {}
  }
  tensionNodes = [];
}

/** Someone joined the lobby. */
export function join() {
  if (!ready()) return;
  const t = ctx.currentTime;
  [523, 784].forEach((f, i) => osc('sine', f, t + i * 0.07, 0.15, env(t + i * 0.07, 0.15, 0.005, 0.14)));
}

/** Match won: short fanfare. */
export function win() {
  if (!ready()) return;
  const t = ctx.currentTime;
  [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]].forEach(([f, dt]) => {
    const g = env(t + dt, 0.2, 0.01, dt === 0.38 ? 1.1 : 0.25, filter('lowpass', 3500));
    osc('sawtooth', f, t + dt, 1.2, g);
    osc('square', f / 2, t + dt, 1.2, env(t + dt, 0.06, 0.01, 0.4));
  });
}

/** Low hall ambience (TV only): a quiet ventilation hum that runs while the page is open. */
export function ambience(on) {
  if (!ctx || ctx.state !== 'running') return;
  if (on && !hum) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.09, ctx.currentTime, 1.5);
    g.connect(master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.connect(g);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.35;
    s.connect(lp);
    s.start();
    const o = ctx.createOscillator();
    o.frequency.value = 50;
    const og = ctx.createGain();
    og.gain.value = 0.15;
    o.connect(og).connect(g);
    o.start();
    hum = { g, s, o };
  } else if (!on && hum) {
    hum.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const h = hum;
    setTimeout(() => { h.s.stop(); h.o.stop(); }, 1500);
    hum = null;
  }
}
