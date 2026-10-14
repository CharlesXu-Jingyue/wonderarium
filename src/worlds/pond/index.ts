import * as THREE from 'three';
import { glassHit, Look, mesh, rand, seeded } from '../kit';
import type { World, WorldContext, WorldPointerEvent } from '../world';
import { Dragonfly } from './dragonfly';
import { Drift } from './drift';
import { Effects } from './effects';
import { Frog, type FrogWorld, type Perch } from './frog';
import { Koi, type Pellet, type Pond } from './koi';
import { P } from './look';
import { Cattails, fern, flower, grass, leafTree, LilyPad, log, mushrooms, pine, type Swaying, type Tree, Wind } from './plants';
import { buildPebbles, buildStones, buildTerrain, stoneGeometry, groundHeight, pondInward, pondSdf, WATER, type StoneSpec } from './terrain';
import { Water } from './water';

// A forest pond: water falling over mossy rocks into a clear pool, koi
// wandering under the lily pads, a frog on a log, a dragonfly, ferns and
// pines, and fireflies after dark. It asks nothing of you. Click the water
// to scatter a little fish food, click the frog or a tree, or rest the
// pointer on the frog and it will turn to look at you. A click anywhere
// else (the grass, a stone, the air) is a tap on the glass.

interface PondSave {
  v?: number;
  pads?: [number, number, number][];
  frog?: string | null;
}

const SAVE_VERSION = 1;
const MAX_PELLETS = 12;

/** Is `o` part of `root`? */
function within(o: THREE.Object3D | null, root: THREE.Object3D) {
  while (o && o !== root) o = o.parent;
  return !!o;
}

const g = (x: number, z: number, lift = 0): [number, number, number] => [x, groundHeight(x, z) + lift, z];

/**
 * The cleft at the back: two big rocks side by side with a narrow gap
 * between them, closed behind by a third. The spring comes out of the gap.
 */
const CLEFT = { x: -0.43, z: -0.085, gap: 0.005 };
const CLEFT_ROCKS: { side: -1 | 1; size: [number, number, number]; seed: number }[] = [
  { side: -1, size: [0.08, 0.125, 0.075], seed: 31 },
  { side: 1, size: [0.075, 0.105, 0.07], seed: 47 },
];

/** The other rocks: a few around the cleft, a stepping stone, some on the banks. */
const STONES: StoneSpec[] = [
  { at: g(-0.4, -0.29, 0.01), size: [0.05, 0.09, 0.045] },
  { at: g(-0.35, 0.05, 0.0), size: [0.035, 0.05, 0.035] },
  { at: g(-0.48, -0.085, 0.03), size: [0.04, 0.09, 0.05] },
  { at: [-0.33, WATER - 0.012, -0.165], size: [0.03, 0.028, 0.03] },
  { at: [-0.335, WATER - 0.014, 0.0], size: [0.028, 0.024, 0.032] },
  { at: [-0.05, WATER - 0.012, 0.2], size: [0.04, 0.03, 0.036], moss: 0.8 },
  { at: g(0.34, 0.37), size: [0.05, 0.045, 0.045] },
  { at: g(0.43, -0.04), size: [0.04, 0.045, 0.04] },
  { at: g(-0.3, 0.36), size: [0.06, 0.05, 0.05] },
  { at: g(0.02, 0.43), size: [0.035, 0.03, 0.04] },
  { at: g(-0.21, -0.29), size: [0.045, 0.04, 0.04] },
  { at: g(0.44, 0.24), size: [0.03, 0.025, 0.03] },
];
const STEPPING_STONE = 5;
/** Stones standing in the water, which fish and lily pads go around. */
const IN_WATER = [3, 4, 5];

const PINES: [number, number, number][] = [
  [-0.34, -0.34, 0.66],
  [-0.1, -0.375, 0.52],
  [-0.39, 0.12, 0.48],
  [0.1, -0.39, 0.44],
  [-0.38, 0.33, 0.4],
];
const LEAF_TREE: [number, number] = [0.27, -0.29];

