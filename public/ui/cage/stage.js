// The fighting stage: concentric octagon layers of frosted steel plate, each with its own perforation pattern.
//
// Accuracy rules (the whole point of this module):
//  • A layer is removed ONLY when the game's cage size is smaller than that layer's outer edge. Sizes come from the
//    same layer list as the engine, so the drawn edge and the game boundary are always identical.
//  • The warning overlay covers EXACTLY the ring between the current size and the next size — the layer that will go.
//  • A removed layer sinks into a deep, dark pit and fades out in ~0.6 s. Every layer is a tall steel block, so what
//    is left stands as a pillar — a missing layer can never be mistaken for floor.
import * as THREE from 'three';
import { STAGE_LAYERS, FULL_APO, LAYER_THICK, octagonShape, octagonRing, canvasTexture } from '../shared/common.js';

const DROP_TIME = 0.6;
export const PIT_DEPTH = 2.6; // pit floor, far below the hall floor (see cage/environment.js)
const EXTENT = FULL_APO + 0.1; // the plate textures cover ±EXTENT world units

/** Perforation pattern per layer, outermost first; extra layers (if the list ever grows) reuse the bar grating. */
const PATTERNS = ['slots', 'hexmesh', 'holes', 'solid'];
const EXTRA = ['slots', 'hexmesh', 'holes', 'grating'];
// A faint tint per layer so neighbouring layers still read apart at a glance (all stay steel).
const TINTS = { slots: '#8a96a3', hexmesh: '#7f8b97', holes: '#929da8', grating: '#86919c', solid: '#9ca6b0' };

function patternsFor(count) {
  if (count === 4) return PATTERNS;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 'solid' : EXTRA[i % 4]));
}

// ------------------------------------------------------------------ plate textures (drawn in world space, top view)

/** Octagon corners in canvas pixels for apothem `a`. */
function octPts(a, toPx) {
  const r = a / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, k) => {
    const ang = Math.PI / 8 + (k * Math.PI) / 4;
    return toPx(Math.cos(ang) * r, Math.sin(ang) * r);
  });
}

function octPath(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 8; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** Frosted, brushed steel, drawn once per texture size and reused by every layer (fast startup). */
const baseCache = new Map();
function steelBase(g, S, tint) {
  if (!baseCache.has(S)) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    drawSteel(c.getContext('2d'), S);
    baseCache.set(S, c);
  }
  g.fillStyle = tint;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'overlay'; // the layer's tint shows through the shared steel detail
  g.drawImage(baseCache.get(S), 0, 0);
  g.globalCompositeOperation = 'source-over';
}

