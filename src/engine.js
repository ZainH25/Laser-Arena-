// Laser Arena: Cage Edition — pure game rules (no I/O). The server owns one Game per room.
//
// Rules
//  • The cage is a regular octagon centred at (C, C). Its apothem (centre-to-wall distance) shrinks each round.
//  • ACTION (7 s): fighters move freely and aim in real time with their phone. Only the server and the fighter's own
//    phone know where they are; the TV shows nothing until the reveal.
//  • REVEAL: when the timer hits zero every position and aim freezes and all lasers fire at once. A laser stops at the
//    first fighter it touches (others act as shields) or at the cage wall. Hits are simultaneous: two fighters can
//    terminate each other. Two fighters overlapping is a CLASH (both out).
//  • The cage then contracts. Anyone left outside the new wall is OUT. Last fighter standing wins. A reveal that
//    leaves nobody is not a draw: everyone eliminated in it comes back and they fight on until one survives.
//  • POINTS: +5 for each fighter your laser terminates, +1 for every reveal you survive (moving on to the next round).

export const POINTS_HIT = 5;
export const POINTS_SURVIVE = 1;
export const MAX_SUDDEN_DEATH = 10; // after this many wipe-outs in a row the highest score wins (no endless matches)

export const C = 4.5; // cage centre (world units; the original cage spans 0..9)
export const START_APOTHEM = 4.5;
/** The stage is 4 octagon layers (outer → inner). From round 2, the outermost remaining layer falls at each reveal. */
export const STAGE_LAYERS = [4.5, 3.45, 2.4, 1.35];
export const MIN_APOTHEM = STAGE_LAYERS[STAGE_LAYERS.length - 1];

/** The next smaller layer, or the same size if this is already the last layer. */
export function nextLayer(apothem) {
  return STAGE_LAYERS.find((a) => a < apothem - 1e-6) ?? apothem;
}
export const FIGHTER_R = 0.32; // body radius used for walls and clashes
export const HIT_RADIUS = 0.4; // how close a laser must pass to a fighter's centre
export const SPEED = 5.5; // world units per second
export const LOBBY_SPEED = 2.85;

export const LOBBY_GRACE_MS = 30_000; // a phone that drops in the lobby keeps its slot this long

/** Eight fixed spots on a ring inside the cage, facing the centre. Slot i never overlaps another slot. */
export function lobbySpawnForIndex(i) {
  const a = ((i % 8) / 8) * Math.PI * 2 - Math.PI / 2;
  const r = START_APOTHEM * 0.62;
  const x = C + Math.cos(a) * r;
  const y = C + Math.sin(a) * r;
  const angle = ((Math.atan2(C - y, C - x) * 180) / Math.PI + 360) % 360;
  return { x, y, angle };
}
/** Laser colours: every team colour plus extra neon shades. Must match public/ui/shared/looks.js. */
export const LASER_COLORS = ['#39ff14', '#7ed492', '#5dbd6a', '#9ccc65', '#1de9b6', '#4db6ac', '#00e5ff', '#4fc3f7', '#2979ff', '#b388ff',
  '#d500f9', '#f06292', '#ff4081', '#ff1744', '#ff7043', '#ff9100', '#ffd54f', '#ffea00', '#eceff1'];
export const ACTION_MS = 7_000;
/** Headgear. Must match public/ui/shared/looks.js. */
export const OUTFITS = ['cap', 'helmet', 'hood', 'beanie'];
/** Suit skins (looks only). Must match the ids in public/ui/character/skins.js. */
export const SKINS = ['mannequin', 'digital', 'carbon', 'toxic', 'desert', 'marble', 'magma', 'neon', 'crimson', 'galaxy', 'crystal', 'woodland', 'overgrown', 'sandstone'];
export const REVEAL_MS = 5_500;
export const SHOTS_MS = 2_800; // reveal: lasers show this long, then the marked layer drops
export const DROP_MS = 1_400; // extra reveal time for the drop
export const MAX_PLAYERS = 8;
export const COLORS = ['#4fc3f7', '#ff7043', '#9ccc65', '#f06292', '#ffd54f', '#b388ff', '#4db6ac', '#eceff1'];

const NORMALS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

/** Signed distance from the octagon wall (negative = inside). */
export function wallDistance(x, y, apothem) {
  let m = -Infinity;
  for (const [nx, ny] of NORMALS) m = Math.max(m, (x - C) * nx + (y - C) * ny - apothem);
  return m;
}

