import * as THREE from 'three';
import { rand } from '../kit';
import type { World, WorldContext, WorldPointerEvent } from '../world';
import { advance, hue, onAttractor } from './flow';
import { dotMaterial, glowUniforms, lineMaterial, trackPixels } from '../glow';

// The abstract one: no floor and no creatures, only light in empty space.
// Sparks run the Lorenz equations, each with a short comet's tail, over a
// few faint threads of a long trajectory that sketch the butterfly they are
// all drawn into; motes drift and twinkle in the space around it. Click
// near the sparks and a little cloud of new ones is released from a single
// point, together at first, then scattering over both wings.

/** Sparks, how many places each one remembers for its tail, and how many steps apart. */
const SPARKS = 640;
const TAIL = 44;
const TAIL_EVERY = 3;
/** Lorenz time per real second: slow, so one loop round a wing takes several seconds. */
const SPEED = 0.1;
/**
 * Lorenz units to cube units. The wings spread along x + y, so turned to
 * lie across the cube's diagonal they reach about 33 units out (counting
 * their depth too), which this keeps just inside the glass.
 */
const SCALE = 0.0185;
/** The middle of the attractor's height, raised to the cube's middle. */
const MID_Z = 24.5;
const MOTES = 120;
/**
 * How many sparks a click gathers, and how far apart they start: one point
 * on screen, but far enough apart that they fray within half a minute.
 */
const BURST = 36;
const BURST_GAP = 0.05;
const BURST_COLOR: [number, number, number] = [0.4, 0.9, 1.0];
/**
 * A cloud keeps its colour while it holds together, and lets it go as it
 * spreads: from this mean distance from its middle (Lorenz units)...
 */
const SPREAD_FADE_FROM = 4;
/** ...to this one, about as scattered as sparks on the attractor ever are. */
const SPREAD_GONE = 12;
/** Whatever happens, a cloud is let go after this many seconds. */
const CLOUD_LIFE = 300;
/** The colour never goes quicker than this, even when a cloud splits between the wings at once. */
const FADE_AT_LEAST = 6;

interface Cloud {
  id: number;
  members: number[];
  age: number;
}

export class LorenzAttractor implements World {
  readonly id = 'lorenz-attractor';
  readonly name = 'Lorenz Attractor';
  cursor = '';

  private ctx!: WorldContext;
  private readonly uniforms = glowUniforms();
  /** Lorenz space, turned so the wings open across the usual view. */
  private readonly space = new THREE.Group();
  private readonly state: Float64Array = onAttractor(SPARKS);
  /** How strongly each spark shows its cloud's colour, 0 to 1. */
  private readonly fresh = new Float32Array(SPARKS);
  /** Which cloud each spark belongs to, or -1. */
  private readonly cloudOf = new Int32Array(SPARKS).fill(-1);
  private clouds: Cloud[] = [];
  private nextCloud = 0;
  private tails!: THREE.LineSegments;
  private heads!: THREE.Points;
  private readonly owned: { dispose(): void }[] = [];
  private readonly rgb: [number, number, number] = [0, 0, 0];
  private t = 0;
  private steps = 0;

  mount(ctx: WorldContext) {
    this.ctx = ctx;
    // x + y, the way the wings spread, onto the diagonal across the view.
    this.space.rotation.y = Math.PI / 2;
    this.space.scale.setScalar(SCALE);
    ctx.root.add(this.space);

    this.space.add(this.threads(), this.buildTails(), this.buildHeads());
    ctx.root.add(this.buildMotes());
    this.step(0);
  }

  // ---------- building ----------

  /** Where a Lorenz point is drawn: x across, z up, y in depth. */
  private place(s: Float64Array, i: number, out: Float32Array, o: number) {
    out[o] = s[i];
    out[o + 1] = s[i + 2] - MID_Z;
    out[o + 2] = s[i + 1];
  }

  private own<T extends { dispose(): void }>(thing: T) {
    this.owned.push(thing);
    return thing;
  }