/** Neutral steel detail: fine noise, cloudy patches and faint scratches around mid grey. */
function drawSteel(g, S) {
  const tint = '#808080';
  g.fillStyle = tint;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = S * (0.02 + Math.random() * 0.08);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const light = Math.random() < 0.6;
    grd.addColorStop(0, light ? 'rgba(255,255,255,0.22)' : 'rgba(40,50,60,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 10 + Math.random() * 60;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}

/** A punched hole: dark inside with a bright lower lip, so it reads as cut through thick plate. */
function hole(g, x, y, rx, ry, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = '#0b0d10';
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = Math.max(1, Math.min(rx, ry) * 0.25);
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.restore();
}

/**
 * For each of the 8 sides: call fn(t, r, place) over a grid in that side's local frame, where `r` runs from the inner
 * edge to the outer edge and `t` along the side; place(t, r) gives canvas px. Panels keep a margin from the seams.
 */
function perSide(outer, inner, toPx, stepR, stepT, fn) {
  for (let k = 0; k < 8; k++) {
    const mid = (k * Math.PI) / 4;
    const nx = Math.cos(mid);
    const nz = Math.sin(mid);
    const place = (t, r) => toPx(nx * r - nz * t, nz * r + nx * t);
    const margin = 0.09;
    let row = 0;
    for (let r = inner + margin + stepR / 2; r <= outer - margin - stepR / 2 + 1e-6; r += stepR, row++) {
      const half = r * Math.tan(Math.PI / 8) - margin - 0.07; // panel half-width at this radius (keep off the seams)
      const n = Math.floor((2 * half) / stepT);
      for (let i = 0; i <= n; i++) {
        const t = -((n * stepT) / 2) + i * stepT + (row % 2 ? stepT / 2 : 0);
        if (Math.abs(t) > half) continue;
        fn(t, r, place, mid);
      }
    }
  }
}

function drawPattern(g, kind, outer, inner, toPx, ppu) {
  if (kind === 'slots') {
    // Rows of long oval slots, pointing at the centre (outer ring in the reference).
    perSide(outer, inner, toPx, 0.32, 0.22, (t, r, place, mid) => {
      const [x, y] = place(t, r);
      hole(g, x, y, 0.07 * ppu, 0.13 * ppu, mid + Math.PI / 2);
    });
  } else if (kind === 'holes') {
    perSide(outer, inner, toPx, 0.17, 0.17, (t, r, place) => {
      const [x, y] = place(t, r);
      hole(g, x, y, 0.055 * ppu, 0.055 * ppu, 0);
    });
  } else if (kind === 'grating') {
    // Bar grating: dark slots between bars, running along each side.
    perSide(outer, inner, toPx, 0.12, 0.6, (t, r, place, mid) => {
      const [x, y] = place(t, r);
      g.save();
      g.translate(x, y);
      g.rotate(mid + Math.PI / 2);
      g.fillStyle = '#0d0f12';
      g.fillRect(-0.27 * ppu, -0.03 * ppu, 0.54 * ppu, 0.06 * ppu);
      g.restore();
    });
  } else if (kind === 'hexmesh') {
    // Fine hexagonal perforated mesh over the whole ring, inside a solid frame.
    const pitch = 0.11 * ppu;
    g.save();
    g.beginPath();
    octPath(g, octPts(outer - 0.12, toPx));
    octPath(g, octPts(inner + 0.12, toPx));
    g.clip('evenodd');
    g.fillStyle = '#5d6772';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    for (let y = 0, row = 0; y < g.canvas.height + pitch; y += pitch * 0.866, row++) {
      for (let x = row % 2 ? pitch / 2 : 0; x < g.canvas.width + pitch; x += pitch) {
        g.fillStyle = '#0a0c0f';
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          g.lineTo(x + Math.cos(a) * pitch * 0.4, y + Math.sin(a) * pitch * 0.4);
        }
        g.fill();
      }
    }
    g.restore();
  } else if (kind === 'solid') {
    // Centre: a hexagon of six triangular plates, ringed by a band of hex mesh.
    const hr = inner > 0 ? 0 : outer * 0.82;
    const [cx, cy] = toPx(0, 0);
    const hexPts = Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3;
      return toPx(Math.cos(a) * hr, Math.sin(a) * hr);
    });
    g.save();
    g.beginPath();
    octPath(g, octPts(outer - 0.06, toPx));
    g.moveTo(...hexPts[0]);
    for (const p of hexPts.slice(1)) g.lineTo(...p);
    g.closePath();
    g.clip('evenodd');
    const pitch = 0.075 * ppu;
    g.fillStyle = '#0a0c0f';
    for (let y = 0, row = 0; y < g.canvas.height; y += pitch * 0.866, row++) {
      for (let x = row % 2 ? pitch / 2 : 0; x < g.canvas.width; x += pitch) {
        g.beginPath(); g.arc(x, y, pitch * 0.32, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    g.strokeStyle = 'rgba(15,18,22,0.85)';
    g.lineWidth = Math.max(2, 0.018 * ppu);
    g.beginPath();
    g.moveTo(...hexPts[0]);
    for (const p of hexPts.slice(1)) g.lineTo(...p);
    g.closePath();
    for (const p of hexPts) { g.moveTo(cx, cy); g.lineTo(...p); }
    g.stroke();
  }
}

/** One layer's plate texture covering the whole stage area (only its own ring is ever shown). */
function plateTexture(kind, outer, inner, size) {
  const ppu = size / (2 * EXTENT);
  const toPx = (x, z) => [(x + EXTENT) * ppu, (z + EXTENT) * ppu];
  const tex = canvasTexture(size, size, (g) => {
    steelBase(g, size, TINTS[kind]);
    drawPattern(g, kind, outer, inner, toPx, ppu);
    // Panel seams: radial joints at the 8 corners plus the ring's inner and outer edges.
    g.strokeStyle = 'rgba(12,14,18,0.9)';
    g.lineWidth = Math.max(2, 0.02 * ppu);
    const o = octPts(outer, toPx);
    const iPts = inner > 0 ? octPts(inner, toPx) : null;
    g.beginPath();
    octPath(g, o);
    if (iPts) {
      octPath(g, iPts);
      for (let k = 0; k < 8; k++) { g.moveTo(...iPts[k]); g.lineTo(...o[k]); }
    }
    g.stroke();
    // Bolt heads in each panel corner.
    g.fillStyle = 'rgba(30,34,40,0.8)';
    const boltR = Math.max(1.5, 0.022 * ppu);
    for (let k = 0; k < 8; k++) {
      for (const [pts, inset] of [[o, 0.93], ...(iPts ? [[iPts, 1.07]] : [])]) {
        const [x, y] = pts[k];
        const [cx, cy] = toPx(0, 0);
        g.beginPath(); g.arc(cx + (x - cx) * inset, cy + (y - cy) * inset, boltR, 0, Math.PI * 2); g.fill();
      }
    }
  });
  // ExtrudeGeometry cap UVs are the shape's own (x, y) in world units → map ±EXTENT onto 0..1.
  tex.repeat.set(1 / (2 * EXTENT), 1 / (2 * EXTENT));
  tex.offset.set(0.5, 0.5);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function hazardTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#ff2b4a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a0008';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 32 + h, h); g.lineTo(i * 64 + h, h);
      g.closePath();
      g.fill();
    }
  }, { repeat: true });
}

