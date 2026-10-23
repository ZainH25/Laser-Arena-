// Shared constants and helpers for every 3D UI module.
import * as THREE from 'three';

/** Stage layer sizes (octagon apothems, outer → inner). MUST match STAGE_LAYERS in src/engine.js. */
export const STAGE_LAYERS = [4.5, 3.45, 2.4, 1.35];
export const FULL_APO = STAGE_LAYERS[0];
/** Thickness of a stage layer; fighters stand on y = LAYER_THICK. */
export const LAYER_THICK = 0.095;
export const LASER_COLOR = '#5dbd6a';
export const LASER_CORE = '#7ed492';

/** Regular octagon (flat edges facing ±x / ±z after rotation) with the given apothem, as a THREE.Shape. */
export function octagonShape(apothem) {
  const r = apothem / Math.cos(Math.PI / 8);
  const s = new THREE.Shape();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    (k ? s.lineTo : s.moveTo).call(s, Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** Octagon ring (outer apothem → inner apothem) as a flat THREE.Shape with a hole. */
export function octagonRing(outer, inner) {
  const s = octagonShape(outer);
  if (inner > 0) s.holes.push(new THREE.Path(octagonShape(inner).getPoints()));
  return s;
}

/** Texture drawn with a 2D canvas callback. */
export function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Frees every geometry and material under an object. */
export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
