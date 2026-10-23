// Spark bursts when a fighter is terminated.
import * as THREE from 'three';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  burst(x, z, color, n = 70) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([x, 0.75, z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9 + 0.1;
      const s = 2 + Math.random() * 4;
      vel.push([Math.cos(a) * s * (1 - e * 0.5), e * s, Math.sin(a) * s * (1 - e * 0.5)]);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color).multiplyScalar(5), size: 0.07, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.list.push({ pts, vel, age: 0 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const pos = p.pts.geometry.attributes.position;
      for (let k = 0; k < p.vel.length; k++) {
        p.vel[k][1] -= 9 * dt;
        pos.setXYZ(k, pos.getX(k) + p.vel[k][0] * dt, Math.max(0.02, pos.getY(k) + p.vel[k][1] * dt), pos.getZ(k) + p.vel[k][2] * dt);
      }
      pos.needsUpdate = true;
      p.pts.material.opacity = Math.max(0, 1 - p.age / 1.4);
      if (p.age > 1.4) {
        this.scene.remove(p.pts);
        p.pts.geometry.dispose();
        p.pts.material.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}