export class Stage {
  /** @param {{phone?: boolean}} opts  phones get smaller textures */
  constructor(opts = {}) {
    this.texSize = opts.phone ? 1024 : 2048;
    this.group = new THREE.Group();
    this.apothem = FULL_APO;
    this.layerSizes = [];
    this.layers = [];
    this.sideMat = new THREE.MeshStandardMaterial({ color: '#2a3038', roughness: 0.55, metalness: 0.75 });
    this.setLayers(STAGE_LAYERS);
    this.buildPit();
    this.buildRim();
    this.buildWarning();
  }

  /** Where fighters stand. */
  get standY() { return LAYER_THICK; }

  /** Rebuild the platform from a list of layer sizes (outermost first). No-op if unchanged. */
  setLayers(sizes) {
    if (sizes.join() === this.layerSizes.join()) return;
    for (const L of this.layers) {
      this.group.remove(L.group);
      L.group.traverse((o) => { o.geometry?.dispose(); });
      L.top.map?.dispose();
      L.mats.forEach((m) => m.dispose());
    }
    this.layerSizes = [...sizes];
    const kinds = patternsFor(sizes.length);
    this.layers = sizes.map((outer, i) => this.buildLayer(outer, sizes[i + 1] || 0, kinds[i]));
    this.setApothem(this.apothem);
  }

