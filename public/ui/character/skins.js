// Fighter suit skins: procedural textures (drawn once on a canvas, no image files) for the mannequin body and its
// rifle. The mannequin's shape, pose, team-colour accents and gear never change — a skin only re-dresses it.
// Ids must match SKINS in src/engine.js.
import * as THREE from 'three';
import { canvasTexture } from '../shared/common.js';

const S = 512;
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ pattern painters (all tile seamlessly enough)

/** Square pixel camo (digital). */
function pixels(g, palette, cell = 16) {
  g.fillStyle = palette[0];
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = palette[1 + Math.floor(Math.random() * (palette.length - 1))];
    const x = Math.floor(Math.random() * (S / cell)) * cell;
    const y = Math.floor(Math.random() * (S / cell)) * cell;
    g.fillRect(x, y, cell * (1 + Math.floor(Math.random() * 3)), cell * (1 + Math.floor(Math.random() * 2)));
  }
}

/** Organic blob camo (desert / woodland / sandstone base). */
function blobs(g, palette, n = 70, size = [30, 90]) {
  g.fillStyle = palette[0];
  g.fillRect(0, 0, S, S);
  for (let layer = 1; layer < palette.length; layer++) {
    g.fillStyle = palette[layer];
    for (let i = 0; i < n / layer; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = rnd(size[0], size[1]) / Math.sqrt(layer);
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * rnd(0.55, 1.15);
        g.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    }
  }
}

/** Carbon-fibre weave on a dark base. */
function carbon(g, base, light) {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const c = 16;
  for (let y = 0; y < S; y += c) {
    for (let x = 0; x < S; x += c) {
      const grd = (x / c + y / c) % 2 ? g.createLinearGradient(x, y, x + c, y) : g.createLinearGradient(x, y, x, y + c);
      grd.addColorStop(0, base);
      grd.addColorStop(0.5, light);
      grd.addColorStop(1, base);
      g.fillStyle = grd;
      g.fillRect(x + 1, y + 1, c - 2, c - 2);
    }
  }
}

/** Circuit traces (lines with right-angle turns and pads). Drawn in `color` on transparent / black. */
function circuits(g, color, width = 4, n = 26) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = Math.random() * S;
    let y = Math.random() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      const len = rnd(30, 110);
      const dir = Math.floor(Math.random() * 4);
      if (dir === 0) x += len; else if (dir === 1) x -= len; else if (dir === 2) y += len; else y -= len;
      if (Math.random() < 0.4) { x += len * 0.4; y += len * 0.4; } // 45° jog
      g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath(); g.arc(x, y, width * 1.6, 0, Math.PI * 2); g.fill();
  }
}

/** Cracks (magma, sandstone): random branching jagged lines. */
function cracks(g, color, width, n = 30) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    let x = Math.random() * S;
    let y = Math.random() * S;
    let a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      a += rnd(-0.9, 0.9);
      x += Math.cos(a) * rnd(15, 45);
      y += Math.sin(a) * rnd(15, 45);
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

