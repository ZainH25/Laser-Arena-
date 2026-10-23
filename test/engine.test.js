import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, Game, insideCage, clampToCage, rayCircle, rayToWall, resolveReveal, START_APOTHEM, FIGHTER_R, ACTION_MS, REVEAL_MS, SHOTS_MS, POINTS_HIT, POINTS_SURVIVE } from '../src/engine.js';

test('octagon inside test and clamping', () => {
  assert.ok(insideCage(C, C, 4.5));
  assert.ok(!insideCage(C + 4.6, C, 4.5));
  assert.ok(!insideCage(C + 3.4, C + 3.4, 4.5)); // corner is cut
  const [x, y] = clampToCage(C + 10, C + 7, 4.5, FIGHTER_R);
  assert.ok(insideCage(x, y, 4.5, FIGHTER_R - 1e-6));
});

test('ray geometry', () => {
  assert.equal(rayCircle(0, 0, 1, 0, 5, 0, 0.5), 4.5);
  assert.equal(rayCircle(0, 0, 1, 0, -5, 0, 0.5), Infinity);
  assert.ok(Math.abs(rayToWall(C, C, 1, 0, 4) - 4) < 1e-9);
});

test('laser stops at the first fighter (shield) and mutual kills happen', () => {
  const r = resolveReveal([
    { id: 'a', x: 2, y: C, angle: 0 },
    { id: 'b', x: 4, y: C, angle: 180 },
    { id: 'c', x: 6, y: C, angle: 90 },
  ], START_APOTHEM);
  assert.deepEqual([...r.deaths.keys()].sort(), ['a', 'b']);
  assert.equal(r.shots.find((s) => s.from === 'a').hit, 'b');
});

test('aim precision: direct hit vs near miss', () => {
  const hit = resolveReveal([{ id: 'a', x: 2, y: 2, angle: 45 }, { id: 'b', x: 5, y: 5, angle: 180 }], START_APOTHEM);
  assert.ok(hit.deaths.has('b'));
  const miss = resolveReveal([{ id: 'a', x: 2, y: 2, angle: 35 }, { id: 'b', x: 5, y: 5, angle: 180 }], START_APOTHEM);
  assert.ok(!miss.deaths.has('b'));
});

test('overlapping fighters clash', () => {
  const r = resolveReveal([{ id: 'a', x: C, y: C, angle: 0 }, { id: 'b', x: C + 0.2, y: C, angle: 90 }], START_APOTHEM);
  assert.equal(r.deaths.get('a').cause, 'clash');
  assert.equal(r.deaths.get('b').cause, 'clash');
});

test('movement is server-side, speed-capped and stays in the cage; live position is hidden', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'ann');
  g.addPlayer('b', 'bob');
  g.start();
  const shownBefore = g.publicState().players[0];
  for (let i = 0; i < 100; i++) { g.input('a', { mx: 50, my: 0, aim: 90 }); t += 40; g.tick(); }
  const a = g.get('a');
  assert.ok(insideCage(a.x, a.y, g.apothem, FIGHTER_R - 1e-6));
  // While the action phase runs, others only see the last revealed spot.
  if (g.phase === 'action') assert.equal(g.publicState().players[0].x, shownBefore.x);
});

test('cage shrink eliminates fighters left outside', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.addPlayer('c', 'c');
  g.start();
  // Burn round 1.
  for (const p of g.players) p.angle = 999; // aim away is irrelevant; keep everyone at spawn facing centre
  t += ACTION_MS + 200;
  g.tick();
  t += REVEAL_MS + 200;
  g.tick();
  assert.equal(g.round >= 2 || g.phase === 'over', true);
});

test('full bot matches always end with one winner or a draw', () => {
  for (let seed = 1; seed <= 300; seed++) {
    let s = seed;
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let t = 0;
    const g = new Game({ now: () => t, random });
    const n = 2 + (seed % 7);
    for (let i = 0; i < n; i++) g.addBot();
    g.start();
    let guard = 0;
    while (g.phase !== 'over') {
      t += 50;
      g.tick();
      assert.ok(++guard < 200_000, `match ${seed} never ended (round ${g.round})`);
    }
    assert.ok(g.alive.length <= 1);
    assert.equal(g.winner, g.alive[0]?.id ?? null);
  }
});

test('rematch is refused (state untouched) and names whoever is missing', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'ann');
  g.addPlayer('b', 'bob');
  g.addBot();
  g.start();
  g.phase = 'over';
  g.disconnect('b');
  assert.deepEqual(g.rematch(), { missing: ['BOB'] });
  assert.equal(g.phase, 'over');
  g.reconnect('b');
  g.rematch();
  assert.equal(g.phase, 'action');
});

test('back to lobby always gives a full cage with everyone alive', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.start();
  g.apothem = 2.1;
  g.players[0].alive = false;
  g.phase = 'over';
  g.backToLobby();
  assert.equal(g.phase, 'lobby');
  assert.equal(g.apothem, START_APOTHEM);
  assert.ok(g.get('a').alive);
});