  /** Two long trajectories, drawn faint and still: the shape everything follows. */
  private threads() {
    const group = new THREE.Group();
    const material = this.own(lineMaterial(this.uniforms, 0.13));
    const starts = onAttractor(2);
    for (let t = 0; t < 2; t++) {
      const count = 7000;
      const p = starts.slice(t * 3, t * 3 + 3);
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        advance(p, 0, 0.006);
        this.place(p, 0, pos, i * 3);
        col.set(hue(p[0], p[1], p[2], this.rgb), i * 3);
      }
      const geometry = this.own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      group.add(line);
    }
    return group;
  }

  /** Every spark's tail: TAIL places, newest first, joined by short segments. */
  private buildTails() {
    const pos = new Float32Array(SPARKS * TAIL * 3);
    const col = new Float32Array(SPARKS * TAIL * 3);
    const fade = new Float32Array(SPARKS * TAIL);
    const index: number[] = [];
    const h = (SPEED / 60) * TAIL_EVERY;
    for (let n = 0; n < SPARKS; n++) {
      // Run each spark along its tail's length, filling it oldest first.
      for (let k = TAIL - 1; k >= 0; k--) {
        const o = (n * TAIL + k) * 3;
        this.place(this.state, n * 3, pos, o);
        col.set(hue(this.state[n * 3], this.state[n * 3 + 1], this.state[n * 3 + 2], this.rgb), o);
        advance(this.state, n * 3, h);
      }
      for (let k = 0; k < TAIL; k++) {
        fade[n * TAIL + k] = Math.pow(1 - k / (TAIL - 1), 1.6);
        if (k < TAIL - 1) index.push(n * TAIL + k, n * TAIL + k + 1);
      }
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    geometry.setIndex(index);
    this.tails = new THREE.LineSegments(geometry, this.own(lineMaterial(this.uniforms, 0.85)));
    this.tails.frustumCulled = false;
    return this.tails;
  }

  /** A glowing dot at the head of each tail; a few burn larger. */
  private buildHeads() {
    const size = new Float32Array(SPARKS);
    for (let n = 0; n < SPARKS; n++) size[n] = Math.random() < 0.08 ? rand(0.06, 0.09) : rand(0.026, 0.044);
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('aWander', new THREE.BufferAttribute(new Float32Array(SPARKS * 4), 4));
    this.heads = new THREE.Points(geometry, this.own(dotMaterial(this.uniforms)));
    this.heads.frustumCulled = false;
    trackPixels(this.heads, this.uniforms);
    return this.heads;
  }

  /** Loose motes in the space around the butterfly, drifting and twinkling. */
  private buildMotes() {
    const pos = new Float32Array(MOTES * 3);
    const col = new Float32Array(MOTES * 3);
    const size = new Float32Array(MOTES);
    const wander = new Float32Array(MOTES * 4);
    const tints = [[1.0, 0.82, 0.48], [1.0, 0.74, 0.42], [0.74, 0.66, 1.0], [0.95, 0.92, 1.0]];
    for (let i = 0; i < MOTES; i++) {
      pos.set([rand(-0.42, 0.42), rand(-0.42, 0.42), rand(-0.42, 0.42)], i * 3);
      col.set(tints[Math.random() < 0.6 ? Math.floor(rand(0, 2)) : Math.floor(rand(2, 4))], i * 3);
      size[i] = Math.random() < 0.15 ? rand(0.05, 0.075) : rand(0.015, 0.035);
      wander.set([rand(0, 6.3), rand(0, 6.3), rand(0, 6.3), rand(0.01, 0.035)], i * 4);
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('aWander', new THREE.BufferAttribute(wander, 4));
    const motes = new THREE.Points(geometry, this.own(dotMaterial(this.uniforms)));
    motes.frustumCulled = false;
    trackPixels(motes, this.uniforms);
    return motes;
  }

  // ---------- running ----------

  step(dt: number) {
    this.t += dt;
    this.uniforms.uTime.value = this.t;
    // A little brighter at night, when there is less light in the room.
    this.uniforms.uIntensity.value = 0.95 + 0.3 * (1 - this.ctx.light.daylight);

    const pos = this.tails.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.tails.geometry.getAttribute('color') as THREE.BufferAttribute;
    const headPos = this.heads.geometry.getAttribute('position') as THREE.BufferAttribute;
    const headCol = this.heads.geometry.getAttribute('color') as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    if (dt > 0 && ++this.steps % TAIL_EVERY === 0) {
      // Every tail moves back one place at once; the oldest place of each
      // spills into the next spark's newest, which is written over below.
      // In between, only the newest place moves, following the spark.
      p.copyWithin(3, 0, p.length - 3);
      c.copyWithin(3, 0, c.length - 3);
    }
    this.watchClouds(dt);
    const h = SPEED * dt;
    for (let n = 0; n < SPARKS; n++) {
      const i = n * 3;
      if (h > 0) advance(this.state, i, h);
      const o = n * TAIL * 3;
      this.place(this.state, i, p, o);
      hue(this.state[i], this.state[i + 1], this.state[i + 2], this.rgb);
      const f = this.fresh[n];
      if (f > 0) for (let k = 0; k < 3; k++) this.rgb[k] += (BURST_COLOR[k] - this.rgb[k]) * f;
      c.set(this.rgb, o);
      (headPos.array as Float32Array).set(p.subarray(o, o + 3), i);
      (headCol.array as Float32Array).set(this.rgb, i);
    }
    pos.needsUpdate = col.needsUpdate = headPos.needsUpdate = headCol.needsUpdate = true;
  }

  /** Fade each cloud's colour by how far it has spread, and let go of scattered ones. */
  private watchClouds(dt: number) {
    const s = this.state;
    this.clouds = this.clouds.filter((cloud) => {
      cloud.age += dt;
      // Sparks taken into a newer cloud have left this one.
      cloud.members = cloud.members.filter((n) => this.cloudOf[n] === cloud.id);
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const n of cloud.members) {
        cx += s[n * 3];
        cy += s[n * 3 + 1];
        cz += s[n * 3 + 2];
      }
      const count = Math.max(1, cloud.members.length);
      cx /= count;
      cy /= count;
      cz /= count;
      let spread = 0;
      for (const n of cloud.members) spread += Math.hypot(s[n * 3] - cx, s[n * 3 + 1] - cy, s[n * 3 + 2] - cz);
      spread /= count;
      const t = Math.min(1, Math.max(0, (spread - SPREAD_FADE_FROM) / (SPREAD_GONE - SPREAD_FADE_FROM)));
      const target = cloud.age > CLOUD_LIFE ? 0 : 1 - t * t * (3 - 2 * t);
      let f = 0;
      for (const n of cloud.members) {
        f = this.fresh[n] = Math.max(target, this.fresh[n] - dt / FADE_AT_LEAST);
        if (f === 0) this.cloudOf[n] = -1;
      }
      return f > 0 && cloud.members.length > 0;
    });
  }

  // ---------- touch ----------

  private readonly local = new THREE.Ray();
  private readonly inverse = new THREE.Matrix4();
  private readonly at = new THREE.Vector3();

  pointer(e: WorldPointerEvent) {
    if (e.kind !== 'click' || !e.ray.intersectsBox(this.ctx.bounds)) return false;
    // The spark nearest the line of sight releases the burst.
    this.local.copy(e.ray).applyMatrix4(this.inverse.copy(this.space.matrixWorld).invert());
    const p = (this.tails.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let best = 0;
    let bestD = Infinity;
    for (let n = 0; n < SPARKS; n++) {
      const d = this.local.distanceSqToPoint(this.at.fromArray(p, n * TAIL * 3));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    this.burst(best);
    return true;
  }

  /**
   * Gather BURST other sparks onto spark `from`, close enough to look like
   * one, into a cloud of their own colour. The count of sparks never
   * changes: these leave wherever they were.
   */
  private burst(from: number) {
    const s = this.state;
    const p = (this.tails.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const cloud: Cloud = { id: this.nextCloud++, members: [from], age: 0 };
    this.cloudOf[from] = cloud.id;
    this.fresh[from] = 1;
    for (let b = 0; b < BURST; b++) {
      const n = Math.floor(Math.random() * SPARKS);
      if (n === from || this.cloudOf[n] === cloud.id) continue;
      for (let k = 0; k < 3; k++) s[n * 3 + k] = s[from * 3 + k] + rand(-BURST_GAP, BURST_GAP);
      this.cloudOf[n] = cloud.id;
      this.fresh[n] = 1;
      cloud.members.push(n);
      // Start its tail afresh at the burst, so no streak jumps across.
      const o = n * TAIL * 3;
      for (let k = 0; k < TAIL; k++) p.copyWithin(o + k * 3, from * TAIL * 3, from * TAIL * 3 + 3);
    }
    this.clouds.push(cloud);
  }

  dispose() {
    for (const thing of this.owned) thing.dispose();
  }
}
