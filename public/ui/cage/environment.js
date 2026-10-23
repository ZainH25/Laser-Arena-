// Everything around the stage: an industrial concrete hall, the plinth and deep pit the cage stands in, steel crowd
// barriers, scaffold light towers and the dark steel cage with padded rails.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FULL_APO, canvasTexture, octagonRing, octagonShape } from '../shared/common.js';
import { PIT_DEPTH } from './stage.js';

const FENCE_H = 1.72;
const GROUND_Y = -0.82;
const PLINTH_TOP = 0.08; // fence panels start here
const PLINTH_OUT = FULL_APO + 0.95;
export const HORIZON = '#4d535b'; // fog / background: the hall's far walls
const HALL_R = 26;
const HALL_H = 16;

/** Grey concrete: noise, soft stains and slab joints every `joint` texture fractions. */
function concreteTexture(size, base, spread, repeat, joints = 4) {
  const t = canvasTexture(size, size, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * spread;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 20 + Math.random() * size * 0.14;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const light = Math.random() < 0.4;
      grd.addColorStop(0, light ? 'rgba(255,255,255,0.08)' : `rgba(0,0,0,${0.06 + Math.random() * 0.1})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 2;
    for (let i = 0; i <= joints; i++) {
      g.beginPath(); g.moveTo((i * w) / joints, 0); g.lineTo((i * w) / joints, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / joints); g.lineTo(w, (i * h) / joints); g.stroke();
    }
  }, { repeat: true });
  t.repeat.set(repeat, repeat);
  return t;
}

/** The hall around the arena: tall concrete walls with a band of high windows. */
export function buildHall() {
  const wallTex = concreteTexture(512, '#5b6068', 18, 1, 2);
  wallTex.repeat.set(10, 2);
  const hall = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.CylinderGeometry(HALL_R, HALL_R, HALL_H, 32, 1, true),
    new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, side: THREE.BackSide }),
  );
  walls.position.y = GROUND_Y + HALL_H / 2;
  hall.add(walls);
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe8f2').multiplyScalar(1.4), toneMapped: false, side: THREE.BackSide });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(HALL_R - 0.05, HALL_R - 0.05, 1.2, 32, 1, true, 0, Math.PI * 2), windowMat);
  band.position.y = GROUND_Y + HALL_H - 3;
  hall.add(band);
  return hall;
}

/** A small scene used only to bake the environment map: grey hall, bright roof lights, dark floor — this is what
 *  the steel plates, cage and rifles reflect. */
export function envScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#3e444c');
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 16, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#5a6069', side: THREE.BackSide }));
  walls.position.y = 6;
  s.add(walls);
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(6) });
  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 18), lamp);
    strip.position.set(i * 4.5, 13, 0);
    s.add(strip);
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 24), new THREE.MeshBasicMaterial({ color: '#2a2d32' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = GROUND_Y;
  s.add(floor);
  return s;
}

function chainLinkAlpha() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const cx = col * 32 + 16;
        const cy = row * 32 + 16;
        g.beginPath();
        g.moveTo(cx - 13, cy); g.lineTo(cx, cy - 13); g.lineTo(cx + 13, cy); g.lineTo(cx, cy + 13);
        g.closePath();
        g.stroke();
      }
    }
  }, { srgb: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildFence(scene) {
  const R = FULL_APO + 0.34;
  const corner = R / Math.cos(Math.PI / 8);
  const side = 2 * R * Math.tan(Math.PI / 8);
  const alpha = chainLinkAlpha();
  alpha.repeat.set(side * 4, FENCE_H * 4);
  const meshMat = new THREE.MeshStandardMaterial({
    color: '#3a4048', metalness: 0.9, roughness: 0.4, alphaMap: alpha, alphaTest: 0.4, side: THREE.DoubleSide,
  });
  const steel = new THREE.MeshStandardMaterial({ color: '#39414b', metalness: 0.85, roughness: 0.35 });
  const pad = new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.6, roughness: 0.32 });

  const posts = [];
  const rails = [];
  for (let k = 0; k < 8; k++) {
    const mid = (k * Math.PI) / 4;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(side, FENCE_H), meshMat);
    panel.position.set(Math.cos(mid) * R, FENCE_H / 2 + PLINTH_TOP, Math.sin(mid) * R);
    panel.rotation.y = -mid + Math.PI / 2;
    scene.add(panel);
    // Round padded rails top and bottom, like the reference cage.
    for (const [y, r] of [[FENCE_H + PLINTH_TOP, 0.075], [PLINTH_TOP + 0.06, 0.05]]) {
      const rail = new THREE.CylinderGeometry(r, r, side + 0.08, 14);
      rail.rotateZ(Math.PI / 2);
      rail.rotateY(-mid + Math.PI / 2);
      rail.translate(Math.cos(mid) * R, y, Math.sin(mid) * R);
      rails.push(rail);
    }
    // Square steel posts at the corners.
    const ca = Math.PI / 8 + mid;
    const post = new THREE.BoxGeometry(0.17, FENCE_H + 0.14, 0.17);
    post.rotateY(-ca);
    post.translate(Math.cos(ca) * corner, (FENCE_H + 0.14) / 2 + PLINTH_TOP, Math.sin(ca) * corner);
    posts.push(post);
  }
  // Merged into two meshes: far fewer draw calls (smoother on TV sticks and phones).
  const railMesh = new THREE.Mesh(mergeGeometries(rails), pad);
  const postMesh = new THREE.Mesh(mergeGeometries(posts), steel);
  railMesh.castShadow = postMesh.castShadow = true;
  scene.add(railMesh, postMesh);
}

/** Steel crowd-control barrier, 2 m long, as one merged geometry (feet on the hall floor). */
function barrierGeometry() {
  const parts = [];
  const tube = (len, r, x, y, z, rot) => {
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    if (rot === 'x') g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    parts.push(g);
  };
  const L = 2;
  const H = 1.0;
  tube(L, 0.025, 0, H, 0, 'x');
  tube(L, 0.025, 0, 0.22, 0, 'x');
  tube(H, 0.025, -L / 2, H / 2 + 0.05, 0);
  tube(H, 0.025, L / 2, H / 2 + 0.05, 0);
  for (let i = 1; i < 14; i++) tube(H - 0.22, 0.01, -L / 2 + (i * L) / 14, (H + 0.22) / 2, 0);
  for (const x of [-L / 2, L / 2]) {
    const foot = new THREE.BoxGeometry(0.06, 0.03, 0.6);
    foot.translate(x, 0.015, 0);
    parts.push(foot);
  }
  return mergeGeometries(parts);
}

/** Scaffold light tower: 4 uprights with cross bracing and a lamp bar on top, as one merged geometry. */
const TOWER_H = 8;
function towerGeometry() {
  const parts = [];
  const w = 1.1;
  const pipe = (a, b, r = 0.035) => {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    parts.push(g);
  };
  const cs = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
  for (const [x, z] of cs) pipe([x, 0, z], [x, TOWER_H, z], 0.045);
  for (let y = 0; y < TOWER_H; y += 1.6) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = cs[i];
      const [x2, z2] = cs[(i + 1) % 4];
      pipe([x1, y, z1], [x2, y, z2]);
      pipe([x1, y, z1], [x2, y + 1.6, z2], 0.02);
    }
  }
  const deck = new THREE.BoxGeometry(w + 0.5, 0.08, w + 0.5);
  deck.translate(0, TOWER_H, 0);
  parts.push(deck);
  return mergeGeometries(parts);
}

export function buildGround(scene) {
  // Hall floor, with a hole where the plinth and pit are.
  const map = concreteTexture(512, '#6a6e74', 20, 10);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, HALL_R, 0, Math.PI * 2, false);
  shape.holes.push(new THREE.Path(octagonShape(PLINTH_OUT - 0.02).getPoints()));
  const floorGeo = new THREE.ShapeGeometry(shape, 48);
  floorGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.5, roughness: 0.82, metalness: 0.04 }));
  map.repeat.set(0.09, 0.09); // ShapeGeometry UVs are in world units
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  // Plinth: a dark steel-clad octagon whose inner face lines the deep pit.
  const plinthGeo = new THREE.ExtrudeGeometry(octagonRing(PLINTH_OUT, FULL_APO + 0.05), { depth: PLINTH_TOP + PIT_DEPTH, bevelEnabled: false });
  plinthGeo.rotateX(-Math.PI / 2);
  plinthGeo.translate(0, -PIT_DEPTH, 0);
  const plinth = new THREE.Mesh(plinthGeo, [
    new THREE.MeshStandardMaterial({ color: '#4a5059', roughness: 0.5, metalness: 0.7 }), // top
    new THREE.MeshStandardMaterial({ color: '#1a1e24', roughness: 0.75, metalness: 0.5 }), // faces (pit wall)
  ]);
  plinth.receiveShadow = true;
  scene.add(plinth);

  // Crowd barriers on an octagon around the cage.
  const barrierMat = new THREE.MeshStandardMaterial({ color: '#9aa1a9', metalness: 0.85, roughness: 0.35 });
  const spots = [];
  const BR = PLINTH_OUT + 2.4;
  for (let k = 0; k < 8; k++) {
    const mid = (k * Math.PI) / 4 + Math.PI / 8;
    const side = 2 * BR * Math.tan(Math.PI / 8);
    const n = Math.floor(side / 2.05);
    for (let i = 0; i < n; i++) {
      const t = -((n - 1) * 2.05) / 2 + i * 2.05;
      spots.push([Math.cos(mid) * BR - Math.sin(mid) * t, Math.sin(mid) * BR + Math.cos(mid) * t, -mid + Math.PI / 2]);
    }
  }
  const barriers = new THREE.InstancedMesh(barrierGeometry(), barrierMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, ry], i) => barriers.setMatrixAt(i, m.compose(new THREE.Vector3(x, GROUND_Y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1))));
  barriers.castShadow = true;
  scene.add(barriers);
}

// Scaffold light towers on the four diagonals.
const TOWER_D = 11.5;
const TOWERS = [45, 135, 225, 315].map((deg) => {
  const a = THREE.MathUtils.degToRad(deg);
  return [Math.cos(a) * TOWER_D, Math.sin(a) * TOWER_D];
});

function buildTowers(scene, phone) {
  const steel = new THREE.MeshStandardMaterial({ color: '#6f767f', metalness: 0.85, roughness: 0.4 });
  const towers = new THREE.InstancedMesh(towerGeometry(), steel, TOWERS.length);
  const m = new THREE.Matrix4();
  TOWERS.forEach(([x, z], i) => towers.setMatrixAt(i, m.makeTranslation(x, GROUND_Y, z)));
  scene.add(towers);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6e8').multiplyScalar(3), toneMapped: false });
  const housing = new THREE.MeshStandardMaterial({ color: '#202429', metalness: 0.8, roughness: 0.4 });
  for (const [x, z] of TOWERS) {
    const head = new THREE.Group();
    head.position.set(x, GROUND_Y + TOWER_H + 0.45, z);
    for (const dx of [-0.35, 0.35]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.35, 16), housing);
      can.rotation.x = Math.PI / 2;
      can.position.x = dx;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), lampMat);
      lens.position.set(dx, 0, 0.18);
      head.add(can, lens);
    }
    head.lookAt(0, -2, 0);
    scene.add(head);
    if (!phone) {
      const spot = new THREE.SpotLight('#fff3e2', 26, 30, THREE.MathUtils.degToRad(24), 0.6, 1.6);
      spot.position.copy(head.position);
      spot.target.position.set(0, 0, 0);
      scene.add(spot, spot.target);
    }
  }
}

export function buildLights(scene, phone) {
  buildTowers(scene, phone);
  // Soft, neutral hall light from above (overcast roof lights).
  scene.add(new THREE.HemisphereLight('#e6ecf3', '#3a3f46', phone ? 1.0 : 0.55));
  const key = new THREE.DirectionalLight('#ffffff', phone ? 1.3 : 1.05);
  key.position.set(3, 20, 6);
  key.castShadow = !phone;
  if (key.castShadow) {
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 45;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight('#cfd9e6', 0.45);
  fill.position.set(-6, 10, -8);
  scene.add(fill);
}