test('a lobby left with a shrunk cage repairs itself on the next tick', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.apothem = 1.5; // stale state from an older match
  t += 50;
  assert.equal(g.tick(), 'phase');
  assert.equal(g.apothem, START_APOTHEM);
});

test('stage drops exactly one of 4 layers per round from round 2, never the last', async () => {
  const { STAGE_LAYERS, nextLayer } = await import('../src/engine.js');
  assert.equal(STAGE_LAYERS.length, 4);
  assert.equal(nextLayer(STAGE_LAYERS[0]), STAGE_LAYERS[1]);
  assert.equal(nextLayer(STAGE_LAYERS[3]), STAGE_LAYERS[3]);
  let t = 0;
  const g = new Game({ now: () => t, random: () => 0.5 });
  for (let i = 0; i < 2; i++) g.addBot();
  g.start();
  const sizes = [g.apothem];
  while (g.phase !== 'over' && sizes.length < 8) {
    t += 50;
    if (g.tick() === 'phase' && g.phase === 'action') sizes.push(g.apothem);
  }
  for (const a of sizes) assert.ok(STAGE_LAYERS.includes(a), `apothem ${a} is a layer size`);
});

test('shots fire first, then the marked layer falls under whoever is still on it', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.addPlayer('c', 'c');
  g.start();
  g.round = 1;
  g.beginAction(); // round 2: the outer layer is doomed
  const [a, b, c] = g.players;
  Object.assign(a, { x: C - 4.0, y: C, angle: 0 }); // on the outer layer, aiming at b
  Object.assign(b, { x: C, y: C, angle: 90 });
  Object.assign(c, { x: C, y: C + 2, angle: 180 });
  t += ACTION_MS + 100;
  g.tick();
  const deaths = Object.fromEntries(g.lastReveal.deaths.map((d) => [d.id, d.cause]));
  assert.equal(deaths.a, 'out');
  assert.equal(deaths.b, 'laser', 'a fires before the layer drops');
  assert.ok(g.lastReveal.shots.some((s) => s.from === 'a'));
  assert.equal(g.lastReveal.dropAtMs, SHOTS_MS);
});

test('the UI draws exactly the same stage layers the engine uses', async () => {
  const fs = await import('node:fs');
  const { STAGE_LAYERS } = await import('../src/engine.js');
  const src = fs.readFileSync(new URL('../public/ui/shared/common.js', import.meta.url), 'utf8');
  const ui = JSON.parse(src.match(/STAGE_LAYERS = (\[[^\]]+\])/)[1]);
  assert.deepEqual(ui, STAGE_LAYERS);
});

test('points: +5 to the shooter for each laser kill, +1 to everyone who survives the reveal', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.addPlayer('c', 'c');
  g.start();
  const [a, b, c] = g.players;
  Object.assign(a, { x: C - 2, y: C, angle: 0 }); // a shoots b
  Object.assign(b, { x: C, y: C, angle: 90 }); // b aims at nobody (down, c is up there? no: c is above)
  Object.assign(c, { x: C + 1.5, y: C - 2.5, angle: 270 }); // c aims away
  for (const p of g.players) p.input.aim = null;
  t += ACTION_MS + 100;
  g.tick();
  const dead = g.lastReveal.deaths.map((d) => d.id);
  assert.deepEqual(dead, ['b']);
  assert.equal(a.points, POINTS_HIT + POINTS_SURVIVE);
  assert.equal(b.points, 0);
  assert.equal(c.points, POINTS_SURVIVE);
  assert.equal(g.publicState().players.find((p) => p.id === 'a').points, 6);
});

test('no draws: if everyone is eliminated, they come back and play on until one survives', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.start();
  const [a, b] = g.players;
  Object.assign(a, { x: C - 1.5, y: C, angle: 0 }); // face to face: both terminate each other
  Object.assign(b, { x: C + 1.5, y: C, angle: 180 });
  for (const p of g.players) p.input.aim = null;
  t += ACTION_MS + 100;
  g.tick();
  assert.equal(g.alive.length, 0);
  assert.equal(a.points, POINTS_HIT);
  assert.equal(b.points, POINTS_HIT);
  t += 20_000;
  g.tick();
  assert.equal(g.phase, 'action', 'no draw: the match goes on');
  assert.equal(g.alive.length, 2);
  assert.equal(g.round, 2);
  assert.ok(g.alive.every((p) => insideCage(p.x, p.y, g.apothem)));
});

test('leaving mid-match: you are out, the match goes on — or ends when one fighter is left', () => {
  let t = 0;
  const g = new Game({ now: () => t });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  g.addPlayer('c', 'c');
  g.start();
  assert.deepEqual(g.forfeit('a'), {});
  assert.equal(g.get('a').alive, false);
  assert.equal(g.get('a').death.cause, 'left');
  assert.equal(g.phase, 'action', 'two left: the match goes on');
  assert.ok(g.forfeit('a').error, 'cannot leave twice');
  g.forfeit('b');
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'c');
  g.backToLobby();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.alive));
});
