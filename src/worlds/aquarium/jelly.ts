import * as THREE from 'three';
import { lineMaterial, type GlowUniforms } from '../glow';
import { pick, rand } from '../kit';
import { A } from './look';
import { WATER_Y } from './water';

// A moon jelly, more or less: a translucent bell that beats in slow pulses,
// each one a quick squeeze and a long, easy relaxing, between which it
// coasts and sinks a little. A warm core glows inside. Fine tentacles trail
// from the rim and four frilled arms hang beneath, each a chain of points
// that simply follows where the bell has been, so they stream behind it on
// the way up and gather under it as it sinks.

const TENTACLES = 10;
const TENTACLE_NODES = 14;
const ARMS = 4;
const ARM_NODES = 10;
/** How long a squeeze takes, and the relaxing after it, in seconds. */
const SQUEEZE = 0.45;
const RELAX = 1.15;
/**
 * How heavily tentacles and arms sink when nothing pulls them up (units a
 * second squared): enough to hang below a coasting bell, never to drag it.
 */
const TENTACLE_WEIGHT = 0.06;
const ARM_WEIGHT = 0.09;
/** How far a jelly may roam: inside the glass, above the weed, under the surface. */
const ROAM = 0.45;
const FLOOR = -0.17;

const UP = new THREE.Vector3(0, 1, 0);

/** A rock to keep clear of, as an ellipsoid. */
export interface Obstacle {
  center: THREE.Vector3;
  radii: THREE.Vector3;
}

/** How far out from an obstacle's middle a point is, in units of its radii (1 on its surface). */
function reach(o: Obstacle, x: number, y: number, z: number) {
  return Math.hypot((x - o.center.x) / o.radii.x, (y - o.center.y) / o.radii.y, (z - o.center.z) / o.radii.z);
}

/** The bell's outline, from the crown to the rim, in units of its radius. */
const BELL = [
  [0, 0.62], [0.3, 0.6], [0.58, 0.51], [0.8, 0.35], [0.95, 0.14], [1.0, 0.0], [0.92, -0.06],
].map(([r, y]) => new THREE.Vector2(r, y));

interface Chain {
  /** Current and previous positions of each node, in tank space. */
  at: Float32Array;
  was: Float32Array;
  /** Where on the bell it hangs from: angle round the rim, and how far out. */
  angle: number;
  out: number;
  segment: number;
}

export class Jelly {
  readonly root = new THREE.Group();
  readonly bell: THREE.Mesh;
  readonly radius: number;
  readonly glow = new THREE.Color();
  /** How brightly it glows now, beyond its resting glow (raised by a touch). */
  excite = 0;
  /** How squeezed the bell is, 0 to 1. */
  squeeze = 0;

  readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly want = new THREE.Vector3(0, 1, 0);
  private heading: number;
  private stage: 'squeeze' | 'relax' | 'rest' = 'rest';
  private stageT = 0;
  private restFor: number;
  private eager = 0;
  private readonly seed = rand(0, 100);
  /** The depth it is drifting toward, changed every half minute or so. */
  private depth = 0;
  private depthFor = 0;

  private readonly tentacles: Chain[] = [];
  /** The rock the tentacles drape over rather than pass through. */
  private rock?: Obstacle;
  private readonly arms: Chain[] = [];
  private readonly lines: THREE.LineSegments;
  private readonly ribbons: THREE.Mesh;
  private readonly bellMat: THREE.MeshStandardMaterial;
  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly core: THREE.Mesh;