const FERNS: [number, number, number][] = [
  [-0.28, 0.24, 0.08], [0.4, 0.3, 0.07], [0.16, 0.42, 0.06], [-0.22, -0.32, 0.07],
  [0.42, -0.14, 0.07], [-0.02, -0.31, 0.06], [-0.36, 0.06, 0.06],
];
const CATTAILS: [number, number, number][] = [
  [-0.12, 0.29, 5], [0.32, 0.0, 4], [0.2, -0.245, 4], [-0.28, 0.1, 3],
];
const LOG = { a: new THREE.Vector2(0.12, 0.3), b: new THREE.Vector2(0.42, 0.14), y: -0.355, r: 0.035 };

const PADS: [number, number, number, 'white' | 'pink' | null][] = [
  [0.02, 0.02, 0.05, null],
  [0.16, 0.08, 0.042, 'white'],
  [-0.16, -0.03, 0.035, null],
  [0.06, 0.24, 0.04, 'pink'],
  [0.15, -0.12, 0.032, null],
  [-0.08, 0.12, 0.028, null],
];

const IMPACT = new THREE.Vector3(-0.32, WATER, -0.085);

export class ForestPond implements World {
  readonly id = 'forest-pond';
  readonly name = 'Forest Pond';
  cursor = '';

  private readonly look = new Look();
  private readonly wind = new Wind();
  private ctx!: WorldContext;
  private terrain!: THREE.Mesh;
  private stones!: THREE.Group;
  private water!: Water;
  private trees: Tree[] = [];
  private swaying: Swaying[] = [];
  private cattails: Cattails[] = [];
  private pads: LilyPad[] = [];
  private koi: Koi[] = [];
  private frog!: Frog;
  private dragonfly!: Dragonfly;
  private drift!: Drift;
  private fx!: Effects;
  private perches: Perch[] = [];
  private readonly pellets: Pellet[] = [];
  /** Circles (x, z, r) that drifting pads keep clear of. */
  private padObstacles: THREE.Vector3[] = [];
  private fishObstacles: THREE.Vector3[] = [];
  private readonly viewer = new THREE.Vector2(2, 2);
  private readonly raycaster = new THREE.Raycaster();
  private visitIn = rand(20, 40);
  private scareIn = 0;
  private t = 0;