function noise(g, amount) {
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function black(g) { g.fillStyle = '#000'; g.fillRect(0, 0, S, S); }

// ------------------------------------------------------------------ the skins
// body: { map, emissiveMap?, emissive?, rough, metal, coat?, irid?, opacity?, metalMap? }   gun: { color | map, emissive? }

export const SKINS = [
  { id: 'mannequin', name: 'Mannequin', swatch: ['#f0f0ec', '#d8d8d2'] },
  {
    id: 'digital', name: 'Digital Camo', swatch: ['#c9d3dc', '#5f7489'],
    body: () => ({ map: (g) => { pixels(g, ['#d4dde5', '#9fb0c0', '#6c8196', '#eef2f5', '#4d6175']); }, rough: 0.7, metal: 0 }),
    gun: { color: '#b9c3cc', rough: 0.45, metal: 0.6 },
  },
  {
    id: 'carbon', name: 'Carbon Circuit', swatch: ['#15181c', '#3fe0ff'],
    body: () => ({ map: (g) => { carbon(g, '#111316', '#2a2e34'); }, emissiveMap: (g) => { black(g); circuits(g, '#fff', 3); }, emissive: '#36d6ff', rough: 0.35, metal: 0.3, coat: 0.6 }),
    gun: { color: '#111316', rough: 0.35, metal: 0.7, emissive: '#36d6ff' },
  },
  {
    id: 'toxic', name: 'Toxic Circuit', swatch: ['#1b1f1b', '#7dff3a'],
    body: () => ({
      map: (g) => { g.fillStyle = '#1d211e'; g.fillRect(0, 0, S, S); noise(g, 10);
        // hazard stripes band
        for (let x = -S; x < S * 2; x += 24) { g.fillStyle = (x / 24) % 2 ? '#d8c21a' : '#111'; g.beginPath(); g.moveTo(x, 230); g.lineTo(x + 12, 230); g.lineTo(x + 28, 254); g.lineTo(x + 16, 254); g.fill(); } },
      emissiveMap: (g) => { black(g); circuits(g, '#fff', 4); }, emissive: '#6dff2e', rough: 0.8, metal: 0,
    }),
    gun: { color: '#1a1d1a', rough: 0.5, metal: 0.5, emissive: '#6dff2e' },
  },
  {
    id: 'desert', name: 'Desert Camo', swatch: ['#cbbd9a', '#7d6c4f'],
    body: () => ({ map: (g) => { blobs(g, ['#d2c4a0', '#b5a27c', '#8f7c5a', '#efe4c8'], 60, [25, 70]); noise(g, 12); }, rough: 0.85, metal: 0 }),
    gun: { color: '#8d7b5c', rough: 0.55, metal: 0.4 },
  },
  {
    id: 'marble', name: 'Marble Gold', swatch: ['#f2f1ee', '#c9a24a'],
    body: () => ({
      map: (g) => {
        g.fillStyle = '#f1f0ec'; g.fillRect(0, 0, S, S);
        g.globalAlpha = 0.35; cracks(g, '#9a9a9a', 1.5, 40); g.globalAlpha = 1;
        g.fillStyle = '#caa24a'; // gold armour plates + inlay lines
        for (let i = 0; i < 6; i++) g.fillRect(rnd(0, S), rnd(0, S), rnd(60, 120), rnd(40, 90));
        g.strokeStyle = '#d4ad55'; g.lineWidth = 6;
        for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(rnd(0, S), 0); g.lineTo(rnd(0, S), S); g.stroke(); }
      },
      rough: 0.25, metal: 0.25, coat: 0.9,
    }),
    gun: { color: '#14151a', rough: 0.3, metal: 0.8, accent: '#d4ad55' },
  },
  {
    id: 'magma', name: 'Magma', swatch: ['#1c1412', '#ff6a1a'],
    body: () => ({
      map: (g) => { g.fillStyle = '#1d1715'; g.fillRect(0, 0, S, S); noise(g, 30); cracks(g, '#ff7a1a', 4, 45); },
      emissiveMap: (g) => { black(g); cracks(g, '#fff', 5, 45); }, emissive: '#ff5a10', rough: 0.9, metal: 0,
    }),
    gun: { color: '#1c1614', rough: 0.6, metal: 0.5, emissive: '#ff5a10' },
  },
  {
    id: 'neon', name: 'Neon Purple', swatch: ['#1c1838', '#ff3df0'],
    body: () => ({ map: (g) => { carbon(g, '#1a1733', '#2e2a55'); }, emissiveMap: (g) => { black(g); circuits(g, '#fff', 4); }, emissive: '#ff38e8', rough: 0.4, metal: 0.2, coat: 0.5 }),
    gun: { color: '#16142a', rough: 0.4, metal: 0.6, emissive: '#ff38e8' },
  },
  {
    id: 'crimson', name: 'Crimson Circuit', swatch: ['#1a1416', '#ff3a3a'],
    body: () => ({ map: (g) => { carbon(g, '#181315', '#30262a'); }, emissiveMap: (g) => { black(g); circuits(g, '#fff', 3); }, emissive: '#ff3030', rough: 0.35, metal: 0.3, coat: 0.6 }),
    gun: { color: '#1a1416', rough: 0.35, metal: 0.7, emissive: '#ff3030' },
  },
  {
    id: 'galaxy', name: 'Galaxy', swatch: ['#1b1748', '#8e7bff'],
    body: () => ({
      map: (g) => {
        g.fillStyle = '#0d0b26'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 26; i++) {
          const x = rnd(0, S); const y = rnd(0, S); const r = rnd(40, 140);
          const grd = g.createRadialGradient(x, y, 0, x, y, r);
          grd.addColorStop(0, ['rgba(120,90,255,0.55)', 'rgba(60,110,255,0.45)', 'rgba(200,120,255,0.4)'][i % 3]);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
        }
      },
      emissiveMap: (g) => {
        black(g);
        for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.3, 1)})`; g.fillRect(rnd(0, S), rnd(0, S), rnd(1, 2.6), rnd(1, 2.6)); }
      },
      emissive: '#d8d2ff', rough: 0.3, metal: 0.1, coat: 0.8,
    }),
    gun: { color: '#15122e', rough: 0.35, metal: 0.6, emissive: '#8e7bff' },
  },
  {
    id: 'crystal', name: 'Crystal', swatch: ['#dff6ff', '#5ef2ff'],
    body: () => ({
      map: (g) => { g.fillStyle = '#e8f6ff'; g.fillRect(0, 0, S, S); },
      emissiveMap: (g) => { black(g); g.strokeStyle = '#fff'; g.lineWidth = 2.5; for (let i = 0; i < 30; i++) { g.beginPath(); g.moveTo(rnd(0, S), rnd(0, S)); g.lineTo(rnd(0, S), rnd(0, S)); g.stroke(); } },
      emissive: '#43e8ff', rough: 0.05, metal: 0.1, coat: 1, irid: 1, opacity: 0.6,
    }),
    gun: { color: '#c8d4e0', rough: 0.15, metal: 0.9, emissive: '#43e8ff' },
  },
  {
    id: 'woodland', name: 'Woodland Camo', swatch: ['#56703f', '#2c2a1e'],
    body: () => ({ map: (g) => { blobs(g, ['#6f8a52', '#4a6436', '#2d3324', '#8a8a5a'], 70, [25, 75]); noise(g, 10); }, rough: 0.85, metal: 0 }),
    gun: { color: '#5a5a40', rough: 0.55, metal: 0.4 },
  },
  {
    id: 'overgrown', name: 'Overgrown', swatch: ['#5e6b45', '#3f8a2e'],
    body: () => ({
      map: (g) => {
        g.fillStyle = '#6b6650'; g.fillRect(0, 0, S, S); noise(g, 20);
        blobs(g, ['rgba(0,0,0,0)', '#3d7a2a', '#5a9a3a', '#2c5a1f'], 50, [20, 60]);
        g.strokeStyle = '#3b3320'; g.lineWidth = 3; // vines
        for (let i = 0; i < 18; i++) { g.beginPath(); g.moveTo(rnd(0, S), rnd(0, S)); g.bezierCurveTo(rnd(0, S), rnd(0, S), rnd(0, S), rnd(0, S), rnd(0, S), rnd(0, S)); g.stroke(); }
      },
      rough: 0.95, metal: 0,
    }),
    gun: { color: '#26291f', rough: 0.7, metal: 0.3 },
  },
  {
    id: 'sandstone', name: 'Sandstone', swatch: ['#d7bf92', '#9c825a'],
    body: () => ({ map: (g) => { blobs(g, ['#d8c095', '#c9ae80', '#e4d0a8'], 40, [40, 110]); noise(g, 22); cracks(g, 'rgba(120,95,60,0.55)', 2, 30); }, rough: 0.95, metal: 0 }),
    gun: { color: '#c8ad80', rough: 0.8, metal: 0.1 },
  },
];

export const SKIN_IDS = SKINS.map((s) => s.id);
const cache = new Map();

/** Textures for a skin, made once and shared by every fighter wearing it. */
function texturesFor(skin) {
  if (cache.has(skin.id)) return cache.get(skin.id);
  const b = skin.body();
  const map = canvasTexture(S, S, b.map, { repeat: true });
  const emissiveMap = b.emissiveMap ? canvasTexture(S, S, b.emissiveMap, { repeat: true }) : null;
  for (const t of [map, emissiveMap]) if (t) t.repeat.set(2, 2);
  const out = { b, map, emissiveMap };
  cache.set(skin.id, out);
  return out;
}

/** Body material for a skin (the default mannequin keeps its satin white vinyl). */
export function skinBodyMaterial(id) {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin || !skin.body) return null;
  const { b, map, emissiveMap } = texturesFor(skin);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map, roughness: b.rough, metalness: b.metal,
    clearcoat: b.coat || 0, clearcoatRoughness: 0.25,
    emissive: b.emissive ? new THREE.Color(b.emissive) : new THREE.Color('#000'), emissiveMap, emissiveIntensity: b.emissive ? 1.6 : 0,
    iridescence: b.irid || 0, iridescenceIOR: 1.5,
    transparent: (b.opacity ?? 1) < 1, opacity: b.opacity ?? 1,
  });
  mat.userData.glow = mat.emissiveIntensity; // restored when a fighter is alive again
  return mat;
}

/** Rifle look for a skin: body colour/finish and a glowing accent strip colour (or null). */
export function skinGun(id) {
  const skin = SKINS.find((s) => s.id === id);
  return skin?.gun || null;
}
