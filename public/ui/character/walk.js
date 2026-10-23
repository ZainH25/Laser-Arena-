// Walk cycle driven by how fast a fighter actually moves on screen (works for TV and phones, no extra network data).

const MAX_REAL_SPEED = 12; // anything faster is a teleport (phase change), not walking

/** Call once per frame for each fighter record {group, aimer, legs}. */
export function animateWalk(f, dt) {
  if (!f.legs || !f.group.visible) { f._prev = null; return; }
  const p = f.group.position;
  if (!f._prev) { f._prev = p.clone(); f._walk = 0; f._phase = 0; }
  let speed = dt > 0 ? Math.hypot(p.x - f._prev.x, p.z - f._prev.z) / dt : 0;
  f._prev.copy(p);
  if (speed > MAX_REAL_SPEED) speed = 0;
  const target = Math.min(1, speed / 2.2);
  f._walk += (target - f._walk) * Math.min(1, dt * 10);
  f._phase += dt * (5 + speed * 2.4);
  const swing = Math.sin(f._phase) * 0.75 * f._walk;
  f.legs[0].rotation.z = swing;
  f.legs[1].rotation.z = -swing;
  f.aimer.position.y = Math.abs(Math.sin(f._phase)) * 0.035 * f._walk;
}