  mount(ctx: WorldContext, raw?: unknown) {
    this.ctx = ctx;
    const loaded = (raw && typeof raw === 'object' ? raw : {}) as PondSave;
    const saved = loaded.v === SAVE_VERSION ? loaded : {};
    const root = ctx.root;
    const look = this.look;

    this.terrain = buildTerrain(look);
    this.stones = buildStones(look, STONES);
    root.add(this.terrain, buildPebbles(look), this.stones);
    this.stones.updateMatrixWorld(true);

    // The two rocks of the cleft, set so the gap between them is just so.
    const cleft: THREE.Mesh[] = CLEFT_ROCKS.map(({ side, size, seed }) => {
      const geometry = stoneGeometry(seed, 0.55);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const inner = side < 0 ? box.max.z : box.min.z;
      const rock = new THREE.Mesh(geometry, look.mat('#FFFFFF', { vertexColors: true }));
      const z = CLEFT.z + (side * CLEFT.gap) / 2 - inner * size[2];
      rock.position.set(CLEFT.x, groundHeight(CLEFT.x, z) + 0.02, z);
      rock.scale.set(...size);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.stones.add(rock);
      return rock;
    });
    this.stones.updateMatrixWorld(true);
    // The water comes out low down, not far above the ground.
    const ground = groundHeight(CLEFT.x, CLEFT.z);
    const low = Math.min(...cleft.map((r, i) => r.position.y + CLEFT_ROCKS[i].size[1] * 0.6));
    const springY = ground + (low - ground) * 0.3;
    // Lumpy rocks are not as wide at that height as at their widest, so slide
    // each one in until its face there is just shy of the middle of the gap.
    cleft.forEach((rock, i) => {
      const { side, size } = CLEFT_ROCKS[i];
      let nearest = Infinity;
      for (const k of [0.2, 0.45, 0.7]) {
        this.raycaster.set(new THREE.Vector3(CLEFT.x + size[0] * k, springY, CLEFT.z), new THREE.Vector3(0, 0, side));
        nearest = Math.min(nearest, this.raycaster.intersectObject(rock)[0]?.distance ?? Infinity);
      }
      if (Number.isFinite(nearest)) rock.position.z -= side * (nearest - CLEFT.gap / 2);
      rock.updateMatrixWorld(true);
    });
    const faceAt = (z: number) => {
      this.raycaster.set(new THREE.Vector3(0, springY, z), new THREE.Vector3(-1, 0, 0));
      return this.raycaster.intersectObjects(cleft)[0]?.point.x ?? CLEFT.x + 0.06;
    };
    const front = Math.max(faceAt(CLEFT.z - CLEFT.gap), faceAt(CLEFT.z + CLEFT.gap));
    // It wells up at the back of the gap and runs out between the rocks.
    const source = new THREE.Vector3(front - 0.035, springY, CLEFT.z);
    const lip = new THREE.Vector3(front + 0.004, springY - 0.004, CLEFT.z);
    this.water = new Water(source, lip, IMPACT);
    root.add(this.water.group);

    // Trees.
    PINES.forEach(([x, z, h], i) => {
      const t = pine(look, 11 + i * 7, h);
      t.group.position.set(x, groundHeight(x, z) - 0.01, z);
      this.trees.push(t);
    });
    const big = leafTree(look, 5);
    big.group.position.set(LEAF_TREE[0], groundHeight(...LEAF_TREE) - 0.01, LEAF_TREE[1]);
    // Lean out toward the middle of the pond.
    big.group.rotation.y = -Math.atan2(0.1 - LEAF_TREE[1], 0.07 - LEAF_TREE[0]);
    this.trees.push(big);
    for (const t of this.trees) root.add(t.group);

    // Low plants.
    const avoid = (x: number, z: number) =>
      STONES.some((s) => Math.hypot(x - s.at[0], z - s.at[2]) < Math.max(s.size[0], s.size[2]) * 1.05) ||
      Math.hypot(x - CLEFT.x, z - CLEFT.z) < 0.13 ||
      this.trees.some((t) => Math.hypot(x - t.group.position.x, z - t.group.position.z) < 0.04);
    root.add(grass(look, this.wind, 260, avoid));
    FERNS.forEach(([x, z, s], i) => {
      const f = fern(look, this.wind, 60 + i, s);
      f.position.set(...g(x, z, -0.003));
      root.add(f);
    });
    CATTAILS.forEach(([x, z, n], i) => {
      const c = new Cattails(look, this.wind, 80 + i * 5, n);
      c.group.position.set(x, Math.max(groundHeight(x, z), WATER - 0.01), z);
      this.cattails.push(c);
      this.swaying.push(...c.stalks);
      root.add(c.group);
    });
    const rnd = seeded(97);
    for (let i = 0, tries = 0; i < 18 && tries < 400; tries++) {
      const x = rnd(-0.45, 0.45);
      const z = rnd(-0.45, 0.45);
      if (pondSdf(x, z) < 0.04 || avoid(x, z)) continue;
      const f = flower(look, 200 + i);
      f.obj.position.set(...g(x, z));
      this.swaying.push(f);
      root.add(f.obj);
      i++;
    }
    const shrooms = [mushrooms(look, 3), mushrooms(look, 4)];
    shrooms[0].position.set(...g(0.33, -0.24));
    shrooms[1].position.set(...g(-0.26, -0.38));
    root.add(...shrooms);
    root.add(log(look, LOG.a, LOG.b, LOG.y, LOG.r));

    // Obstacles in the water.
    this.fishObstacles = IN_WATER.map((i) => new THREE.Vector3(STONES[i].at[0], STONES[i].at[2], STONES[i].size[0] * 1.1));
    this.padObstacles = [...this.fishObstacles, new THREE.Vector3(IMPACT.x, IMPACT.z, 0.05)];
    for (let k = 0; k <= 4; k++) {
      const p = new THREE.Vector2().lerpVectors(LOG.a, LOG.b, k / 4);
      this.padObstacles.push(new THREE.Vector3(p.x, p.y, LOG.r));
    }

    // Lily pads, where they last drifted to.
    PADS.forEach(([x, z, r, fl], i) => {
      const pad = new LilyPad(look, 300 + i, r, fl);
      const at = saved.pads?.[i];
      const ok = at && at.every(Number.isFinite) && pondSdf(at[0], at[1]) < -r;
      pad.group.position.set(ok ? at[0] : x, WATER, ok ? at[1] : z);
      pad.group.rotation.y = ok ? at[2] : rand(0, Math.PI * 2);
      pad.spin = rand(-0.02, 0.02);
      this.pads.push(pad);
      root.add(pad.group);
    });

    // Perches for the frog: two on the log, the stepping stone, two banks, the big pads.
    const onLog = (k: number) => {
      const p = new THREE.Vector2().lerpVectors(LOG.a, LOG.b, k);
      return new THREE.Vector3(p.x, LOG.y + LOG.r - 0.002, p.y);
    };
    const stone = STONES[STEPPING_STONE].at;
    const stoneTop = this.topOf([this.stones.children[STEPPING_STONE]], stone[0], stone[2]) ?? WATER + 0.01;
    this.perches = [
      { id: 'log-near', spot: onLog(0.3) },
      { id: 'log-far', spot: onLog(0.62) },
      { id: 'stone', spot: new THREE.Vector3(stone[0], stoneTop - 0.002, stone[2]) },
      { id: 'bank-front', spot: this.bankSpot(0.03, 0.39) },
      { id: 'bank-left', spot: this.bankSpot(-0.24, 0.2) },
      ...this.pads.filter((p) => p.r >= 0.04).map((pad, i) => ({ id: `pad-${i}`, pad })),
    ];

    this.fx = new Effects();
    this.drift = new Drift(look);
    root.add(this.fx.group, this.drift.group);

    // Animals.
    this.koi = [
      new Koi(look, 'kohaku', new THREE.Vector2(0.0, 0.1), 1.35),
      new Koi(look, 'orange', new THREE.Vector2(0.12, 0.0), 1.2),
      new Koi(look, 'gold', new THREE.Vector2(-0.15, -0.05), 1.05),
    ];
    for (const k of this.koi) root.add(k.root);
    const start = this.perches.find((p) => p.id === saved.frog) ?? this.perches[0];
    this.frog = new Frog(look, start);
    root.add(this.frog.root);
    this.dragonfly = new Dragonfly(look, new THREE.Vector3(0.1, WATER + 0.1, 0.1));
    root.add(this.dragonfly.root);
  }

