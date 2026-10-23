// The fighter: smooth matte-white mannequin holding a camo AK-style rifle, plus its floating name tag.
// Model faces +X; the scene rotates `aimer` to the aim angle. `legs` are hip-hinged groups for the walk cycle.
import * as THREE from 'three';
import { LASER_CORE, canvasTexture } from '../shared/common.js';
import { skinBodyMaterial, skinGun } from './skins.js';

function camoGunTexture() {
  // Desert digital camo, like the reference rifle.
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#b39a74';
    g.fillRect(0, 0, w, h);
    const tones = ['#8a7353', '#6b5a43', '#cdb895', '#58483a'];
    for (let i = 0; i < 260; i++) {
      g.fillStyle = tones[i % tones.length];
      const x = Math.floor(Math.random() * 32) * 8;
      const y = Math.floor(Math.random() * 16) * 8;
      g.fillRect(x, y, 8 * (1 + Math.floor(Math.random() * 3)), 8 * (1 + Math.floor(Math.random() * 2)));
    }
  });
}

/** AK-style rifle pointing along +X. Origin = where the stock meets the shoulder. */
function buildRifle(skin = null) {
  const camoTex = skin ? null : camoGunTexture();
  // A skin repaints the furniture (stock, receiver, handguard, magazine) to match the suit.
  const camo = skin
    ? new THREE.MeshStandardMaterial({ color: skin.color, roughness: skin.rough, metalness: skin.metal })
    : new THREE.MeshStandardMaterial({ map: camoTex, bumpMap: camoTex, bumpScale: 0.6, roughness: 0.62, metalness: 0.15 });
  const steel = new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.28, metalness: 0.95 });
  const gun = new THREE.Group();
  const box = (sx, sy, sz, mat, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    gun.add(m);
    return m;
  };
  box(0.2, 0.06, 0.045, camo, 0.06, -0.01, 0, 0.12); // stock
  box(0.24, 0.075, 0.055, camo, 0.27, 0.0, 0); // receiver
  box(0.03, 0.012, 0.05, steel, 0.27, 0.042, 0); // top cover
  box(0.16, 0.06, 0.06, camo, 0.47, 0.0, 0); // handguard
  box(0.045, 0.085, 0.04, camo, 0.2, -0.065, 0, 0.35); // pistol grip
  // Curved magazine: three angled segments.
  [[0.31, -0.07, 0.15], [0.325, -0.13, 0.4], [0.35, -0.185, 0.65]].forEach(([x, y, r]) => box(0.05, 0.07, 0.04, camo, x, y, 0, r));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 10), steel);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.68, 0.01, 0);
  gun.add(barrel);
  const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8), steel);
  gasTube.rotation.z = Math.PI / 2;
  gasTube.position.set(0.6, 0.038, 0);
  gun.add(gasTube);
  box(0.012, 0.045, 0.012, steel, 0.76, 0.035, 0); // front sight
  box(0.04, 0.02, 0.03, steel, 0.37, 0.05, 0); // rear sight
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.05, 10), steel);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0.85, 0.01, 0);
  gun.add(muzzle);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color: LASER_CORE }));
  tip.position.set(0.88, 0.01, 0);
  gun.add(tip);
  // Glowing accent strips (circuit / magma / neon skins) or gold trim (marble).
  const accent = skin?.emissive || skin?.accent;
  if (accent) {
    const glow = skin.emissive
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.2), toneMapped: false })
      : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.25, metalness: 1 });
    box(0.2, 0.008, 0.058, glow, 0.27, 0.0, 0); // receiver line
    box(0.13, 0.008, 0.062, glow, 0.47, -0.012, 0); // handguard line
    box(0.012, 0.06, 0.042, glow, 0.33, -0.12, 0, 0.4); // magazine stripe
  }
  return gun;
}

/** Capsule limb between two points. */
function limb(mat, a, b, r) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const len = Math.max(0.001, dir.length() - 2 * r);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

/**
 * Smooth matte-white mannequin in a shooting stance (faces +X): big round faceless head, soft rounded limbs,
 * both hands on the rifle, leaning into the shot. One shared body material so the whole figure greys out on death.
 */