export const insideCage = (x, y, apothem, margin = 0) => wallDistance(x, y, apothem) <= -margin;

/** Octagon corners (for drawing), clockwise from the right-hand edge. */
export function cagePolygon(apothem) {
  const r = apothem / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, k) => {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  });
}

/** Pushes a point back inside the cage (keeping `margin` from the wall). */
export function clampToCage(x, y, apothem, margin) {
  for (let i = 0; i < 3; i++) {
    for (const [nx, ny] of NORMALS) {
      const d = (x - C) * nx + (y - C) * ny - (apothem - margin);
      if (d > 0) { x -= nx * d; y -= ny * d; }
    }
  }
  return [x, y];
}

/** Distance along a ray (origin o, unit direction d) to where it first touches a circle, or Infinity. */
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = cx - ox;
  const fy = cy - oy;
  const t = fx * dx + fy * dy;
  if (t <= 0) return Infinity;
  const perp2 = fx * fx + fy * fy - t * t;
  if (perp2 > r * r) return Infinity;
  return t - Math.sqrt(r * r - perp2);
}

/** Distance along a ray from inside the octagon to its wall. */
export function rayToWall(ox, oy, dx, dy, apothem) {
  let best = Infinity;
  for (const [nx, ny] of NORMALS) {
    const dn = dx * nx + dy * ny;
    if (dn <= 1e-9) continue;
    const t = (apothem - ((ox - C) * nx + (oy - C) * ny)) / dn;
    best = Math.min(best, Math.max(0, t));
  }
  return best;
}

/**
 * Resolves one reveal. fighters = [{id, x, y, angle}] (angle in degrees, 0° = +x, 90° = +y).
 * Returns {shots:[{from, x1,y1,x2,y2, hit}], deaths: Map(id → {cause, by})}.
 */
export function resolveReveal(fighters, apothem) {
  const deaths = new Map();
  const shots = [];
  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      const a = fighters[i];
      const b = fighters[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < FIGHTER_R * 1.4) {
        for (const [p, q] of [[a, b], [b, a]]) {
          const d = deaths.get(p.id);
          if (d && d.cause === 'clash') d.by.push(q.id);
          else deaths.set(p.id, { cause: 'clash', by: [q.id] });
        }
      }
    }
  }
  for (const f of fighters) {
    const rad = (f.angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let limit = rayToWall(f.x, f.y, dx, dy, apothem);
    let hit = null;
    for (const g of fighters) {
      if (g.id === f.id) continue;
      if (Math.hypot(g.x - f.x, g.y - f.y) < FIGHTER_R * 1.4) continue; // clashing fighters can't shoot each other
      const t = rayCircle(f.x, f.y, dx, dy, g.x, g.y, HIT_RADIUS);
      if (t < limit) { limit = t; hit = g; }
    }
    shots.push({ from: f.id, x1: f.x, y1: f.y, x2: f.x + dx * limit, y2: f.y + dy * limit, hit: hit ? hit.id : null });
    if (hit && !deaths.has(hit.id)) deaths.set(hit.id, { cause: 'laser', by: [f.id] });
    else if (hit && deaths.get(hit.id).cause === 'laser') deaths.get(hit.id).by.push(f.id);
  }
  return { shots, deaths };
}


let botSeq = 0;
const BOT_NAMES = ['VOLT', 'NEON', 'FLUX', 'BOLT', 'ION', 'SPARK', 'ZAPP'];

export class Game {
  constructor({ now = () => Date.now(), random = Math.random, actionMs = ACTION_MS, revealMs = REVEAL_MS } = {}) {
    this.now = now;
    this.random = random;
    this.actionMs = actionMs;
    this.revealMs = revealMs;
    // Player: {id, name, color, bot, alive, wins, connected, x, y, angle (live, secret during action),
    //          shown:{x,y,angle} (last revealed), input:{mx,my,aim}, death}
    this.players = [];
    this.phase = 'lobby'; // lobby | action | reveal | over
    this.round = 0;
    this.apothem = START_APOTHEM;
    this.nextApothem = START_APOTHEM;
    this.phaseEndsAt = 0;
    this.lastTick = 0;
    this.lastReveal = null;
    this.winner = null;
    this.log = [];
  }