  /** Height of the first surface straight below (x, 1, z) among these objects. */
  private topOf(objects: THREE.Object3D[], x: number, z: number) {
    this.raycaster.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
    return this.raycaster.intersectObjects(objects, true)[0]?.point.y ?? null;
  }

  /** A dry spot just above the water's edge, in from (x, z). */
  private bankSpot(x: number, z: number) {
    const p = new THREE.Vector2(x, z);
    for (let i = 0; i < 60 && pondSdf(p.x, p.y) > 0.02; i++) p.addScaledVector(pondInward(p.x, p.y), 0.005);
    return new THREE.Vector3(p.x, groundHeight(p.x, p.y), p.y);
  }

  // ---------- simulation ----------

  private get pond(): Pond {
    return {
      pellets: this.pellets,
      eat: (p) => this.removePellet(p),
      ripple: (x, z, s) => this.water.ripple(x, z, s),
      obstacles: this.fishObstacles,
      daylight: () => this.ctx.light.daylight,
    };
  }

  private get frogWorld(): FrogWorld {
    return {
      perches: this.perches,
      obstacles: this.fishObstacles,
      ripple: (x, z, s) => this.water.ripple(x, z, s),
      splash: (at, n) => this.fx.splash(at, n, WATER),
      note: (at) => this.fx.note(at),
      daylight: () => this.ctx.light.daylight,
      viewer: () => this.viewer,
    };
  }

