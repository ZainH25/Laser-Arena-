// Phone-side 3D cage view (same renderer as the TV, tuned for small screens).
import { CageScene } from '/ui/scene.js';
import { setFighterDead } from '/ui/character/mannequin.js';
import { revealStage, applyBand, bodyDrop } from '/ui/shared/reveal.js';
import * as sfx from '/ui/shared/sound.js';
import { buzz, HAPTIC } from '/ui/shared/haptics.js';

/** Haptics + red flash when a fighter goes down (mine hits much harder). No sound: the laser says it all. */
function deathFx(scene, isMe) {
  if (isMe) {
    buzz(HAPTIC.hit);
    window.dispatchEvent(new Event('la:terminated'));
  } else {
    buzz(HAPTIC.otherHit);
  }
}

export function createPhoneCage(el) {
  const cage = new CageScene(el, 4.5, { phone: true });
  cage.setShowcase(false);
  return cage;
}


function place(scene, f, x, y, angleDeg, deckY) {
  const [mx, mz] = scene.w(x, y);
  f.group.visible = true;
  f.group.position.set(mx, deckY, mz);
  f.aimer.rotation.y = (-angleDeg * Math.PI) / 180;
}

/**
 * Draws one frame of the phone's view.
 *  lobby  — everyone, live (me = local prediction, others = smoothed network positions)
 *  action — ONLY me (nobody else's position is ever sent to this phone)
 *  reveal / over — everyone at their revealed spots, with the shots
 * @param {CageScene} scene
 * @param {{x:number,y:number,angle:number}|null} me   my predicted position
 * @param {Map<string,{x:number,y:number,angle:number}>} others  smoothed lobby positions
 */
