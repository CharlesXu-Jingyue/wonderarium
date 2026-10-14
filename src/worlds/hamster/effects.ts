import * as THREE from 'three';
import { C, Look, pick, rand } from './look';

// Small, short-lived touches: drifting z's over the sleeping house, hearts
// when petted, bubbles in the bottle, flicked shavings, ripples on the glass.

interface Particle {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  age: number;
  life: number;
  gravity: number;
  grow: number;
  sway: number;
  fade: (THREE.Material & { opacity: number }) | null;
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
  private readonly zTex = glyph((ctx, s) => {
    ctx.font = `600 ${s * 0.8}px -apple-system, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(110, 100, 150, 0.55)';
    ctx.strokeText('z', s / 2, s / 2);
    ctx.fillStyle = '#FBF8FF';
    ctx.fillText('z', s / 2, s / 2);
  });
  private readonly heartTex = glyph((ctx, s) => {
    ctx.fillStyle = '#F2949C';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.82);
    ctx.bezierCurveTo(s * 0.08, s * 0.52, s * 0.18, s * 0.12, s / 2, s * 0.32);
    ctx.bezierCurveTo(s * 0.82, s * 0.12, s * 0.92, s * 0.52, s / 2, s * 0.82);
    ctx.fill();
    ctx.stroke();
  });
  private readonly bubbleGeo = new THREE.IcosahedronGeometry(1, 1);
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 28);

  constructor(private readonly look: Look) {}

  private add(p: Omit<Particle, 'age'>) {
    this.group.add(p.obj);
    this.live.push({ ...p, age: 0 });
  }

  private sprite(texture: THREE.Texture, at: THREE.Vector3, size: number) {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    return { sprite, material };
  }

  zzz(at: THREE.Vector3) {
    const { sprite, material } = this.sprite(this.zTex, at, 0.035);
    this.add({ obj: sprite, vel: new THREE.Vector3(0.012, 0.03, 0.006), life: 3.2, gravity: 0, grow: 0.5, sway: 0.01, fade: material });
  }

  heart(at: THREE.Vector3) {
    const { sprite, material } = this.sprite(this.heartTex, at, 0.03);
    this.add({ obj: sprite, vel: new THREE.Vector3(rand(-0.01, 0.01), 0.05, rand(-0.01, 0.01)), life: 1.4, gravity: 0, grow: 0.4, sway: 0.006, fade: material });
  }

  bubble(from: THREE.Vector3, top: number) {
    const material = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.7, depthWrite: false });
    const m = new THREE.Mesh(this.bubbleGeo, material);
    m.position.copy(from).add(new THREE.Vector3(rand(-0.015, 0.015), 0, rand(-0.015, 0.015)));
    m.scale.setScalar(rand(0.004, 0.008));
    const speed = 0.09;
    this.add({ obj: m, vel: new THREE.Vector3(0, speed, 0), life: (top - from.y) / speed, gravity: 0, grow: 0.3, sway: 0.004, fade: null });
  }

  chips(at: THREE.Vector3, backward: THREE.Vector2) {
    for (let i = 0; i < 2; i++) {
      const material = this.look.mat(pick(C.chips));
      const m = new THREE.Mesh(this.look.chip, material);
      m.position.copy(at);
      m.scale.set(0.012, 0.004, 0.01);
      m.rotation.set(rand(0, 3), rand(0, 3), 0);
      const v = new THREE.Vector3(backward.x * rand(0.12, 0.2) + rand(-0.04, 0.04), rand(0.15, 0.25), backward.y * rand(0.12, 0.2) + rand(-0.04, 0.04));
      this.add({ obj: m, vel: v, life: 0.55, gravity: 1.2, grow: 0, sway: 0, fade: null });
    }
  }

  ripple(at: THREE.Vector3, normal: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ringGeo, material);
    m.position.copy(at).addScaledVector(normal, -0.004);
    m.lookAt(at.clone().add(normal));
    m.scale.setScalar(0.012);
    this.add({ obj: m, vel: new THREE.Vector3(), life: 0.55, gravity: 0, grow: 5, sway: 0, fade: material });
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.group.remove(p.obj);
        if (p.fade) p.fade.dispose();
        else if (p.obj instanceof THREE.Mesh && p.obj.material instanceof THREE.MeshBasicMaterial) p.obj.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.position.x += Math.sin(p.age * 5 + i) * p.sway * dt * 5;
      p.obj.scale.multiplyScalar(1 + p.grow * dt);
      const k = p.age / p.life;
      if (p.fade) p.fade.opacity = (p.fade instanceof THREE.SpriteMaterial ? 1 : 0.6) * Math.min(1, k * 6) * (1 - k);
    }
  }

  dispose() {
    for (const p of this.live) {
      if (p.fade) p.fade.dispose();
    }
    this.zTex.dispose();
    this.heartTex.dispose();
    this.bubbleGeo.dispose();
    this.ringGeo.dispose();
  }
}