  step(dt: number) {
    this.t += dt;
    const daylight = this.ctx.light.daylight;
    this.wind.step(dt);
    this.water.update(dt, daylight);
    for (const tree of this.trees) tree.update(this.wind, dt);
    for (const s of this.swaying) {
      s.obj.rotation.z = this.wind.at(s.phase) * s.amount * 0.5;
      s.obj.rotation.x = this.wind.at(s.phase + 1.7) * s.amount * 0.3;
    }
    this.stepPads(dt, daylight);
    this.stepPellets(dt);

    const pond = this.pond;
    for (const k of this.koi) k.step(dt, pond, this.koi);
    this.frog.step(dt, this.frogWorld);
    this.dragonfly.step(dt, {
      perches: () => this.cattails.flatMap((c) => c.perches()),
      ripple: (x, z, s) => this.water.ripple(x, z, s),
      daylight: () => daylight,
    });

    // Sometimes the dragonfly comes to look at the frog, and the frog has a go.
    if (daylight > 0.4 && this.frog.sitting && (this.visitIn -= dt) <= 0) {
      this.visitIn = rand(40, 90);
      this.dragonfly.visit(this.frog.mouth());
    }
    if (this.dragonfly.flying && this.frog.sitting) {
      const mouth = this.frog.mouth();
      if (mouth.distanceTo(this.dragonfly.position) < 0.075 && this.frog.snap(this.dragonfly.position)) {
        this.scareIn = 0.12;
      }
    }
    if (this.scareIn > 0 && (this.scareIn -= dt) <= 0) this.dragonfly.scare();

    this.drift.update(dt, daylight, this.trees, this.water);
    this.fx.update(dt);
  }

