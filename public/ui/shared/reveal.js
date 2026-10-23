// Reveal timing shared by the TV and phones. Shots play first; the marked layer drops at
// reveal.dropAtMs; then, after a 1 s pause, the next layer is marked.

const MARK_DELAY = 1; // seconds between the drop (or the shots, if nothing drops) and marking the next layer
const SHOTS_S = 2.8; // matches SHOTS_MS in src/engine.js

/** Where a reveal is at, `e` seconds after it started. */
export function revealStage(state, e) {
  const r = state.reveal;
  if (!r || r.prevApothem === undefined) return null;
  const drop = r.dropAtMs == null ? null : r.dropAtMs / 1000;
  const dropped = drop === null || e >= drop;
  const markNext = e >= (drop ?? SHOTS_S) + MARK_DELAY;
  return {
    drop, dropped,
    sinceDrop: drop === null ? 0 : e - drop,
    apothem: dropped ? state.apothem : r.prevApothem, // the platform shown right now
    // Red mark: the ring about to drop; then, 1 s after the drop, the next one.
    band: !dropped ? [r.prevApothem, state.apothem]
      : markNext && state.phase === 'reveal' && r.upcoming < state.apothem ? [state.apothem, r.upcoming] : null,
  };
}

/** True when (x, y) in game coords is off a platform of this apothem (octagon centred at c). */
export function offDeck(x, y, apothem, c) {
  let m = -Infinity;
  for (let k = 0; k < 8; k++) m = Math.max(m, (x - c) * Math.cos((k * Math.PI) / 4) + (y - c) * Math.sin((k * Math.PI) / 4));
  return m > apothem;
}

/** A body left on a layer that just dropped falls with it (display only): y offset below the deck, or 0. */
export function bodyDrop(mv, state, p, c) {
  if (!mv?.dropped || mv.drop === null || !offDeck(p.x, p.y, state.apothem, c)) return 0;
  return -4.5 * mv.sinceDrop * mv.sinceDrop;
}

/** Light red mark on the ring between band[0] and band[1] (or none). */
export function applyBand(scene, band) {
  scene.doomActive = !!band;
  if (!band) return;
  const key = band.join('/');
  if (scene.doomBandFor !== key) { scene.doomBandFor = key; scene.setDoomBand(band[0], band[1]); }
}