export function syncPhoneScene(scene, state, myId, me, others, now) {
  const phase = state.phase;
  const lobby = phase === 'lobby';
  const action = phase === 'action';

  // Cage size: animate only when it changes (cheap — the deck is scaled, not rebuilt).
  scene.targetApothem = state.apothem;
  if (lobby) scene.shownApothem = state.apothem;
  scene.doomActive = action && state.nextApothem < state.apothem;
  const doomKey = `${state.apothem}/${state.nextApothem}`;
  if (scene.doomActive && scene.doomBandFor !== doomKey) {
    scene.doomBandFor = doomKey;
    scene.setDoomBand(state.apothem, state.nextApothem);
  }

  // Reveal order: the doomed layer drops first, then fighters appear and the lasers fire.
  if (phase === 'reveal' && state.reveal && scene._revealRound !== state.reveal.round) {
    scene._revealRound = state.reveal.round;
    scene._revealAt = now;
    scene._lasersShown = false;
    scene.clearLasers();
  }
  const e = phase === 'reveal' ? (now - (scene._revealAt || now)) / 1000 : 99;
  const fall = phase === 'reveal' ? (state.reveal?.fallMs || 0) / 1000 : 0;
  const falling = phase === 'reveal' && e < fall;
  if (phase === 'reveal' && state.reveal && !scene._lasersShown && e >= fall) {
    scene._lasersShown = true;
    const n = Math.min(8, state.reveal.shots.length);
    state.reveal.shots.forEach((shot, i) => {
      const shooter = state.players.find((p) => p.id === shot.from);
      scene.addLaser(shot, shooter?.laserColor || shooter?.color);
      if (i < 8) sfx.laser((shot.x1 - scene.C) / scene.C, i * 0.035, 0.85 / Math.sqrt(n));
    });
    if (n) buzz(HAPTIC.shot);
  }
  // shots first, then the marked layer drops; light red marks the next ring to go.
  const mv = revealStage(state, e);
  if (mv) scene.targetApothem = mv.apothem;
  if (mv?.dropped && mv.drop !== null && scene._mrCleared !== scene._revealAt) {
    scene._mrCleared = scene._revealAt;
    if (phase === 'reveal') { scene.clearLasers(); buzz(HAPTIC.drop); }
  }
  if (phase === 'reveal' && mv?.dropped && mv.band && scene._marked !== scene._revealAt) {
    scene._marked = scene._revealAt; // next layer turns red: alarm
    buzz(HAPTIC.alarm);
  }
  if (!lobby) applyBand(scene, action ? (state.nextApothem < state.apothem ? [state.apothem, state.nextApothem] : null) : mv?.band);
  const fellOff = new Set((state.reveal?.deaths || []).filter((d) => d.cause === 'out').map((d) => d.id));
  if (lobby || action) {
    if (scene._revealRound) { scene._revealRound = 0; scene.clearLasers(); }
  }

  const mine = state.players.find((p) => p.id === myId);
  if ((lobby || action) && mine?.alive && me) {
    scene.setSightLaser(me.x, me.y, me.angle, mine.laserColor || mine.color, state.apothem);
  } else {
    scene.hideSightLaser();
  }

  const deckY = scene.ringCenter?.position.y ?? 0;
  const ids = new Set(state.players.map((p) => p.id));
  for (const [id, f] of scene.fighters) if (!ids.has(id)) f.group.visible = false;

  const deaths = new Map((state.reveal?.deaths || []).map((d) => [d.id, d]));
  for (const p of state.players) {
    const f = scene.fighter(p);
    const isMe = p.id === myId;
    if (f.ring) f.ring.visible = isMe && p.alive && (lobby || action);

    if (lobby) {
      const src = isMe ? me || p : others.get(p.id) || p;
      place(scene, f, src.x, src.y, src.angle ?? p.angle, deckY);
      f.label.visible = !isMe;
      f.aimer.rotation.z = 0;
      setFighterDead(f, false);
      continue;
    }

    if (action) {
      f.label.visible = false;
      if (p.alive) f.deadAt = 0; // new round (incl. sudden-death revival): standing, ready for a fresh death animation
      if (isMe && p.alive && me) {
        place(scene, f, me.x, me.y, me.angle, deckY);
        f.aimer.rotation.z = 0;
        setFighterDead(f, false);
      } else {
        f.group.visible = false;
      }
      continue;
    }

    // reveal / over: everyone who was alive this round, at the revealed spot.
    const diedEarlier = p.death && (!state.reveal || p.death.round !== state.reveal.round);
    if (diedEarlier) { f.group.visible = false; continue; }
    if (fellOff.has(p.id) && mv) { // stands until the layer drops, then falls with it
      const fe = mv.dropped ? mv.sinceDrop : 0;
      if (mv.dropped && !f.deadAt && phase === 'reveal') { f.deadAt = now; deathFx(scene, isMe); }
      place(scene, f, p.x, p.y, p.angle, deckY - 4.5 * fe * fe);
      f.group.visible = !mv.dropped || (phase === 'reveal' && fe < 1.2);
      f.label.visible = f.group.visible && !isMe;
      f.aimer.rotation.z = Math.min(1.2, fe * 1.5);
      setFighterDead(f, false);
      continue;
    }
    if (fellOff.has(p.id)) {
      place(scene, f, p.x, p.y, p.angle, deckY - 4.5 * e * e);
      f.group.visible = phase === 'reveal' && e < fall + 0.2;
      f.label.visible = f.group.visible && !isMe;
      f.aimer.rotation.z = Math.min(1.2, e * 1.5);
      continue;
    }
    if (falling) { f.group.visible = false; continue; }
    place(scene, f, p.x, p.y, p.angle, deckY);
    f.label.visible = !isMe;
    if (deaths.has(p.id) && (phase === 'over' || e > fall + 0.45)) {
      if (!f.deadAt) { f.deadAt = now; if (phase === 'reveal') deathFx(scene, isMe); }
      const k = Math.min(1, (now - f.deadAt) / 450);
      f.aimer.rotation.z = (k * Math.PI) / 2.2;
      setFighterDead(f, true);
      const dy = bodyDrop(mv, state, p, scene.C); // shot on the layer that then dropped: falls with it
      f.group.position.y = deckY + dy;
      if (dy < -6) f.group.visible = f.label.visible = false;
    } else {
      f.deadAt = 0;
      f.aimer.rotation.z = 0;
      setFighterDead(f, false);
    }
  }
}