  addPlayer(id, name, { bot = false, color: pick, laserColor: pickLaser, outfit: pickOutfit, skin: pickSkin } = {}) {
    if (this.players.length >= MAX_PLAYERS) return { error: 'Game is full' };
    if (this.phase !== 'lobby') return { error: 'Match already running — wait for the next one' };
    const used = new Set(this.players.map((p) => p.color));
    let color = COLORS.includes(pick) && !used.has(pick) ? pick : COLORS.find((c) => !used.has(c));
    const laserColor = LASER_COLORS.includes(pickLaser) ? pickLaser : color; // default: the laser matches the team colour
    const outfit = OUTFITS.includes(pickOutfit) ? pickOutfit : OUTFITS[Math.floor(this.random() * OUTFITS.length)];
    const skin = SKINS.includes(pickSkin) ? pickSkin : bot ? SKINS[1 + Math.floor(this.random() * (SKINS.length - 1))] : SKINS[0];
    const { x, y, angle } = lobbySpawnForIndex(this.freeSpawnSlot());
    const p = {
      id, name: String(name || 'PLAYER').slice(0, 12).toUpperCase(), color, laserColor, outfit, skin, bot,
      alive: true, wins: 0, points: 0, connected: true, x, y, angle, shown: { x, y, angle },
      input: { mx: 0, my: 0, aim: null }, death: null, botPlan: null, disconnectedAt: 0,
    };
    this.players.push(p);
    return { player: p };
  }

  /** First of the 8 lobby spots with nobody standing near it. */
  freeSpawnSlot() {
    for (let k = 0; k < MAX_PLAYERS; k++) {
      const s = lobbySpawnForIndex(k);
      if (this.players.every((q) => Math.hypot(q.x - s.x, q.y - s.y) > 0.9)) return k;
    }
    return this.players.length % MAX_PLAYERS;
  }

  respreadLobby() {
    if (this.phase !== 'lobby') return;
    this.players.forEach((p, i) => {
      const s = lobbySpawnForIndex(i);
      p.x = s.x;
      p.y = s.y;
      p.angle = s.angle;
      p.shown = { x: s.x, y: s.y, angle: s.angle };
      p.input = { mx: 0, my: 0, aim: p.input?.aim ?? null };
    });
  }

  /** One lobby physics step (from tick only, so speed never depends on how often phones send input). */
  stepLobby(dt) {
    let changed = false;
    for (const p of this.players) {
      if (!p.alive || p.bot) continue;
      const moving = p.input.mx || p.input.my;
      if (moving) {
        const [x, y] = clampToCage(
          p.x + p.input.mx * LOBBY_SPEED * dt,
          p.y + p.input.my * LOBBY_SPEED * dt,
          this.apothem,
          FIGHTER_R,
        );
        if (x !== p.x || y !== p.y) changed = true;
        p.x = x;
        p.y = y;
      }
      if (p.input.aim !== null && p.input.aim !== undefined) {
        const a = ((Number(p.input.aim) % 360) + 360) % 360;
        if (p.angle !== a) changed = true;
        p.angle = a;
      }
      p.shown = { x: p.x, y: p.y, angle: p.angle };
    }
    return changed;
  }

  customize(id, { color, laserColor, outfit, skin } = {}) {
    if (this.phase !== 'lobby') return { error: 'Can only customize in the lobby' };
    const p = this.get(id);
    if (!p || p.bot) return { error: 'Not found' };
    if (color && COLORS.includes(color)) {
      const taken = this.players.some((q) => q.id !== id && q.color === color);
      if (!taken) p.color = color;
    }
    if (laserColor && LASER_COLORS.includes(laserColor)) p.laserColor = laserColor;
    if (outfit && OUTFITS.includes(outfit)) p.outfit = outfit;
    if (skin && SKINS.includes(skin)) p.skin = skin;
    return { ok: true };
  }

  addBot() {
    const name = BOT_NAMES[botSeq++ % BOT_NAMES.length];
    return this.addPlayer(`bot-${botSeq}-${Math.floor(this.random() * 1e6)}`, name, { bot: true });
  }