export function buildMannequin(look = {}) {
  // Satin vinyl, like a real display mannequin: soft sheen plus a light clear coat that catches the floodlights.
  // A suit skin (look.skin) swaps in its own material; the figure itself is identical.
  const bodyMat = skinBodyMaterial(look.skin) || new THREE.MeshPhysicalMaterial({
    color: '#f0f0ec', roughness: 0.48, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32, sheen: 0.35, sheenRoughness: 0.6,
  });
  const parts = [];
  const sphere = (r, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), bodyMat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parts.push(m);
    return m;
  };

  // Legs: each hinged at the hip (a group we can swing for walking), straight down, rounded foot.
  const legs = [-0.085, 0.085].map((z) => {
    const leg = new THREE.Group();
    leg.position.set(0.02, 0.46, z);
    const thigh = limb(bodyMat, [0, 0, 0], [0, -0.39, 0], 0.068);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), bodyMat);
    foot.position.set(0.045, -0.415, 0);
    foot.scale.set(1.5, 0.72, 1.0);
    foot.castShadow = true;
    leg.add(thigh, foot);
    return leg;
  });
  // Upright torso (slightly wider at the chest) and a big round faceless head on top.
  const torso = limb(bodyMat, [0.02, 0.48, 0], [0.04, 0.9, 0], 0.13);
  torso.scale.set(1.0, 1, 1.25);
  parts.push(torso);
  sphere(0.2, 0.07, 1.14, 0);
  // Arms raise the rifle to the shoulder: right hand on the grip, left hand on the handguard.
  const rShoulder = [0.04, 0.92, 0.16];
  const lShoulder = [0.04, 0.92, -0.16];
  const rElbow = [0.13, 0.76, 0.2];
  const lElbow = [0.3, 0.8, -0.13];
  const rHand = [0.32, 0.85, 0.06];
  const lHand = [0.55, 0.9, 0.05];
  parts.push(limb(bodyMat, rShoulder, rElbow, 0.062), limb(bodyMat, rElbow, rHand, 0.058));
  parts.push(limb(bodyMat, lShoulder, lElbow, 0.062), limb(bodyMat, lElbow, lHand, 0.058));
  sphere(0.06, ...rHand);
  sphere(0.06, ...lHand);

  const gun = buildRifle(skinGun(look.skin));
  // Previews (Customise screens) show the laser in the chosen colour, coming out of the muzzle.
  if (look.beam && look.laserColor) {
    const beamGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.7, 8, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(0.88 + 0.85, 0.01, 0);
    const glowGeo = beamGeo.clone().scale(1, 3.5, 3.5);
    const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(look.laserColor).multiplyScalar(2.2), toneMapped: false }));
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: look.laserColor, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    gun.add(core, glow);
  }
  gun.position.set(0.1, 0.91, 0.06); // stock tucked into the right shoulder, level with the ground

  const aimer = new THREE.Group();
  aimer.add(...parts, ...legs, gun);
  if (look.color) addLook(aimer, legs, look.color, look.outfit || 'cap', [rHand, lHand]);
  const group = new THREE.Group();
  group.add(aimer);
  return { group, aimer, bodyMat, legs, ring: null, color: look.color || '#f0f0ec', outfit: look.outfit || 'cap', alive: aliveColor(bodyMat) };
}

/**
 * Team colour + headgear on top of the mannequin (head centre (0.07, 1.14, 0), radius 0.2; the model faces +X).
 * Team colour shows on the gloves, the boots and the headgear. Headgear: 'cap', 'helmet' (tactical, with goggles),
 * 'hood' (open at the face, draped over the shoulders) or 'beanie' (knit, with a turned-up cuff and a bobble).
 */