  constructor(radius: number, at: THREE.Vector3, uniforms: GlowUniforms) {
    this.radius = radius;
    this.pos.copy(at);
    this.heading = rand(0, Math.PI * 2);
    this.restFor = rand(0, 2);
    this.glow.set(pick(A.jellyGlow));

    this.bellMat = new THREE.MeshStandardMaterial({
      color: A.bell,
      emissive: this.glow,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      flatShading: true,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const coreColor = pick(A.jellyCore);
    this.coreMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.8,
      flatShading: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.bell = new THREE.Mesh(new THREE.LatheGeometry(BELL, 14), this.bellMat);
    this.bell.scale.setScalar(radius);
    this.bell.renderOrder = 26;
    const coreShape = BELL.slice(0, 6).map((p) => new THREE.Vector2(p.x * 0.5, p.y * 0.55 + 0.08));
    this.core = new THREE.Mesh(new THREE.LatheGeometry(coreShape, 8), this.coreMat);
    this.core.scale.setScalar(radius);
    this.core.renderOrder = 25;
    this.root.add(this.bell, this.core);
    this.root.position.copy(this.pos);

    // Tentacles round the rim, longest on the biggest jellies.
    const reach = radius * rand(2.6, 3.6);
    for (let k = 0; k < TENTACLES; k++) {
      this.tentacles.push(this.chain(TENTACLE_NODES, (k / TENTACLES) * Math.PI * 2 + rand(-0.15, 0.15), 0.9, reach * rand(0.75, 1.1)));
    }
    for (let k = 0; k < ARMS; k++) {
      this.arms.push(this.chain(ARM_NODES, (k / ARMS) * Math.PI * 2 + 0.4, 0.22, radius * rand(1.7, 2.5)));
    }

    // Tentacles as fine glowing lines, fading toward their tips.
    const tentacleVerts = TENTACLES * TENTACLE_NODES;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tentacleVerts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const lineCol = new Float32Array(tentacleVerts * 3);
    const fade = new Float32Array(tentacleVerts);
    const tint = new THREE.Color().setRGB(...A.tentacle).lerp(this.glow, 0.35);
    const index: number[] = [];
    for (let k = 0; k < TENTACLES; k++) {
      for (let i = 0; i < TENTACLE_NODES; i++) {
        const v = k * TENTACLE_NODES + i;
        tint.toArray(lineCol, v * 3);
        fade[v] = 1 - 0.85 * (i / (TENTACLE_NODES - 1));
        if (i < TENTACLE_NODES - 1) index.push(v, v + 1);
      }
    }
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    lineGeo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    lineGeo.setIndex(index);
    this.lines = new THREE.LineSegments(lineGeo, lineMaterial(uniforms, 0.55));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 27;

    // Arms as frilled ribbons.
    const armVerts = ARMS * ARM_NODES * 2;
    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(armVerts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const ribbonIndex: number[] = [];
    for (let k = 0; k < ARMS; k++) {
      for (let i = 0; i < ARM_NODES - 1; i++) {
        const v = (k * ARM_NODES + i) * 2;
        ribbonIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    ribbonGeo.setIndex(ribbonIndex);
    this.ribbons = new THREE.Mesh(
      ribbonGeo,
      new THREE.MeshStandardMaterial({
        color: A.bell,
        emissive: this.glow,
        emissiveIntensity: 0.55,
        flatShading: true,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.ribbons.frustumCulled = false;
    this.ribbons.renderOrder = 24;
  }

  /** Everything to add to the tank: the bell travels; tentacles and arms live in tank space. */
  get parts() {
    return [this.root, this.lines, this.ribbons];
  }

  private chain(nodes: number, angle: number, out: number, length: number): Chain {
    const at = new Float32Array(nodes * 3);
    const segment = length / (nodes - 1);
    for (let i = 0; i < nodes; i++) {
      at[i * 3] = this.pos.x + Math.cos(angle) * this.radius * out;
      at[i * 3 + 1] = this.pos.y - i * segment;
      at[i * 3 + 2] = this.pos.z + Math.sin(angle) * this.radius * out;
    }
    return { at, was: at.slice(), angle, out, segment };
  }

  /** A touch: a few eager pulses, upward, glowing bright. */
  rouse() {
    this.excite = 1;
    this.eager = 3;
    if (this.stage === 'rest') this.restFor = 0;
  }

  step(dt: number, t: number, others: Jelly[], daylight: number, rock: Obstacle) {
    this.pulse(dt);
    this.steer(dt, t, others, rock);

    // Squeezing drives it along its axis; between beats it coasts, slows, and sinks.
    if (this.stage === 'squeeze') {
      const u = this.stageT / SQUEEZE;
      this.vel.addScaledVector(this.up, 0.2 * Math.sin(Math.PI * u) * dt * (0.8 + this.radius * 3));
    }
    this.vel.y -= 0.009 * dt;
    this.vel.multiplyScalar(Math.exp(-1.4 * dt));
    this.pos.addScaledVector(this.vel, dt);

    const lim = ROAM - this.radius;
    const top = WATER_Y - 0.05 - this.radius * 0.6;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
    if (this.pos.y > top) {
      this.pos.y = top;
      this.vel.y = Math.min(this.vel.y, 0);
    }
    if (this.pos.y < FLOOR) {
      this.pos.y = FLOOR;
      this.vel.y = Math.max(this.vel.y, 0);
    }
    // Never inside the big rock: slide back out to its surface, and a bell's width beyond.
    const clear = 1 + (this.radius * 1.2) / Math.min(rock.radii.x, rock.radii.z);
    const q = reach(rock, this.pos.x, this.pos.y, this.pos.z);
    if (q < clear) this.pos.sub(rock.center).multiplyScalar(clear / Math.max(q, 1e-3)).add(rock.center);

    // The bell: narrower and taller as it squeezes.
    const s = this.squeeze;
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromUnitVectors(UP, this.up);
    this.bell.scale.set(this.radius * (1 - 0.18 * s), this.radius * (1 + 0.12 * s), this.radius * (1 - 0.18 * s));
    this.core.scale.set(this.radius * (1 - 0.12 * s), this.radius, this.radius * (1 - 0.12 * s));
    this.root.updateMatrixWorld();

    this.excite = Math.max(0, this.excite - dt / 6);
    const lift = this.excite * 0.35;
    const night = 1 - daylight;
    this.bellMat.emissiveIntensity = 0.35 + 0.35 * night + 0.25 * s + lift;
    this.coreMat.emissiveIntensity = 0.6 + 0.6 * night + 0.3 * s + lift;
    (this.ribbons.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 0.4 * night + lift * 0.7;

    this.trail(dt);
  }

  /** The beat: squeeze, relax, rest, and again; the rests now and then long. */
  private pulse(dt: number) {
    this.stageT += dt;
    if (this.stage === 'squeeze') {
      this.squeeze = THREE.MathUtils.smoothstep(this.stageT / SQUEEZE, 0, 1);
      if (this.stageT >= SQUEEZE) this.next('relax');
    } else if (this.stage === 'relax') {
      this.squeeze = 1 - THREE.MathUtils.smoothstep(this.stageT / RELAX, 0, 1);
      if (this.stageT >= RELAX) {
        this.squeeze = 0;
        // Near the surface it stops beating and lets itself sink a while.
        // Above the depth it is after, it rests and lets itself sink a while.
        const high = this.pos.y > this.depth + 0.03;
        this.restFor = this.eager > 0 ? rand(0.2, 0.5) : high ? rand(4, 9) : Math.random() < 0.15 ? rand(3, 6) : rand(1.0, 2.4);
        this.eager = Math.max(0, this.eager - 1);
        this.next('rest');
      }
    } else if (this.stageT >= this.restFor || (this.pos.y < this.depth - 0.08 && this.stageT > 0.8)) {
      this.next('squeeze');
    }
  }

  private next(stage: 'squeeze' | 'relax' | 'rest') {
    this.stage = stage;
    this.stageT = 0;
  }

  /** Lean the bell toward where it would like to go, slowly. */
  private steer(dt: number, t: number, others: Jelly[], rock: Obstacle) {
    if ((this.depthFor -= dt) <= 0) {
      this.depthFor = rand(25, 55);
      this.depth = rand(FLOOR + 0.06, WATER_Y - 0.1 - this.radius);
    }
    // The heading wanders for real, not just back and forth.
    this.heading += (Math.sin(t * 0.07 + this.seed) + Math.sin(t * 0.023 + this.seed * 2.3)) * 0.35 * dt;
    // Climbing, it points up; at its depth, it leans over and swims along.
    const climb = THREE.MathUtils.clamp((this.depth - this.pos.y) / 0.12, 0, 1);
    const lean = 0.85 - 0.45 * climb;
    const want = this.want.set(Math.cos(this.heading) * lean, 0.6 + 0.6 * climb, Math.sin(this.heading) * lean);
    // Away from the glass, and from each other.
    const lim = ROAM - this.radius - 0.03;
    if (Math.abs(this.pos.x) > lim) want.x -= Math.sign(this.pos.x) * 1.4;
    if (Math.abs(this.pos.z) > lim) want.z -= Math.sign(this.pos.z) * 1.4;
    for (const o of others) {
      if (o === this) continue;
      const dx = this.pos.x - o.pos.x;
      const dy = this.pos.y - o.pos.y;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dy, dz);
      const room = this.radius + o.radius + 0.14;
      if (d < room && d > 1e-4) {
        const push = (room - d) / room;
        want.x += (dx / d) * push * 2;
        want.z += (dz / d) * push * 2;
        this.vel.addScaledVector(new THREE.Vector3(dx, dy, dz).divideScalar(d), push * 0.02 * dt);
      }
    }
    // Lean away from the big rock as it comes near.
    const q = reach(rock, this.pos.x, this.pos.y, this.pos.z);
    const near = 1.5 + (this.radius * 1.2) / Math.min(rock.radii.x, rock.radii.z);
    if (q < near) {
      const away = new THREE.Vector3(
        (this.pos.x - rock.center.x) / rock.radii.x ** 2,
        (this.pos.y - rock.center.y) / rock.radii.y ** 2,
        (this.pos.z - rock.center.z) / rock.radii.z ** 2,
      ).normalize();
      want.addScaledVector(away, (near - q) * 4);
      this.vel.addScaledVector(away, (near - q) * 0.03 * dt);
    }
    this.rock = rock;
    if (this.eager > 0) want.y += 1.5;
    want.normalize();
    // Turn at most a third of a radian a second.
    const angle = this.up.angleTo(want);
    if (angle > 1e-4) {
      const k = Math.min(1, (0.33 * dt) / angle);
      this.up.lerp(want, k).normalize();
    }
  }

  /** Tentacles and arms follow the rim, each node dragging the next behind it. */
  private trail(dt: number) {
    const local = new THREE.Vector3();
    const rim = this.radius * (1 - 0.18 * this.squeeze);
    const fall = dt * dt;
    const lim = 0.488;
    const follow = (c: Chain, from: THREE.Vector3, weight: number) => {
      const n = c.at.length / 3;
      c.at[0] = from.x;
      c.at[1] = from.y;
      c.at[2] = from.z;
      for (let i = 1; i < n; i++) {
        const o = i * 3;
        // Carry on a little as they were going, then sink a hair (unless
        // no time is passing at all).
        if (dt > 0) {
          for (let k = 0; k < 3; k++) {
            const v = (c.at[o + k] - c.was[o + k]) * 0.9;
            c.was[o + k] = c.at[o + k];
            c.at[o + k] += v;
          }
        }
        c.at[o + 1] -= weight * fall;
        // Keep the link length to the node above.
        const dx = c.at[o] - c.at[o - 3];
        const dy = c.at[o + 1] - c.at[o - 2];
        const dz = c.at[o + 2] - c.at[o - 1];
        const d = Math.hypot(dx, dy, dz) || 1;
        const f = c.segment / d;
        c.at[o] = THREE.MathUtils.clamp(c.at[o - 3] + dx * f, -lim, lim);
        c.at[o + 1] = Math.max(-0.38, c.at[o - 2] + dy * f);
        c.at[o + 2] = THREE.MathUtils.clamp(c.at[o - 1] + dz * f, -lim, lim);
        // Over the rock, not through it.
        const rock = this.rock;
        if (rock) {
          const q = reach(rock, c.at[o], c.at[o + 1], c.at[o + 2]);
          if (q < 1.02) {
            const k = 1.02 / Math.max(q, 1e-3);
            c.at[o] = rock.center.x + (c.at[o] - rock.center.x) * k;
            c.at[o + 1] = rock.center.y + (c.at[o + 1] - rock.center.y) * k;
            c.at[o + 2] = rock.center.z + (c.at[o + 2] - rock.center.z) * k;
          }
        }
      }
    };
    for (const c of this.tentacles) {
      local.set(Math.cos(c.angle) * rim * c.out, -0.05 * this.radius, Math.sin(c.angle) * rim * c.out);
      follow(c, local.applyMatrix4(this.root.matrixWorld), TENTACLE_WEIGHT);
    }
    for (const c of this.arms) {
      local.set(Math.cos(c.angle) * this.radius * c.out, 0.05 * this.radius, Math.sin(c.angle) * this.radius * c.out);
      follow(c, local.applyMatrix4(this.root.matrixWorld), ARM_WEIGHT);
    }

    const lines = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.tentacles.forEach((c, k) => (lines.array as Float32Array).set(c.at, k * TENTACLE_NODES * 3));
    lines.needsUpdate = true;

    // Each arm a ribbon, its width across the arm and frilled along it.
    const ribbon = this.ribbons.geometry.getAttribute('position') as THREE.BufferAttribute;
    const r = ribbon.array as Float32Array;
    const side = new THREE.Vector3();
    this.arms.forEach((c, k) => {
      side.set(-Math.sin(c.angle), 0, Math.cos(c.angle)).applyQuaternion(this.root.quaternion);
      for (let i = 0; i < ARM_NODES; i++) {
        const h = i / (ARM_NODES - 1);
        const half = this.radius * 0.16 * (1 - 0.7 * h) * (1 + 0.45 * Math.sin(i * 2.3 + k));
        const o = i * 3;
        const v = (k * ARM_NODES + i) * 6;
        r[v] = c.at[o] - side.x * half;
        r[v + 1] = c.at[o + 1] - side.y * half;
        r[v + 2] = c.at[o + 2] - side.z * half;
        r[v + 3] = c.at[o] + side.x * half;
        r[v + 4] = c.at[o + 1] + side.y * half;
        r[v + 5] = c.at[o + 2] + side.z * half;
      }
    });
    ribbon.needsUpdate = true;
    this.ribbons.geometry.computeVertexNormals();
  }

  dispose() {
    for (const m of [this.bell, this.core, this.ribbons]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
