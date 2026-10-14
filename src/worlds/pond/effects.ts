import * as THREE from 'three';
import { rand } from '../kit';

// Small, short-lived touches: a note drifting up from a croaking frog,
// splashes, and the ring a tap leaves on the glass.

interface Particle {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  age: number;
  life: number;
  gravity: number;
  grow: number;
  fade: (THREE.Material & { opacity: number }) | null;
  peak: number;
  floor: number;
}

function glyph(draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  draw(canvas.getContext('2d')!, s);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly live: Particle[] = [];
  private readonly noteTex = glyph((ctx, s) => {
    ctx.font = `600 ${s * 0.78}px -apple-system, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(60, 90, 50, 0.5)';
    ctx.strokeText('♪', s / 2, s / 2);
    ctx.fillStyle = '#F7FBEA';
    ctx.fillText('♪', s / 2, s / 2);
  });
  private readonly dropGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly dropMat = new THREE.MeshStandardMaterial({ color: '#F4FBFC', roughness: 0.3, flatShading: true });
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 28);

  private add(p: Omit<Particle, 'age'>) {
    this.group.add(p.obj);
    this.live.push({ ...p, age: 0 });
  }

  note(at: THREE.Vector3) {
    const material = new THREE.SpriteMaterial({ map: this.noteTex, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(at);
    sprite.scale.setScalar(0.022);
    this.add({ obj: sprite, vel: new THREE.Vector3(rand(-0.008, 0.008), 0.035, rand(-0.008, 0.008)), life: 1.8, gravity: 0, grow: 0.4, fade: material, peak: 0.9, floor: -Infinity });
  }

  /** Droplets thrown up where something hits the water; they fall back to `surface`. */
  splash(at: THREE.Vector3, count: number, surface: number) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.dropGeo, this.dropMat);
      m.position.copy(at);
      m.scale.setScalar(rand(0.002, 0.0035));
      const a = rand(0, Math.PI * 2);
      const v = new THREE.Vector3(Math.cos(a) * rand(0.04, 0.09), rand(0.16, 0.26), Math.sin(a) * rand(0.04, 0.09));
      this.add({ obj: m, vel: v, life: 1, gravity: 1.5, grow: 0, fade: null, peak: 1, floor: surface });
    }
  }

  glassRipple(at: THREE.Vector3, normal: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ringGeo, material);
    m.position.copy(at).addScaledVector(normal, -0.004);
    m.lookAt(at.clone().add(normal));
    m.scale.setScalar(0.012);
    this.add({ obj: m, vel: new THREE.Vector3(), life: 0.55, gravity: 0, grow: 5, fade: material, peak: 0.6, floor: -Infinity });
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life || p.obj.position.y < p.floor) {
        this.group.remove(p.obj);
        p.fade?.dispose();
        this.live.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.scale.multiplyScalar(1 + p.grow * dt);
      const k = p.age / p.life;
      if (p.fade) p.fade.opacity = p.peak * Math.min(1, k * 6) * (1 - k);
    }
  }

  dispose() {
    for (const p of this.live) p.fade?.dispose();
    this.noteTex.dispose();
    this.dropGeo.dispose();
    this.dropMat.dispose();
    this.ringGeo.dispose();
  }
}