  private stepPads(dt: number, daylight: number) {
    const t = this.t;
    this.pads.forEach((pad, i) => {
      // A faint, wandering current, plus whatever pushes it.
      const v = pad.vel;
      v.x += Math.sin(t * 0.03 + i * 2.1) * 0.00012 * dt * 60;
      v.y += Math.cos(t * 0.025 + i * 1.3) * 0.00012 * dt * 60;
      const keep = (cx: number, cz: number, r: number) => {
        const dx = pad.x - cx;
        const dz = pad.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 0) {
          v.x += (dx / d) * (r - d) * 2 * dt;
          v.y += (dz / d) * (r - d) * 2 * dt;
        }
      };
      for (const o of this.padObstacles) keep(o.x, o.y, o.z + pad.r + 0.006);
      for (const other of this.pads) if (other !== pad) keep(other.x, other.z, other.r + pad.r + 0.006);
      if (this.frog.inWater) keep(this.frog.root.position.x, this.frog.root.position.z, pad.r + 0.025);
      const s = pondSdf(pad.x, pad.z) + pad.r + 0.004;
      if (s > 0) {
        const inward = pondInward(pad.x, pad.z);
        v.addScaledVector(inward, s * 2 * dt);
      }
      v.multiplyScalar(1 - Math.min(1, dt * 0.6));
      const max = 0.004;
      if (v.length() > max) v.setLength(max);
      pad.group.position.x += v.x * dt;
      pad.group.position.z += v.y * dt;
      const wave = this.water.swell(pad.x, pad.z) + this.water.disturbance(pad.x, pad.z) * 0.0012 * Math.sin(t * 14 + i);
      pad.update(dt, WATER, wave, daylight);
    });
  }

  // ---------- fish food ----------

  private dropFood(at: THREE.Vector2) {
    for (let i = 0; i < 3 && this.pellets.length < MAX_PELLETS; i++) {
      const m = mesh(this.look.blob, this.look.mat(P.food), [at.x + rand(-0.02, 0.02), WATER + rand(0.08, 0.12), at.y + rand(-0.02, 0.02)], 0.0035);
      if (pondSdf(m.position.x, m.position.z) > -0.01) m.position.set(at.x, m.position.y, at.y);
      this.ctx.root.add(m);
      this.pellets.push({ mesh: m, floating: false, age: 0 });
    }
  }

  private removePellet(p: Pellet) {
    const i = this.pellets.indexOf(p);
    if (i >= 0) this.pellets.splice(i, 1);
    this.ctx.root.remove(p.mesh);
  }

  private stepPellets(dt: number) {
    for (const p of [...this.pellets]) {
      const m = p.mesh.position;
      p.age += dt;
      if (!p.floating && p.age < 30) {
        m.y -= dt * (0.15 + p.age * 1.2);
        if (m.y <= WATER) {
          p.floating = true;
          this.water.ripple(m.x, m.z, 0.4);
        }
      } else if (p.floating) {
        m.y = WATER + 0.001 + this.water.swell(m.x, m.z);
        m.x += Math.sin(this.t * 0.2 + p.age) * 0.002 * dt;
        if (p.age > 45) p.floating = false;
      } else {
        // Uneaten: it softens and sinks.
        m.y -= dt * 0.01;
        if (m.y < groundHeight(m.x, m.z)) this.removePellet(p);
      }
    }
  }

  // ---------- pointer ----------

  private hit(ray: THREE.Ray, objects: THREE.Object3D[]) {
    this.raycaster.set(ray.origin, ray.direction);
    return this.raycaster.intersectObjects(objects, true)[0] ?? null;
  }

  private ownerTree(o: THREE.Object3D) {
    return this.trees.find((t) => within(o, t.group));
  }

  pointer(e: WorldPointerEvent): boolean {
    this.viewer.set(e.ray.origin.x, e.ray.origin.z);
    switch (e.kind) {
      case 'hover': {
        const h = this.hit(e.ray, [this.frog.root, ...this.trees.map((t) => t.group)]);
        const onFrog = !!h && !this.ownerTree(h.object);
        this.frog.watched = onFrog;
        this.cursor = h ? 'pointer' : '';
        return false;
      }
      case 'leave':
        this.frog.watched = false;
        this.cursor = '';
        return false;
      case 'click': {
        const solid = [this.frog.root, ...this.trees.map((t) => t.group), this.terrain, this.stones, ...this.pads.map((p) => p.group)];
        const h = this.hit(e.ray, solid);
        const surface = e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER), new THREE.Vector3());
        const wet = surface && pondSdf(surface.x, surface.z) < 0 && (!h || surface.distanceTo(e.ray.origin) <= h.distance + 0.001);
        const onPad = h && this.pads.some((p) => within(h.object, p.group));
        if (wet || onPad) {
          const at = onPad ? h!.point : surface!;
          this.dropFood(new THREE.Vector2(at.x, at.z));
          return true;
        }
        if (h) {
          const tree = this.ownerTree(h.object);
          if (tree) {
            tree.shake();
            this.drift.shed(tree, 3 + Math.floor(Math.random() * 3));
            return true;
          }
          if (within(h.object, this.frog.root)) {
            this.frog.poke();
            return true;
          }
        }
        // Grass, stone or nothing at all: the finger only met the glass.
        const glass = glassHit(e.ray);
        if (!glass) return false;
        this.fx.glassRipple(glass.at, glass.normal);
        const from = new THREE.Vector2(glass.at.x, glass.at.z);
        for (const k of this.koi) k.startle(from);
        this.frog.startle(this.frogWorld);
        this.dragonfly.scare();
        return true;
      }
    }
    return false;
  }

  serialize(): PondSave {
    return {
      v: SAVE_VERSION,
      pads: this.pads.map((p) => [p.x, p.z, p.group.rotation.y % (Math.PI * 2)]),
      frog: this.frog.perch?.id ?? null,
    };
  }

  dispose() {
    this.fx.dispose();
    this.drift.dispose();
  }
}