  buildLayer(outer, inner, kind) {
    const map = plateTexture(kind, outer, inner, this.texSize);
    const top = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 3, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.8 });
    // A tall steel block from the deck down to the pit floor: when the layer outside it drops, its side shows.
    const geo = new THREE.ExtrudeGeometry(octagonRing(outer, inner), { depth: LAYER_THICK + PIT_DEPTH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -PIT_DEPTH, 0);
    const side = this.sideMat.clone(); // per layer, so the whole block fades when it drops
    const mesh = new THREE.Mesh(geo, [top, side]); // groups: 0 = caps, 1 = sides
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    this.group.add(g);
    return { outer, group: g, top, mats: [top, side], state: 'up', t: 0 };
  }

  buildPit() {
    const floorGeo = new THREE.ShapeGeometry(octagonShape(FULL_APO + 0.3));
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 1 }));
    floor.position.y = -PIT_DEPTH;
    this.group.add(floor);
  }

  buildRim() {
    // Thin bright edge on the live boundary, so players can always see exactly where the floor ends.
    const geo = new THREE.ShapeGeometry(octagonRing(1, 0.99));
    geo.rotateX(-Math.PI / 2);
    this.rim = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9f2ff').multiplyScalar(1.1), toneMapped: false }));
    this.rim.position.y = LAYER_THICK + 0.006;
    this.group.add(this.rim);
  }

  buildWarning() {
    this.hazardTex = hazardTexture();
    this.warnMat = new THREE.MeshBasicMaterial({ map: this.hazardTex, transparent: true, opacity: 0.6, depthWrite: false });
    this.warn = new THREE.Mesh(new THREE.BufferGeometry(), this.warnMat);
    this.warn.position.y = LAYER_THICK + 0.008;
    this.warn.visible = false;
    this.warnEdgeMat = new THREE.MeshBasicMaterial({ color: '#ff2b4a' });
    this.warnEdge = new THREE.Mesh(new THREE.BufferGeometry(), this.warnEdgeMat);
    this.warnEdge.position.y = LAYER_THICK + 0.01;
    this.warnEdge.visible = false;
    this.group.add(this.warn, this.warnEdge);
    this.warnKey = '';
  }

  /** Current game cage size. Removes exactly the layers bigger than it; restores layers when it grows (lobby). */
  setApothem(apothem) {
    this.apothem = apothem;
    for (const L of this.layers) {
      const gone = apothem < L.outer - 1e-3;
      if (gone && L.state === 'up') { L.state = 'dropping'; L.start = null; L.mats.forEach((m) => { m.transparent = true; }); }
      if (!gone && L.state !== 'up') this.restore(L);
    }
    if (!this.rim) return; // still constructing
    this.rim.scale.set(apothem, 1, apothem);
  }

  restore(L) {
    L.state = 'up';
    L.group.visible = true;
    L.group.position.y = 0;
    L.mats.forEach((m) => { m.opacity = 1; m.transparent = false; });
  }

  /** Show (or hide) the warning on exactly the ring between `outer` (current size) and `inner` (next size). */
  setWarning(active, outer, inner) {
    const show = active && inner < outer - 1e-3;
    this.warn.visible = this.warnEdge.visible = show;
    if (!show) return;
    // Plain, light red zone (no stripes) in both modes.
    if (!this.warnPlain) {
      this.warnPlain = true;
      this.warnMat.map = null;
      this.warnMat.color.set('#ff7d8e');
      this.warnEdgeMat.color.set('#ff9aa8');
      this.warnMat.needsUpdate = true;
    }
    const key = `${outer}/${inner}`;
    if (key === this.warnKey) return;
    this.warnKey = key;
    this.warn.geometry.dispose();
    const g = new THREE.ShapeGeometry(octagonRing(outer, inner));
    g.rotateX(-Math.PI / 2);
    // Stripe texture in world units.
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * 1.2);
    this.warn.geometry = g;
    this.warnEdge.geometry.dispose();
    const e = new THREE.ShapeGeometry(octagonRing(inner + 0.05, inner));
    e.rotateX(-Math.PI / 2);
    this.warnEdge.geometry = e;
  }

  update(dt, t) {
    for (const L of this.layers) {
      if (L.state !== 'dropping') continue;
      // Wall-clock based: the layer is fully gone DROP_TIME after the shrink, however slowly frames arrive.
      if (L.start === null) L.start = t;
      const k = Math.min(1, (t - L.start) / DROP_TIME);
      L.group.position.y = -k * k * 1.6;
      L.mats.forEach((m) => { m.opacity = 1 - k; });
      if (k >= 1) { L.state = 'gone'; L.group.visible = false; }
    }
    if (this.warn.visible) {
      this.warnMat.opacity = 0.55 + 0.07 * Math.sin(t * 3); // gentle pulse
    }
  }
}
