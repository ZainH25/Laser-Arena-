// CageScene: puts the UI modules together (cage + characters + effects), owns the camera and renders frames.
// It contains no models or stage logic itself — see ui/cage, ui/character and ui/effects.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FULL_APO, LASER_COLOR, disposeTree } from './shared/common.js';
import { Stage } from './cage/stage.js';
import { buildHall, buildGround, buildLights, buildFence, envScene, HORIZON } from './cage/environment.js';

// Film look for the TV: soft vignette + a touch of grain (applied after tone mapping).
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      c.rgb *= mix(0.62, 1.0, v);
      c.rgb += (rand(vUv) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};
import { buildMannequin, labelSprite } from './character/mannequin.js';
import { animateWalk } from './character/walk.js';
import { Lasers } from './effects/lasers.js';
import { Particles } from './effects/particles.js';

export class CageScene {
  constructor(container, center, opts = {}) {
    this.C = center;
    this.phone = !!opts.phone;
    this.container = container;
    this._size = '';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = !this.phone;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.phone ? 0.9 : 0.82;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON);
    this.scene.fog = new THREE.FogExp2(HORIZON, 0.02);
    // Reflections come from the hall and its roof lights (see cage/environment.js).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(envScene(), 0.02).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.6;

    // Cage
    this.scene.add(buildHall());
    buildGround(this.scene);
    buildLights(this.scene, this.phone);
    buildFence(this.scene);
    this.stage = new Stage({ phone: this.phone });
    this.scene.add(this.stage.group);
    this.ringCenter = { position: { y: this.stage.standY } }; // where fighters stand (kept for callers)

    // Effects
    this.lasers = new Lasers(this.scene, (x, y) => this.w(x, y));
    this.particles = new Particles(this.scene);

    // Characters
    this.fighters = new Map();
    this.showcase = buildMannequin();
    this.showcase.group.scale.setScalar(1.28);
    this.showcase.group.visible = false;
    this.scene.add(this.showcase.group);

