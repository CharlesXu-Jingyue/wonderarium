import * as THREE from 'three';
import { mesh, rand, type Look } from '../kit';
import { P } from './look';
import { groundHeight, pondInward, pondSdf, WATER } from './terrain';

// Koi: slow, unhurried fish that wander the pond, drift and rest, rise now
// and then to kiss the surface, gather for food, and scatter when the glass
// is tapped. The body bends as it swims: a head, a middle and a tail, each
// swinging a little behind the one before.

export interface Pellet {
  mesh: THREE.Mesh;
  /** On the water and edible. */
  floating: boolean;
  age: number;
}

export interface Pond {
  pellets: Pellet[];
  eat(p: Pellet): void;
  ripple(x: number, z: number, strength: number): void;
  /** Round things standing in the water (x, z, radius). */
  obstacles: THREE.Vector3[];
  daylight(): number;
}

type Coat = 'kohaku' | 'orange' | 'gold';

const COATS: Record<Coat, { body: string; patch: string | null; fin: string }> = {
  kohaku: { body: P.koiWhite, patch: P.koiRed, fin: '#FFF3EC' },
  orange: { body: P.koiOrange, patch: P.koiWhite, fin: '#FFD9B8' },
  gold: { body: P.koiGold, patch: null, fin: '#FFE7B0' },
};

