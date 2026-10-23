// Small live 3D preview of a fighter (phone join screen + Customise sheet): the real mannequin with the chosen suit,
// gear and team colour, turning slowly. It only renders while it is on screen.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMannequin } from './mannequin.js';
import { disposeTree } from '../shared/common.js';

export function createPreview() {
  const canvas = document.createElement('canvas');
  canvas.className = 'look-preview-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#e8eef5', '#2a2e35', 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fc4ff', 0.8);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  // A dark steel disc to stand on.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.05, 40), new THREE.MeshStandardMaterial({ color: '#2a3038', metalness: 0.8, roughness: 0.4 }));
  disc.position.y = -0.025;
  scene.add(disc);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(1.9, 1.45, 2.3);
  camera.lookAt(0.12, 0.72, 0);

  let fighter = null;
  let lookKey = '';
  let host = null;
  let last = performance.now();

  function setLook(look) {
    const k = JSON.stringify(look);
    if (k === lookKey) return;
    lookKey = k;
    if (fighter) { scene.remove(fighter.group); disposeTree(fighter.group); }
    fighter = buildMannequin(look);
    fighter.group.rotation.y = fighter.group.userData.ry || 0.6;
    scene.add(fighter.group);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!host || !fighter || !host.offsetParent || document.hidden) return; // off screen: no work
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    fighter.group.rotation.y += dt * 0.6;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    setLook,
    /** Show the preview inside an element (moves the one canvas there). */
    mount(el) { host = el; el.appendChild(canvas); },
  };
}