    // Camera + post
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 120);
    // Multisampled HDR target: anti-aliased edges and proper bloom on bright lasers.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.phone ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!this.phone) {
      // Ambient occlusion: contact shadows where feet meet the floor, in the layer seams and along the fence.
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 0.35, distanceFallOff: 1, thickness: 1, scale: 1.1 });
      this.gtao.blendIntensity = 0.85;
      this.gtao.enabled = false; // only on the High setting: it is the most expensive effect
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.phone ? 0.22 : 0.32, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!this.phone) {
      this.finish = new ShaderPass(FinishShader);
      this.composer.addPass(this.finish);
    }
    // TV quality: 2 = High (contact shadows, full resolution), 1 = Auto (default), 0 = Low. Auto steps down to Low
    // by itself if frames are slow.
    this.perf = { frames: 0, time: 0, level: 1 };

    // Cage state set by the pages every frame.
    this.targetApothem = FULL_APO;
    this.shownApothem = FULL_APO;
    this.doomActive = false;
    this.doomBandFor = '';
    this.doomOuter = FULL_APO;
    this.doomInner = FULL_APO;
    this.shake = 0;
    this.showcaseActive = false;
    this.showcaseT = 0;

    this._onResize = () => this.resize();
    this.resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(container);
    }
  }

  pixelRatio() {
    const cap = this.phone ? 1.35 : [1, 1.5, 2][this.perf?.level ?? 1];
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();
  }

  /** Game (x, y) → world (x, z). */
  w(x, y) { return [x - this.C, y - this.C]; }

  /** Screen point (client px) → game (x, y) on the floor, for mouse aiming. Null if it misses the floor plane. */
  screenToGame(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.stage.standY + 0.9)); // barrel height
    const hit = new THREE.Vector3();
    if (!this._ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x + this.C, y: hit.z + this.C };
  }

  // ------------------------------------------------------------------ camera

  needsResize() {
    const r = this.container.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}@${this.pixelRatio()}` !== this._size;
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width || window.innerWidth);
    const h = Math.max(1, r.height || window.innerHeight);
    const key = `${Math.round(w)}x${Math.round(h)}@${this.pixelRatio()}`;
    if (key === this._size) return;
    this._size = key;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.gtao?.setSize(w * pr, h * pr);

    this.camera.aspect = w / h;
    const fit = Math.max(1, (16 / 9) / this.camera.aspect);
    if (this.phone) {
      this.camera.fov = 54;
      // Fit the cage to the screen WIDTH, so tall phones get a big, close cage.
      const halfW = Math.tan((54 * Math.PI) / 360) * this.camera.aspect;
      const pfit = Math.max(0.85, 5.6 / halfW / Math.hypot(6.4, 3.65));
      this.baseCam = { x: 0, y: 6.4 * pfit, z: 3.65 * pfit, lx: 0, ly: 0.38, lz: 0 };
      // Sticks and sheets cover the bottom of the phone: frame the cage a little higher.
      this.camera.setViewOffset(w, h, 0, Math.round(h * 0.12), w, h);
    } else {
      this.camera.fov = 50;
      this.baseCam = { x: 0, y: 7.85 * fit, z: 4.35 * fit, lx: 0, ly: 0.38, lz: 0 };
      this.lobbyCam = { x: 0, y: 6.55 * fit, z: 3.55 * fit, lx: 0, ly: 0.34, lz: -0.12, fov: 52 };
      // Operator Locker: close-up on the display fighter (it stands at x ≈ 0.95).
      this.lockerCam = { x: 0.95 + 2.1, y: 2.1, z: 2.7, lx: 0.95 - 0.35, ly: 0.95, lz: 0, fov: 34 };
    }
    this.applyCamera();
  }

  /** Which camera is in use: locker close-up, empty-lobby showcase, or the normal arena view. */
  activeCam() {
    if (this.locker && this.lockerCam) return this.lockerCam;
    return this.showcaseActive && !this.phone && this.lobbyCam ? this.lobbyCam : this.baseCam;
  }

  applyCamera() {
    const c = this.activeCam();
    if (!c) return;
    if (c.fov) this.camera.fov = c.fov;
    else if (!this.phone) this.camera.fov = 50;
    this.camera.position.set(c.x, c.y, c.z);
    this.camera.lookAt(c.lx, c.ly, c.lz);
    this.camera.updateProjectionMatrix();
  }

  /** Empty-lobby showcase: one fighter on display with its sight laser. */
  setShowcase(active) {
    if (active === this.showcaseActive) return;
    this.showcaseActive = active;
    this.showcase.group.visible = active || this.locker;
    if (!active) this.lasers.hideSight();
    this.applyCamera();
  }

  /** Operator Locker on/off: the display fighter turns slowly in a close-up so its suit can be inspected. */
  setLocker(on) {
    if (on === this.locker) return;
    this.locker = on;
    this.showcase.group.visible = on || this.showcaseActive;
    this.showcase.group.rotation.y = 0;
    if (on) this.lasers.hideSight();
    this.applyCamera();
  }

  /** Dress the display fighter in a look ({skin, outfit, color}). */
  setShowcaseLook(look) {
    const key = JSON.stringify(look);
    if (key === this.showcaseKey) return;
    this.showcaseKey = key;
    const old = this.showcase;
    this.scene.remove(old.group);
    disposeTree(old.group);
    this.showcase = buildMannequin(look);
    this.showcase.group.scale.setScalar(1.28);
    this.showcase.group.visible = this.showcaseActive || this.locker;
    this.scene.add(this.showcase.group);
  }

  /** Graphics quality from the TV settings: 'high', 'low' or 'auto' (auto steps down on a slow TV). */
  setQuality(q) {
    if (this.phone) return;
    this.perf.fixed = q !== 'auto';
    this.perf.level = q === 'low' ? 0 : q === 'high' ? 2 : 1;
    if (this.gtao) this.gtao.enabled = q === 'high';
    this._size = '';
    this.resize();
  }

  // ------------------------------------------------------------------ cage

  /** Jump straight to a cage size (no drop animation for layers that are restored). */
  setMat(apothem) {
    this.targetApothem = this.shownApothem = apothem;
    this.stage.setApothem(apothem);
  }

  /** Platform layer sizes, outermost first. */
  setLayers(sizes) { this.stage.setLayers(sizes); }

  /** Mark the ring between `outer` and `inner` as the layer that falls at the reveal. */
  setDoomBand(outer, inner) {
    this.doomOuter = outer;
    this.doomInner = inner;
  }

  // ------------------------------------------------------------------ characters

  fighter(p) {
    let f = this.fighters.get(p.id);
    const lookKey = `${p.color}|${p.outfit}|${p.skin}|${p.name}`;
    if (f && f.lookKey === lookKey) return f;
    if (f) { this.scene.remove(f.group); disposeTree(f.group); this.fighters.delete(p.id); } // look changed in the lobby
    const built = buildMannequin({ color: p.color, outfit: p.outfit, skin: p.skin });
    if (this.phone) built.group.scale.setScalar(1.22);
    const label = labelSprite(p.name, p.color);
    label.position.y = 1.62;
    built.group.add(label);
    this.scene.add(built.group);
    f = { ...built, label, color: p.color, deadAt: 0, lookKey };
    this.fighters.set(p.id, f);
    return f;
  }

  /** Remove fighters that are no longer in the roster. */
  purgeFighters(keepIds) {
    const keep = new Set(keepIds);
    for (const [id, f] of this.fighters) {
      if (keep.has(id)) continue;
      this.scene.remove(f.group);
      disposeTree(f.group);
      this.fighters.delete(id);
    }
  }

  // ------------------------------------------------------------------ effects (thin wrappers kept for callers)

  addLaser(shot, color) { this.lasers.add(shot, color); }
  clearLasers() { this.lasers.clear(); }
  /** Aim sight from a fighter's rifle: starts at the muzzle, at barrel height, for the figure's size on this screen. */
  setSightLaser(x, y, angleDeg, color = LASER_COLOR, apothem = this.targetApothem) {
    const k = this.phone ? 1.22 : 1;
    this.lasers.setSight(x, y, angleDeg, color, apothem, 0.85 * k, this.stage.standY + 0.92 * k);
  }
  hideSightLaser() { this.lasers.hideSight(); }
  burst(x, z, color) {
    this.particles.burst(x, z, color);
    this.shake = Math.min(1, this.shake + 0.45);
  }

  // ------------------------------------------------------------------ frame

  render(dt, t) {
    // Stage: exact layers for the game's cage size; warning on exactly the next layer to go.
    this.stage.setApothem(this.targetApothem);
    this.stage.setWarning(this.doomActive, this.doomOuter, this.doomInner);
    this.stage.update(dt, t);
    this.shownApothem = this.targetApothem;

    for (const f of this.fighters.values()) animateWalk(f, dt);
    this.lasers.update(dt);
    this.particles.update(dt);

    if (this.locker) {
      this.showcaseT += dt;
      this.showcase.group.position.set(0.95, this.stage.standY, 0);
      this.showcase.aimer.rotation.y = 0;
      this.showcase.group.rotation.y += dt * 0.55;
    } else if (this.showcaseActive) {
      this.showcaseT += dt;
      const gx = 0.95 + Math.sin(this.showcaseT * 0.35) * 0.05;
      this.showcase.group.position.set(gx, this.stage.standY, 0);
      this.showcase.group.rotation.y = 0;
      // Body and sight laser share one aim angle (same mapping as real fighters), so the rifle points along the beam.
      const aim = 188;
      this.showcase.aimer.rotation.y = (-aim * Math.PI) / 180;
      this.lasers.setSight(this.C + gx, this.C, aim, LASER_COLOR, FULL_APO, 0.85 * 1.28, this.stage.standY + 0.92 * 1.28); // the 1.28× figure's muzzle
    }

    this.shake = Math.max(0, this.shake - dt * 1.5);
    const s = this.shake * this.shake * 0.1;
    const c = this.activeCam();
    if (c) this.camera.position.x = c.x + (Math.random() - 0.5) * s;

    if (this.phone) { this.renderer.render(this.scene, this.camera); return; } // phones: no post-processing = smoother
    if (this.finish) this.finish.uniforms.time.value = t % 100;
    this.adaptQuality(dt);
    this.composer.render();
  }

  /** Slow TV (e.g. a Fire TV stick)? Drop ambient occlusion first, then resolution, so play stays smooth. */
  adaptQuality(dt) {
    if (this.phone || this.perf.fixed || this.perf.level === 0 || document.hidden) return;
    this.perf.frames++;
    this.perf.time += dt;
    if (this.perf.frames < 120) return;
    const avg = this.perf.time / this.perf.frames;
    this.perf.frames = 0;
    this.perf.time = 0;
    if (avg < 1 / 40) return;
    this.perf.level--;
    if (this.perf.level === 1 && this.gtao) this.gtao.enabled = false;
    if (this.perf.level === 0) { this._size = ''; this.resize(); }
  }
}
