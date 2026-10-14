import * as THREE from 'three';
import { seeded, rand, pick, type Look } from '../kit';
import { P } from './look';
import { bladeGeometry, type Tree } from './plants';
import { groundHeight, pondInward, pondSdf, WATER } from './terrain';

// Things that drift: fireflies after dusk, motes of dust turning in the
// daylight, and leaves letting go of the big tree to spin down onto the
// grass or float on the pond for a while.

function glowTexture() {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Glow {
  anchor: THREE.Vector3;
  phase: THREE.Vector3;
  speed: THREE.Vector3;
  blink: number;
  rate: number;
}

/** A cloud of soft points that wander about their anchors and pulse. */
class Glows {
  readonly points: THREE.Points;
  private readonly glows: Glow[] = [];
  private readonly color: THREE.Color;

  constructor(texture: THREE.Texture, count: number, color: string, size: number, seed: number, private readonly reach: number) {
    const rnd = seeded(seed);
    this.color = new THREE.Color(color);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = rnd(-0.4, 0.4);
      const z = rnd(-0.4, 0.4);
      this.glows.push({
        anchor: new THREE.Vector3(x, Math.max(groundHeight(x, z), WATER) + rnd(0.03, 0.2), z),
        phase: new THREE.Vector3(rnd(0, 9), rnd(0, 9), rnd(0, 9)),
        speed: new THREE.Vector3(rnd(0.15, 0.35), rnd(0.2, 0.4), rnd(0.15, 0.35)),
        blink: rnd(0, 10),
        rate: rnd(0.25, 0.5),
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size, map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  update(t: number, strength: number, sharp: boolean) {
    this.points.visible = strength > 0.01;
    if (!this.points.visible) return;
    const pos = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.points.geometry.attributes.color as THREE.BufferAttribute;
    this.glows.forEach((g, i) => {
      const r = this.reach;
      pos.setXYZ(
        i,
        g.anchor.x + Math.sin(t * g.speed.x + g.phase.x) * r + Math.sin(t * g.speed.z * 2.3 + g.phase.y) * r * 0.3,
        g.anchor.y + Math.sin(t * g.speed.y + g.phase.y) * r * 0.4,
        g.anchor.z + Math.cos(t * g.speed.z + g.phase.z) * r + Math.cos(t * g.speed.x * 1.9 + g.phase.x) * r * 0.3,
      );
      // Fireflies flash and go dark; motes just glint.
      const s = Math.sin(t * g.rate * Math.PI * 2 * 0.5 + g.blink);
      const b = sharp ? 0.08 + THREE.MathUtils.smoothstep(s, 0.25, 0.9) : 0.5 + 0.5 * s;
      col.setXYZ(i, this.color.r * b * strength, this.color.g * b * strength, this.color.b * b * strength);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

interface Leaf {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  state: 'falling' | 'floating' | 'resting';
  age: number;
  phase: number;
}

export class Drift {
  readonly group = new THREE.Group();
  private readonly texture = glowTexture();
  private readonly fireflies: Glows;
  private readonly motes: Glows;
  private readonly leaves: Leaf[] = [];
  private readonly leafGeo = bladeGeometry(0.018, 0.011, 0.5, 3, 'leaf');
  private leafIn = rand(8, 20);
  private t = 0;

  constructor(private readonly look: Look) {
    this.fireflies = new Glows(this.texture, 22, P.firefly, 0.1, 3, 0.07);
    this.motes = new Glows(this.texture, 14, P.mote, 0.03, 9, 0.05);
    this.group.add(this.fireflies.points, this.motes.points);
  }

  /** Let a few leaves go from a tree. */
  shed(tree: Tree, count: number) {
    if (!tree.leafy) return;
    const rnd = seeded(Math.floor(Math.random() * 1e9));
    for (let i = 0; i < count && this.leaves.length < 14; i++) {
      const m = new THREE.Mesh(this.leafGeo, this.look.mat(pick(Math.random() < 0.6 ? P.fallen : P.leaf), { side: THREE.DoubleSide }));
      m.position.copy(tree.leafSpot(rnd));
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      m.castShadow = true;
      this.group.add(m);
      this.leaves.push({
        mesh: m,
        vel: new THREE.Vector3(rand(-0.01, 0.01), -0.03, rand(-0.01, 0.01)),
        spin: new THREE.Vector3(rand(-2, 2), rand(-1, 1), rand(-2, 2)),
        state: 'falling',
        age: 0,
        phase: rand(0, 6),
      });
    }
  }

  update(dt: number, daylight: number, trees: Tree[], water: { ripple(x: number, z: number, s: number): void; swell(x: number, z: number): number }) {
    this.t += dt;
    const night = 1 - THREE.MathUtils.smoothstep(daylight, 0.1, 0.45);
    this.fireflies.update(this.t, night, true);
    this.motes.update(this.t, daylight * 0.55, false);

    // Now and then a leaf lets go by itself.
    if ((this.leafIn -= dt) <= 0) {
      this.leafIn = rand(15, 40);
      const leafy = trees.filter((t) => t.leafy);
      if (leafy.length) this.shed(pick(leafy), 1);
    }

    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      const p = l.mesh.position;
      l.age += dt;
      if (l.state === 'falling') {
        // Spiral down, rocking side to side.
        p.x += (l.vel.x + Math.sin(l.age * 2.2 + l.phase) * 0.025) * dt;
        p.z += (l.vel.z + Math.cos(l.age * 1.7 + l.phase) * 0.02) * dt;
        p.y += l.vel.y * dt;
        l.mesh.rotation.x += l.spin.x * dt;
        l.mesh.rotation.y += l.spin.y * dt;
        l.mesh.rotation.z += l.spin.z * dt;
        p.x = THREE.MathUtils.clamp(p.x, -0.47, 0.47);
        p.z = THREE.MathUtils.clamp(p.z, -0.47, 0.47);
        const ground = groundHeight(p.x, p.z);
        if (pondSdf(p.x, p.z) < -0.01 && p.y <= WATER + 0.002) {
          l.state = 'floating';
          l.age = 0;
          l.mesh.rotation.set(0, rand(0, 6), 0);
          l.mesh.rotateX(Math.PI / 2);
          water.ripple(p.x, p.z, 0.35);
        } else if (p.y <= ground + 0.002) {
          l.state = 'resting';
          l.age = 0;
          p.y = ground + 0.002;
          l.mesh.rotation.set(0, rand(0, 6), 0);
          l.mesh.rotateX(Math.PI / 2);
        }
      } else if (l.state === 'floating') {
        // Drift slowly, turning, kept off the bank.
        p.x += Math.sin(this.t * 0.05 + l.phase) * 0.004 * dt;
        p.z += Math.cos(this.t * 0.04 + l.phase) * 0.004 * dt;
        if (pondSdf(p.x, p.z) > -0.015) {
          const inward = pondInward(p.x, p.z);
          p.x += inward.x * 0.01 * dt;
          p.z += inward.y * 0.01 * dt;
        }
        p.y = WATER + 0.001 + water.swell(p.x, p.z);
        l.mesh.rotateY(0.04 * dt);
      }
      // Fade away after a while, so the pond never fills up.
      const life = l.state === 'floating' ? 60 : l.state === 'resting' ? 30 : Infinity;
      if (l.age > life) {
        const k = Math.min(1, (l.age - life) / 3);
        l.mesh.scale.setScalar(1 - k);
        if (k >= 1) {
          this.group.remove(l.mesh);
          this.leaves.splice(i, 1);
        }
      }
    }
  }

  dispose() {
    this.texture.dispose();
    this.leafGeo.dispose();
  }
}