function addLook(aimer, legs, color, outfit, hands) {
  const team = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.5 });
  const add = (mesh, parent = aimer) => { mesh.castShadow = true; parent.add(mesh); return mesh; };
  const [hx, hy, hz] = [0.07, 1.14, 0];
  // Gloves (slightly bigger than the hands).
  for (const h of hands) add(new THREE.Mesh(new THREE.SphereGeometry(0.066, 18, 14), team)).position.set(...h);
  // Boots: coloured shells over the feet.
  for (const leg of legs) {
    const boot = add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), team), leg);
    boot.position.set(0.045, -0.4, 0);
    boot.scale.set(1.55, 0.75, 1.05);
  }
  if (outfit === 'helmet') {
    // Tactical helmet: a deep shell down to the ears, a short peak, side rails and goggles pushed up on the front.
    const dark = new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.35, metalness: 0.6 });
    const lens = new THREE.MeshPhysicalMaterial({ color: '#0a0f14', roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 });
    const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.228, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), team));
    shell.position.set(hx - 0.01, hy + 0.005, hz);
    shell.scale.set(1.05, 1, 1.02);
    const peak = add(new THREE.Mesh(new THREE.SphereGeometry(0.236, 24, 6, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.5, Math.PI * 0.07), team));
    peak.position.set(hx - 0.01, hy + 0.005, hz);
    peak.material.side = THREE.DoubleSide;
    for (const z of [-1, 1]) {
      const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.02), dark));
      rail.position.set(hx, hy + 0.02, hz + z * 0.225);
    }
    const strap = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.36), dark)); // goggle strap across the front
    strap.position.set(hx + 0.17, hy + 0.12, hz);
    for (const z of [-0.06, 0.06]) {
      const g = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.045, 18), dark));
      g.rotation.z = Math.PI / 2;
      g.position.set(hx + 0.2, hy + 0.12, hz + z);
      const l = add(new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), lens));
      l.rotation.y = Math.PI / 2;
      l.position.set(hx + 0.224, hy + 0.12, hz + z);
    }
  } else if (outfit === 'hood') {
    // Hood shell with the opening facing forward (+X), and a drape over the back of the shoulders.
    const gap = Math.PI * 0.62;
    const hood = add(new THREE.Mesh(new THREE.SphereGeometry(0.218, 32, 20, Math.PI + gap / 2, Math.PI * 2 - gap, 0, Math.PI * 0.66), team));
    hood.position.set(hx - 0.012, hy + 0.008, hz);
    hood.scale.set(1.03, 1.02, 1.02);
    hood.material.side = THREE.DoubleSide;
    // Short cowl at the back of the neck, where the hood meets the shoulders.
    const cowl = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, Math.PI * 1.3, Math.PI * 1.4, Math.PI * 0.4, Math.PI * 0.3), team.clone()));
    cowl.position.set(hx - 0.06, hy - 0.16, hz);
    cowl.scale.set(0.9, 0.7, 1.2);
    cowl.material.side = THREE.DoubleSide;
  } else if (outfit === 'beanie') {
    // Knit beanie: snug crown, turned-up cuff and a bobble on top.
    const knit = team.clone();
    knit.roughness = 0.95;
    knit.clearcoat = 0;
    const crown = add(new THREE.Mesh(new THREE.SphereGeometry(0.214, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), knit));
    crown.position.set(hx, hy + 0.035, hz);
    crown.scale.set(1, 1.12, 1);
    const cuff = add(new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.212, 0.075, 32, 1, true), knit));
    cuff.position.set(hx, hy + 0.085, hz);
    cuff.material = knit.clone();
    cuff.material.side = THREE.DoubleSide;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), knit)).position.set(hx, hy + 0.27, hz);
  } else {
    // Baseball cap: crown, a curved peak to the front and a button on top.
    const crown = add(new THREE.Mesh(new THREE.SphereGeometry(0.212, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.46), team));
    crown.position.set(hx, hy + 0.025, hz);
    const peak = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.016, 32, 1, false, 0, Math.PI), team));
    peak.position.set(hx + 0.12, hy + 0.08, hz); // the half-disc (theta 0..π) already points forward (+X)
    peak.rotation.z = -0.18;
    peak.scale.set(1.15, 1, 1.25);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), team)).position.set(hx, hy + 0.24, hz);
  }
}

/** Body colour to restore when a fighter is alive (white for skins so their texture shows true). */
function aliveColor(mat) { return mat.map ? '#ffffff' : '#f0f0ec'; }

/** Dead fighters turn grey and stop glowing; alive ones get their look back. */
export function setFighterDead(f, dead) {
  f.bodyMat.color.set(dead ? '#555' : f.alive);
  f.bodyMat.emissiveIntensity = dead ? 0 : f.bodyMat.userData.glow || 0;
}

/** Name tag that always faces the camera. */
export function labelSprite(text, color) {
  const tex = canvasTexture(512, 128, (g, w, h) => {
    g.font = '900 72px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}