function finGeometry() {
  // A fan, flat in x/z, opening toward -z.
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0, -1, 0, -0.85, -0.35, 0, -1, 0, 0, 0, -0.35, 0, -1, 0.35, 0, -1, 0, 0, 0, 0.35, 0, -1, 1, 0, -0.85];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Koi {
  readonly root = new THREE.Group();
  readonly pos: THREE.Vector2;
  private y = WATER - 0.02;
  private heading = rand(0, Math.PI * 2);
  /** How fast it is turning now (rad/s), eased so the body never snaps. */
  private turnRate = 0;
  private speed = 0.02;
  private target = new THREE.Vector2();
  private rest = 0;
  private phase = rand(0, 10);
  private readonly mid = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly fins: THREE.Object3D[] = [];
  private flee = 0;
  private kiss = rand(20, 60);
  private kissing = 0;
  private food: Pellet | null = null;
  private readonly glowing: THREE.MeshStandardMaterial[] = [];

  constructor(look: Look, coat: Coat, start: THREE.Vector2, private readonly size: number) {
    const c = COATS[coat];
    // A little light of their own, so the colours survive the water's tint.
    const glow = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
    const skin = (hex: string) => {
      const m = look.mat(hex, { roughness: 0.45, emissive: glow(hex, 0.55) });
      this.glowing.push(m);
      return m;
    };
    const body = skin(c.body);
    const fin = look.mat(c.fin, { roughness: 0.6, side: THREE.DoubleSide, emissive: glow(c.fin, 0.25) });
    this.glowing.push(fin);
    const fan = finGeometry();
    this.pos = start.clone();
    this.root.scale.setScalar(size);

    // Head and shoulders, at the root: long, low and narrow.
    this.root.add(
      mesh(look.blob, body, [0, 0, 0.01], [0.0125, 0.0075, 0.026]),
      mesh(look.blob, look.mat(P.koiInk), [0.0075, 0.003, 0.027], 0.0018),
      mesh(look.blob, look.mat(P.koiInk), [-0.0075, 0.003, 0.027], 0.0018),
    );
    for (const side of [1, -1]) {
      const f = new THREE.Group();
      f.position.set(side * 0.01, -0.002, 0.014);
      f.rotation.y = side * 2.1;
      f.add(mesh(fan, fin, [0, 0, 0], 0.012));
      this.fins.push(f);
      this.root.add(f);
    }
    // The middle and tail swing from joints along the spine.
    this.mid.position.z = -0.008;
    this.mid.add(mesh(look.blob, body, [0, 0, -0.011], [0.0095, 0.0062, 0.02]));
    this.mid.add(mesh(fan, fin, [0, 0.005, -0.004], [0.0035, 1, 0.014], [0, 0, Math.PI / 2]));
    this.root.add(this.mid);
    this.tail.position.z = -0.026;
    this.tail.add(mesh(look.blob, body, [0, 0, -0.005], [0.005, 0.0042, 0.011]));
    // The tail fin stands upright, like the dorsal fin.
    this.tail.add(mesh(fan, fin, [0, 0, -0.01], [0.011, 1, 0.022], [0, 0, Math.PI / 2]));
    this.mid.add(this.tail);

    // Patches of colour lying on the back, like paint.
    if (c.patch) {
      const patch = skin(c.patch);
      this.root.add(mesh(look.blob, patch, [0.002, 0.0052, 0.02], [0.0085, 0.0028, 0.011]));
      this.mid.add(mesh(look.blob, patch, [-0.002, 0.0038, -0.01], [0.0075, 0.0028, 0.01]));
      if (coat === 'kohaku') this.root.add(mesh(look.blob, patch, [-0.003, 0.0058, 0.0], [0.007, 0.0028, 0.008]));
    }
    for (const m of this.parts) m.castShadow = false;
    this.pickTarget();
    this.place();
  }

  private get parts() {
    const out: THREE.Mesh[] = [];
    this.root.traverse((o) => o instanceof THREE.Mesh && out.push(o));
    return out;
  }

  private pickTarget() {
    for (let i = 0; i < 40; i++) {
      const x = rand(-0.38, 0.32);
      const z = rand(-0.28, 0.36);
      if (pondSdf(x, z) < -0.05 && this.clear(x, z, 0.02)) {
        this.target.set(x, z);
        return;
      }
    }
    this.target.set(0.07, 0.1);
  }

  private clear(x: number, z: number, margin: number) {
    return this.obstacles.every((o) => Math.hypot(x - o.x, z - o.y) > o.z + margin);
  }

  private obstacles: THREE.Vector3[] = [];

  /** A sudden fright: dart away from `from`. */
  startle(from: THREE.Vector2) {
    this.flee = rand(1, 1.6);
    this.rest = 0;
    this.food = null;
    const away = this.pos.clone().sub(from).normalize();
    this.target.copy(this.pos).addScaledVector(away, 0.25);
    if (pondSdf(this.target.x, this.target.y) > -0.05) this.pickTarget();
  }

  step(dt: number, pond: Pond, school: Koi[]) {
    this.obstacles = pond.obstacles;
    const night = 1 - pond.daylight();
    for (const m of this.glowing) m.emissiveIntensity = 1 - 0.75 * night;
    this.flee = Math.max(0, this.flee - dt);

    // Food first: the nearest floating pellet, if one is close enough to notice.
    if (this.food && !pond.pellets.includes(this.food)) this.food = null;
    if (!this.food && !this.flee) {
      let best = 0.45;
      for (const p of pond.pellets) {
        if (!p.floating) continue;
        const d = Math.hypot(p.mesh.position.x - this.pos.x, p.mesh.position.z - this.pos.y);
        if (d < best) {
          best = d;
          this.food = p;
        }
      }
    }
    if (this.food) {
      this.target.set(this.food.mesh.position.x, this.food.mesh.position.z);
      this.rest = 0;
    }

    // Cruise, rest, or hurry.
    const toTarget = this.target.clone().sub(this.pos);
    const dist = toTarget.length();
    let want = this.flee ? 0.13 : this.food ? 0.055 : (0.03 - 0.014 * night) * (0.8 + 0.4 * Math.sin(this.phase * 0.1));
    if (this.rest > 0) {
      this.rest -= dt;
      want = 0.004;
    } else if (!this.food && dist < 0.03) {
      if (Math.random() < 0.5) this.rest = rand(2, 7) * (1 + night);
      this.pickTarget();
    }
    this.speed += (want - this.speed) * Math.min(1, dt * (this.flee ? 4 : 1.2));

    // Steer: toward the target, away from the edge, the stones and each other.
    const desired = toTarget.normalize();
    const ahead = this.pos.clone().add(new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)).multiplyScalar(0.05));
    const edge = pondSdf(ahead.x, ahead.y);
    if (edge > -0.035) desired.addScaledVector(pondInward(ahead.x, ahead.y), 3 * THREE.MathUtils.clamp((edge + 0.035) / 0.03, 0, 1));
    for (const o of pond.obstacles) {
      const d = Math.hypot(ahead.x - o.x, ahead.y - o.y);
      // Ramp the push in, so it never switches on and off from frame to frame.
      const near = THREE.MathUtils.clamp((o.z + 0.03 - d) / 0.03, 0, 1);
      if (near > 0) desired.add(new THREE.Vector2(ahead.x - o.x, ahead.y - o.y).normalize().multiplyScalar(2 * near));
    }
    for (const other of school) {
      if (other === this) continue;
      const d = this.pos.distanceTo(other.pos);
      if (d < 0.05 && d > 0) desired.addScaledVector(this.pos.clone().sub(other.pos).normalize(), (0.05 - d) * 20);
    }
    const goal = Math.atan2(desired.x, desired.y);
    let turn = goal - this.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    // A target straight behind could be reached turning either way; keep
    // turning the way it already was, rather than flipping every frame.
    if (Math.abs(turn) > 2.6 && Math.sign(turn) !== Math.sign(this.turnRate) && this.turnRate !== 0) turn = -turn;
    // Turn in proportion to how far off course it is, and ease into it.
    const max = this.flee ? 4 : this.food ? 2.2 : 1.1;
    const wantRate = THREE.MathUtils.clamp(turn * 2.5, -max, max);
    this.turnRate += (wantRate - this.turnRate) * Math.min(1, dt * (this.flee ? 10 : 4));
    this.heading += this.turnRate * dt;

    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.y += Math.cos(this.heading) * this.speed * dt;
    // Never through the bank, whatever the steering says.
    const s = pondSdf(this.pos.x, this.pos.y);
    if (s > -0.02) this.pos.addScaledVector(pondInward(this.pos.x, this.pos.y), s + 0.02);

    // Depth: cruise below the surface, above the bed; come up to eat or kiss.
    const bed = groundHeight(this.pos.x, this.pos.y) + 0.011;
    let depth = WATER - 0.015 - 0.008 * night + Math.sin(this.phase * 0.3) * 0.002;
    if (this.food && dist < 0.07) depth = WATER - 0.009;
    this.kiss -= dt;
    if (this.kiss < 0 && !this.food && !this.flee) {
      this.kissing += dt;
      depth = WATER - 0.008;
      if (this.kissing > 1.2) {
        pond.ripple(this.pos.x + Math.sin(this.heading) * 0.02 * this.size, this.pos.y + Math.cos(this.heading) * 0.02 * this.size, 0.45);
        this.kissing = 0;
        this.kiss = rand(25, 70) * (1 + night * 2);
      }
    }
    this.y += (Math.min(WATER - 0.008, Math.max(bed, depth)) - this.y) * Math.min(1, dt * 1.5);

    // Eat a pellet when the mouth reaches it.
    if (this.food) {
      const mouth = new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)).multiplyScalar(0.03 * this.size).add(this.pos);
      if (mouth.distanceTo(new THREE.Vector2(this.food.mesh.position.x, this.food.mesh.position.z)) < 0.018) {
        pond.ripple(mouth.x, mouth.y, 0.7);
        pond.eat(this.food);
        this.food = null;
        this.rest = rand(0.5, 1.5);
      }
    }

    // Swim stroke: faster beats when hurrying, a body that curls into turns.
    this.phase += dt * Math.min(12, 3 + this.speed * 110);
    const beat = Math.min(0.55, 0.18 + this.speed * 5);
    // The body curls into the turn it is actually making, not the one it wants.
    const curl = THREE.MathUtils.clamp(this.turnRate / 1.1, -1, 1) * 0.3;
    this.mid.rotation.y = Math.sin(this.phase) * beat * 0.5 - curl;
    this.tail.rotation.y = Math.sin(this.phase - 1.1) * beat - curl * 0.8;
    this.fins.forEach((f, i) => (f.rotation.z = Math.sin(this.phase * 0.7 + i * Math.PI) * 0.25));
    this.place();
  }

  private place() {
    this.root.position.set(this.pos.x, this.y, this.pos.y);
    this.root.rotation.y = this.heading;
  }
}