  /** A phone dropped: keep the fighter (standing still) so the same phone can rejoin. */
  disconnect(id) {
    const p = this.get(id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.now();
    p.input = { mx: 0, my: 0, aim: null };
  }

  reconnect(id) {
    const p = this.get(id);
    if (!p) return;
    p.connected = true;
    p.disconnectedAt = 0;
  }

  /** Remove a fighter outright (host kick, or a lobby drop that never came back). */
  removePlayer(id) {
    const p = this.get(id);
    if (!p) return false;
    if (this.phase === 'lobby') {
      this.players = this.players.filter((q) => q.id !== id);
    } else {
      // Mid-match: take them out of the fight but keep the roster stable for the reveal/log.
      p.alive = false;
      p.connected = false;
      p.input = { mx: 0, my: 0, aim: null };
      if (!p.death) p.death = { cause: 'left', by: [], round: this.round };
    }
    return true;
  }

  /**
   * A player walks out of a running match: they count as eliminated ("left") but stay connected and in the room,
   * watching until the match ends. If that leaves one fighter (or none), the match ends right away.
   */
  forfeit(id) {
    const p = this.get(id);
    if (!p) return { error: 'Not found' };
    if (this.phase === 'lobby' || this.phase === 'over') return { error: 'No match running' };
    if (!p.alive) return { error: "You're already out of this match" };
    p.alive = false;
    p.input = { mx: 0, my: 0, aim: null };
    p.death = { cause: 'left', by: [], round: this.round };
    p.shown = { x: p.x, y: p.y, angle: p.angle };
    this.log.push(`${p.name} left the match`);
    const alive = this.alive;
    if (alive.length <= 1) {
      this.phase = 'over';
      this.winner = alive.length === 1 ? alive[0].id : null;
      if (alive.length === 1) alive[0].wins++;
    }
    return {};
  }

  /** Lobby only: drop phones that have been gone longer than the grace period. Returns removed ids. */
  sweepDisconnected(graceMs = LOBBY_GRACE_MS) {
    if (this.phase !== 'lobby') return [];
    const t = this.now();
    const gone = this.players.filter((p) => !p.bot && !p.connected && t - p.disconnectedAt > graceMs).map((p) => p.id);
    if (gone.length) this.players = this.players.filter((p) => !gone.includes(p.id));
    return gone;
  }

  get(id) { return this.players.find((p) => p.id === id); }
  get alive() { return this.players.filter((p) => p.alive); }

  start() {
    // Phones that dropped in the lobby don't get dragged into the match.
    const ready = this.players.filter((p) => p.bot || p.connected);
    if (ready.length < 2) return { error: 'Need at least 2 fighters — add a bot or wait for a friend' };
    this.players = ready;
    this.round = 0;
    this.apothem = this.nextApothem = START_APOTHEM;
    this.winner = null;
    this.lastReveal = null;
    this.log = [];
    this.suddenDeaths = 0;
    for (const p of this.players) p.points = 0;
    const n = this.players.length;
    const base = this.random() * Math.PI * 2;
    this.players.forEach((p, i) => {
      const a = base + (i * Math.PI * 2) / n;
      const x = C + Math.cos(a) * START_APOTHEM * 0.7;
      const y = C + Math.sin(a) * START_APOTHEM * 0.7;
      const angle = (Math.atan2(C - y, C - x) * 180) / Math.PI;
      Object.assign(p, { alive: true, death: null, x, y, angle, shown: { x, y, angle }, input: { mx: 0, my: 0, aim: null } });
    });
    this.beginAction();
    return {};
  }

  beginAction() {
    this.round++;
    this.phase = 'action';
    this.phaseEndsAt = this.now() + this.actionMs;
    this.lastTick = this.now();
    // From round 2 on, the cage contracts at every reveal.
    this.nextApothem = this.round >= 2 ? nextLayer(this.apothem) : this.apothem;
    for (const p of this.alive) if (p.bot) this.botPlan(p);
  }

  /** Live controller input from a phone: move vector (−1..1) and aim angle in degrees (or null to keep). */
  input(id, { mx, my, aim }) {
    const p = this.get(id);
    if (!p || !p.alive || (this.phase !== 'action' && this.phase !== 'lobby')) return;
    let x = Number(mx) || 0;
    let y = Number(my) || 0;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    p.input.mx = x;
    p.input.my = y;
    if (aim !== null && aim !== undefined && Number.isFinite(Number(aim))) p.input.aim = ((Number(aim) % 360) + 360) % 360;
  }

  /** Advance the simulation. Returns 'phase' when the public state changed, 'move' while fighters move, or null. */
  tick() {
    const t = this.now();
    const dt = Math.min(0.1, Math.max(0, (t - this.lastTick) / 1000));
    this.lastTick = t;
    if (this.phase === 'lobby') {
      // The lobby is always the full cage, whatever a previous match left behind.
      if (this.apothem !== START_APOTHEM) {
        this.apothem = this.nextApothem = START_APOTHEM;
        for (const p of this.players) p.alive = true;
        return 'phase';
      }
      return this.stepLobby(dt) ? 'move' : null;
    }
    if (this.phase === 'action') {
      for (const p of this.alive) {
        if (p.bot) this.botSteer(p);
        const [x, y] = clampToCage(p.x + p.input.mx * SPEED * dt, p.y + p.input.my * SPEED * dt, this.apothem, FIGHTER_R);
        p.x = x; p.y = y;
        if (p.input.aim !== null) p.angle = p.input.aim;
      }
      if (t >= this.phaseEndsAt) { this.reveal(); return 'phase'; }
      return 'move';
    }
    if (this.phase === 'reveal' && t >= this.phaseEndsAt) {
      if (this.alive.length === 0 && this.suddenDeaths < MAX_SUDDEN_DEATH) {
        // Nobody survived: no draw. Everyone eliminated in this reveal comes back and the fight goes on.
        this.reviveLastRound();
        this.beginAction();
        return 'phase';
      }
      if (this.alive.length === 0) {
        // Endless wipe-outs (very rare): the highest score among the last fighters wins.
        const last = this.players.filter((p) => p.death?.round === this.round);
        const best = Math.max(...last.map((p) => p.points));
        const top = last.filter((p) => p.points === best);
        top[Math.floor(this.random() * top.length)].alive = true;
      }
      const alive = this.alive;
      if (alive.length <= 1) {
        this.phase = 'over';
        this.winner = alive.length === 1 ? alive[0].id : null;
        if (alive.length === 1) alive[0].wins++;
      } else {
        this.beginAction();
      }
      return 'phase';
    }
    return null;
  }

  reveal() {
    const fighters = this.alive.map((p) => {
      p.shown = { x: p.x, y: p.y, angle: p.angle };
      p.input = { mx: 0, my: 0, aim: null };
      return { id: p.id, x: p.x, y: p.y, angle: p.angle };
    });
    // 1) Everyone fires at once, on the full current platform.
    // 2) Once the lasers clear, the marked layer drops under whoever is still on it, and the next layer is marked.
    const prevApothem = this.apothem;
    const { shots, deaths } = resolveReveal(fighters, prevApothem);
    this.apothem = this.nextApothem;
    const shrunk = this.apothem < prevApothem;
    for (const f of fighters) if (!deaths.has(f.id) && !insideCage(f.x, f.y, this.apothem)) deaths.set(f.id, { cause: 'out', by: [] });
    // Points: +5 to every shooter whose laser terminated someone, +1 to everyone who survives this reveal.
    for (const d of deaths.values()) if (d.cause === 'laser') for (const b of d.by) this.get(b).points += POINTS_HIT;
    for (const f of fighters) if (!deaths.has(f.id)) this.get(f.id).points += POINTS_SURVIVE;
    for (const [id, d] of deaths) {
      const p = this.get(id);
      p.alive = false;
      p.death = { cause: d.cause, by: d.by, round: this.round };
      const by = d.by.map((b) => this.get(b)?.name).join(' & ');
      this.log.push(d.cause === 'laser' ? `${p.name} terminated by ${by}` : d.cause === 'clash' ? `${p.name} clashed with ${by}` : `${p.name} fell with the layer`);
    }
    const upcoming = nextLayer(this.apothem);
    this.lastReveal = {
      round: this.round, shots, deaths: [...deaths].map(([id, d]) => ({ id, ...d })), shrunk, fallMs: 0,
      prevApothem, dropAtMs: shrunk ? SHOTS_MS : null, upcoming,
    };
    this.phase = 'reveal';
    this.phaseEndsAt = this.now() + this.revealMs + (shrunk ? DROP_MS : 0);
  }

  /** Sudden death: bring back everyone eliminated in the last reveal, standing safely on the current platform. */
  reviveLastRound() {
    this.suddenDeaths++;
    const back = this.players.filter((p) => p.death?.round === this.round);
    const n = back.length;
    const base = this.random() * Math.PI * 2;
    back.forEach((p, i) => {
      // Keep their spot if it's still on the platform, otherwise spread them around the remaining floor.
      if (!insideCage(p.x, p.y, this.apothem, FIGHTER_R + 0.05)) {
        const a = base + (i * Math.PI * 2) / n;
        const r = Math.max(0.3, this.apothem - FIGHTER_R - 0.35);
        p.x = C + Math.cos(a) * r;
        p.y = C + Math.sin(a) * r;
      }
      p.alive = true;
      p.death = null;
      p.shown = { x: p.x, y: p.y, angle: p.angle };
    });
    this.log.push(`No survivors — ${back.map((p) => p.name).join(', ')} fight on!`);
  }

  /** Names of human players from this match whose phones are no longer connected. */
  missingPlayers() {
    return this.players.filter((p) => !p.bot && !p.connected).map((p) => p.name);
  }

  /**
   * Rematch only when every human from the last match is still here. Otherwise nothing changes and the caller
   * gets {missing:[names]} so it can tell everyone before sending them to the lobby.
   */
  rematch() {
    const missing = this.missingPlayers();
    if (missing.length) return { missing };
    if (!this.players.some((p) => !p.bot)) return { missing: [] }; // nobody to play with
    this.phase = 'lobby';
    return this.start();
  }

  backToLobby() {
    this.phase = 'lobby';
    this.round = 0;
    this.apothem = this.nextApothem = START_APOTHEM;
    this.winner = null;
    this.lastReveal = null;
    this.phaseEndsAt = 0;
    this.players = this.players.filter((p) => !p.bot && (p.connected || this.now() - p.disconnectedAt < LOBBY_GRACE_MS));
    for (const p of this.players) {
      Object.assign(p, {
        alive: true,
        death: null,
        botPlan: null,
        input: { mx: 0, my: 0, aim: null },
      });
    }
    this.respreadLobby();
    this.lastTick = this.now();
    this.log = [...this.log.slice(-4), 'Everyone returned to the lobby'];
    return { ok: true };
  }

  /** Bot plan for this action phase: a destination inside the next cage and a rival to aim at. */
  botPlan(p) {
    const r = Math.max(0.3, this.nextApothem - FIGHTER_R - 0.3) * Math.sqrt(this.random());
    const a = this.random() * Math.PI * 2;
    const rivals = this.alive.filter((q) => q.id !== p.id);
    const target = rivals[Math.floor(this.random() * rivals.length)] || null;
    p.botPlan = { tx: C + Math.cos(a) * r, ty: C + Math.sin(a) * r, target: target?.id, lead: (this.random() - 0.5) * 1.6 };
  }

  botSteer(p) {
    const plan = p.botPlan;
    if (!plan) return;
    const dx = plan.tx - p.x;
    const dy = plan.ty - p.y;
    const d = Math.hypot(dx, dy);
    p.input.mx = d > 0.1 ? dx / d : 0;
    p.input.my = d > 0.1 ? dy / d : 0;
    const t = this.get(plan.target);
    if (t) {
      // Rivals tend to drift toward the centre, so lead the last-seen spot slightly inward.
      const gx = t.shown.x + (C - t.shown.x) * 0.25 + plan.lead;
      const gy = t.shown.y + (C - t.shown.y) * 0.25 - plan.lead;
      p.input.aim = ((Math.atan2(gy - p.y, gx - p.x) * 180) / Math.PI + 360) % 360;
    }
  }

  /** What a given phone may see about itself (live, secret). */
  privateView(id) {
    const p = this.get(id);
    return p ? { x: p.x, y: p.y, angle: p.angle, alive: p.alive } : null;
  }

  /** State everyone may see. During ACTION only last-revealed positions are included. */
  publicState() {
    return {
      phase: this.phase,
      round: this.round,
      apothem: this.apothem,
      nextApothem: this.phase === 'action' ? this.nextApothem : this.apothem,
      center: C,
      msLeft: this.phase === 'lobby' ? 0 : Math.max(0, this.phaseEndsAt - this.now()),
      winner: this.phase === 'lobby' ? null : this.winner,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, laserColor: p.laserColor || LASER_COLORS[0], outfit: p.outfit || OUTFITS[0], skin: p.skin || SKINS[0], bot: p.bot, alive: p.alive, wins: p.wins, points: p.points || 0, connected: p.connected,
        death: p.death,
        x: this.phase === 'lobby' ? p.x : p.shown.x,
        y: this.phase === 'lobby' ? p.y : p.shown.y,
        angle: this.phase === 'lobby' ? p.angle : p.shown.angle,
      })),
      reveal: this.phase === 'reveal' || this.phase === 'over' ? this.lastReveal : null,
      log: this.log.slice(-6),
    };
  }
}
