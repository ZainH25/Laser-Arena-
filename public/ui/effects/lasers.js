// Laser beams: the reveal shots (grow out of the gun) and the live aim sight (stops at the cage wall).
import * as THREE from 'three';
import { LASER_COLOR, LASER_CORE, disposeTree, canvasTexture } from '../shared/common.js';

const BEAM_Y = 0.78;

// Soft round glow used for muzzle and impact flashes.
let flashTex = null;
function flashTexture() {
  flashTex ??= canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  return flashTex;
}

function flash(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTexture(), color: new THREE.Color(color).multiplyScalar(2.5), blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, toneMapped: false,
  }));
  s.scale.setScalar(size);
  return s;
}

function beamGroup(color, width) {
  const make = (w) => {
    const g = new THREE.CylinderGeometry(w, w, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    g.rotateZ(-Math.PI / 2); // along +X, length 1
    return g;
  };
  // White-hot core, coloured inner glow and a wide faint halo: reads as a real beam once bloom picks it up.
  const core = new THREE.Mesh(make(width * 0.55), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25).multiplyScalar(2.2), toneMapped: false }));
  const glow = new THREE.Mesh(make(width * 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const halo = new THREE.Mesh(make(width * 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const grp = new THREE.Group();
  grp.add(core, glow, halo);
  grp.userData.base = { core: core.material.color.clone(), glow: glow.material.color.clone(), glowA: 0.4, haloA: 0.12 };
  return grp;
}

/** Shot intensity over time: surges to a blinding peak right after firing, then eases down to a dim glow. */
function surge(age) {
  if (age < 0.1) return 0.7 + 2.6 * (age / 0.1);
  return 0.35 + 2.95 * Math.exp(-(age - 0.1) * 2.4);
}

/** Apply intensity `k` (1 = normal) to a beam: thickness and brightness both follow it. */
function setIntensity(beam, k) {
  const [core, glow, halo] = beam.children;
  const b = beam.userData.base;
  const thick = 0.55 + 0.45 * k;
  beam.scale.y = beam.scale.z = thick;
  core.material.color.copy(b.core).multiplyScalar(k);
  glow.material.color.copy(b.glow).multiplyScalar(Math.max(0.5, k));
  glow.material.opacity = Math.min(0.9, b.glowA * k);
  halo.material.opacity = Math.min(0.5, b.haloA * k * 1.2);
}

export class Lasers {
  /** @param {THREE.Scene} scene  @param {(x:number,y:number)=>[number,number]} toWorld game → world (x, z) */
  constructor(scene, toWorld) {
    this.scene = scene;
    this.w = toWorld;
    this.shots = [];
    this.sight = null;
    this.sightColor = '';
    // Two reusable lights for shot flashes (a fixed count, so shaders never recompile mid-reveal).
    this.lights = [0, 1].map(() => {
      const l = new THREE.PointLight('#ffffff', 0, 4.5, 2);
      scene.add(l);
      return l;
    });
  }

  add(shot, color = LASER_COLOR) {
    const [x1, z1] = this.w(shot.x1, shot.y1);
    const [x2, z2] = this.w(shot.x2, shot.y2);
    const len = Math.hypot(x2 - x1, z2 - z1);
    const beam = beamGroup(color, 0.02);
    beam.position.set(x1, BEAM_Y, z1);
    beam.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    beam.scale.x = 0.001;
    const hit = flash(color, 0.55);
    hit.position.set(x2, BEAM_Y, z2);
    hit.visible = false;
    const muzzle = flash(color, 0.7);
    muzzle.position.set(x1, BEAM_Y, z1);
    this.scene.add(beam, hit, muzzle);
    const light = this.lights[this.shots.length % this.lights.length];
    light.color.set(color);
    light.position.set(x1, BEAM_Y + 0.2, z1);
    this.shots.push({ beam, hit, muzzle, len, age: 0, light, to: [x2, z2] });
  }

  clear() {
    for (const s of this.shots) {
      this.scene.remove(s.beam, s.hit, s.muzzle);
      disposeTree(s.beam);
      s.hit.material.dispose();
      s.muzzle.material.dispose();
    }
    this.shots = [];
    for (const l of this.lights) l.intensity = 0;
    this.hideSight();
  }

  /** Aim sight from a fighter, cut off exactly where a shot would hit the octagon wall. */
  setSight(x, y, angleDeg, color = LASER_COLOR, apothem = 4.5, muzzle = 0.8, height = BEAM_Y - 0.02) {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Start at the rifle's muzzle (in front of the fighter), not inside the body.
    const [cx, cz] = this.w(x, y);
    const x1 = cx + dx * muzzle;
    const z1 = cz + dz * muzzle;
    let len = 30;
    for (let k = 0; k < 8; k++) {
      const nx = Math.cos((k * Math.PI) / 4);
      const nz = Math.sin((k * Math.PI) / 4);
      const dn = dx * nx + dz * nz;
      if (dn > 1e-6) len = Math.min(len, Math.max(0.05, (apothem - (x1 * nx + z1 * nz)) / dn));
    }
    if (!this.sight || this.sightColor !== color) {
      this.hideSight(true);
      this.sightColor = color;
      this.sight = beamGroup(color, 0.009);
      this.sightEnd = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }));
      this.scene.add(this.sight, this.sightEnd);
    }
    this.sight.position.set(x1, height, z1);
    this.sight.rotation.y = -Math.atan2(dz, dx);
    this.sight.scale.set(len, 1, 1);
    this.sightEnd.position.set(x1 + dx * len, height, z1 + dz * len);
    this.sight.visible = this.sightEnd.visible = true;
  }

  hideSight(destroy = false) {
    if (!this.sight) return;
    if (destroy) {
      this.scene.remove(this.sight, this.sightEnd);
      disposeTree(this.sight);
      disposeTree(this.sightEnd);
      this.sight = this.sightEnd = null;
      this.sightColor = '';
    } else {
      this.sight.visible = this.sightEnd.visible = false;
    }
  }

  update(dt) {
    for (const s of this.shots) {
      s.age += dt;
      s.beam.scale.x = Math.min(s.len, s.beam.scale.x + (s.len * dt) / 0.28);
      const arrived = s.beam.scale.x >= s.len;
      // Muzzle flash pops and fades; the impact flares when the beam arrives, then settles to a glow.
      s.muzzle.material.opacity = Math.max(0, 1 - s.age / 0.35);
      s.muzzle.scale.setScalar(0.7 + s.age * 0.8);
      if (arrived && !s.hit.visible) { s.hit.visible = true; s.hitAt = s.age; }
      if (s.hit.visible) {
        const k = s.age - s.hitAt;
        s.hit.scale.setScalar(0.35 + 0.6 * Math.exp(-k * 6) + 0.05 * Math.sin(s.age * 30));
      }
      // The light follows the beam tip and fades out.
      const f = Math.min(1, s.beam.scale.x / Math.max(s.len, 1e-3));
      const [x1, z1] = [s.beam.position.x, s.beam.position.z];
      s.light.position.set(x1 + (s.to[0] - x1) * f, BEAM_Y + 0.2, z1 + (s.to[1] - z1) * f);
      const k = surge(s.age);
      setIntensity(s.beam, k);
      s.light.intensity = 3 * k;
    }
  }
}

export { LASER_CORE };
