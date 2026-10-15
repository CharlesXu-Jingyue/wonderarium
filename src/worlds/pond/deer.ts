import * as THREE from 'three';
import { mesh, rand, type Look } from '../kit';
import type { NavGrid } from '../nav';
import { P } from './look';
import { GRASS, groundHeight, pondInward, pondSdf, WATER } from './terrain';

// A fawn that visits now and then. It steps in through one of the glass
// walls (the cube cuts it off until it is inside), goes down to the water
// to drink, sometimes grazes a little or lies down in the grass to rest,
// and wanders out through another wall. More visits at dawn and dusk, as
// deer keep. A tap on the glass sends it bounding away.

export interface Woods {
  nav: NavGrid;
  ripple(x: number, z: number, strength: number): void;
  daylight(): number;
  viewer(): THREE.Vector2;
}

/** The fawn's pose, as dials the model follows smoothly. */
interface Pose {
  walk: number;
  /** Head down to the water or the grass. */
  lower: number;
  /** Lying down, legs folded. */
  lie: number;
  /** Head high, ears pricked. */
  alert: number;
  headYaw: number;
}

type Task =
  | { kind: 'away'; t: number }
  | { kind: 'walk'; path: THREE.Vector2[]; then: () => void; trot: boolean; pause: number }
  | { kind: 'drink'; t: number; sip: number; look: number; reach: number; fit: number }
  | { kind: 'graze'; t: number }
  | { kind: 'rest'; t: number }
  | { kind: 'idle'; t: number; then: () => void };

const LEN = 0.07; // front to back hooves
const WALK = 0.035;
const TROT = 0.13;
/** Just inside the slab, and well outside the glass. */
const IN = 0.44;
const OUT = 0.62;
/** How far out it settles to graze or rest, so it is never half through the glass. */
const ROOM = 0.37;
/** How far above the meadow a drinking spot may stand: off the ridge, onto the low bank. */
const LOW_BANK = 0.015;

export class Deer {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly ears: THREE.Group[] = [];
  private readonly legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  private readonly lids: THREE.Mesh[] = [];

  /** True while the pointer rests on it. */
  watched = false;
  private task: Task = { kind: 'away', t: rand(30, 120) };
  private readonly pose: Pose = { walk: 0, lower: 0, lie: 0, alert: 0, headYaw: 0 };
  private readonly want: Pose = { walk: 0, lower: 0, lie: 0, alert: 0, headYaw: 0 };
  private readonly pos = new THREE.Vector2(OUT, 0);
  private yaw = 0;
  private phase = 0;
  private t = 0;
  private earIn = 2;
  private tailIn = 3;
  private blinkIn = 3;
  private flick = 0;
  private twitch = 0;
  private blink = 0;
  private lookIn = 4;
  private noticed = 0;
  /** How this visit is going: how long, and what it has done. */
  private visit = { t: 0, drank: false, rested: false };

  constructor(look: Look, private readonly woods: Woods) {
    const coat = look.mat(P.deer, { roughness: 0.8 });
    const pale = look.mat(P.deerPale, { roughness: 0.9 });
    const dark = look.mat(P.deerDark, { roughness: 0.6 });
    const ink = look.mat(P.pupil, { roughness: 0.3 });
    const blob = look.blob;
    this.root.add(this.body);

    // Body, with a pale belly and rump and the white spots of a fawn.
    this.body.add(
      mesh(blob, coat, [0, 0.08, 0], [0.02, 0.023, 0.041]),
      mesh(blob, pale, [0, 0.07, 0.002], [0.016, 0.014, 0.031]),
      mesh(blob, pale, [0, 0.084, -0.036], [0.014, 0.015, 0.009]),
    );
    const spots: [number, number][] = [[0.008, 0.02], [-0.009, 0.012], [0.01, -0.004], [-0.007, -0.012], [0.006, -0.024], [-0.004, 0.028], [0, 0.0]];
    for (const [x, z] of spots) this.body.add(mesh(blob, pale, [x, 0.0995 - Math.abs(x) * 0.5, z], [0.0032, 0.0012, 0.0036]));
    this.tail.position.set(0, 0.092, -0.042);
    this.tail.add(mesh(blob, coat, [0, 0, -0.003], [0.0045, 0.008, 0.004], [0.5, 0, 0]));
    this.body.add(this.tail);

    // Neck and head, which lower together to drink.
    // The neck runs along its group's +y; the group leans it forward.
    this.neck.position.set(0, 0.088, 0.032);
    this.neck.add(mesh(blob, coat, [0, 0.022, 0], [0.0095, 0.027, 0.011]));
    this.body.add(this.neck);
    this.head.position.set(0, 0.048, 0);
    this.neck.add(this.head);
    this.head.add(
      mesh(blob, coat, [0, 0, 0.006], [0.011, 0.011, 0.015]),
      mesh(blob, pale, [0, -0.004, 0.02], [0.0065, 0.006, 0.01]),
      mesh(blob, ink, [0, -0.001, 0.0295], 0.0026),
    );
    for (const side of [1, -1]) {
      this.head.add(
        mesh(blob, ink, [side * 0.0085, 0.003, 0.012], 0.0026),
        mesh(blob, look.mat('#FFFFFF', { roughness: 0.2 }), [side * 0.0095, 0.004, 0.0135], 0.0008),
      );
      const lid = mesh(blob, coat, [side * 0.0087, 0.003, 0.012], 0.0029);
      lid.scale.y = 0.0001;
      this.lids.push(lid);
      this.head.add(lid);
      const ear = new THREE.Group();
      ear.position.set(side * 0.007, 0.008, -0.002);
      ear.rotation.set(0, side * 0.3, -side * 0.75);
      ear.add(
        mesh(look.gem, coat, [0, 0.011, 0], [0.0055, 0.012, 0.0025]),
        mesh(look.gem, pale, [0, 0.011, 0.0012], [0.0035, 0.008, 0.0015]),
      );
      this.ears.push(ear);
      this.head.add(ear);
    }

    // Four slim legs, each a thigh and a shin, hinged at hip and knee.
    const upper = new THREE.CylinderGeometry(0.0042, 0.0032, 0.032, 5);
    const lower = new THREE.CylinderGeometry(0.0028, 0.0022, 0.031, 5);
    for (const front of [true, false]) {
      for (const side of [1, -1]) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.011, 0.064, front ? 0.027 : -0.027);
        const knee = new THREE.Group();
        knee.position.y = -0.032;
        hip.add(mesh(upper, coat, [0, -0.016, 0]), knee);
        knee.add(mesh(lower, coat, [0, -0.0155, 0]), mesh(blob, dark, [0, -0.031, 0.001], [0.003, 0.0025, 0.0035]));
        this.body.add(hip);
        this.legs.push({ hip, knee, front, side });
      }
    }
    this.root.visible = false;
  }

  /** In the box, and not just a hidden part beyond the glass. */
  get here() {
    return this.root.visible && Math.abs(this.pos.x) < 0.47 && Math.abs(this.pos.y) < 0.47;
  }

  /** A click: it looks your way and flicks its ears and tail. */
  poke() {
    this.noticed = 3;
    this.flick = 1;
    this.twitch = 1;
  }

  /** A tap on the glass: up and away, out of the box. */
  startle() {
    const t = this.task;
    if (t.kind === 'away' || (t.kind === 'walk' && t.trot)) return;
    this.want.alert = 1;
    this.task = {
      kind: 'idle',
      t: this.pose.lie > 0.5 ? 0.9 : 0.5,
      then: () => this.leave(true),
    };
  }

  // ---------- planning ----------

  /**
   * A spot on the bank to drink from: where to stand, and the water it faces.
   * Only on the low side, where the meadow comes gently down to the water;
   * a deer would not perch up on the ridge and crane down over the drop.
   */
  private drinkSpot() {
    for (let i = 0; i < 80; i++) {
      const a = rand(0, Math.PI * 2);
      const p = new THREE.Vector2(0.07 + Math.cos(a) * 0.5, 0.05 + Math.sin(a) * 0.5);
      // Walk in toward the water until just short of it.
      for (let k = 0; k < 80 && pondSdf(p.x, p.y) > 0.048; k++) p.addScaledVector(pondInward(p.x, p.y), 0.008);
      if (Math.abs(p.x) > 0.42 || Math.abs(p.y) > 0.42 || !this.woods.nav.free(p)) continue;
      if (groundHeight(p.x, p.y) > GRASS + LOW_BANK) continue;
      return p;
    }
    return null;
  }

  /** Far enough from the walls to settle here. */
  private roomy() {
    return Math.abs(this.pos.x) < ROOM && Math.abs(this.pos.y) < ROOM;
  }

  /** Open grass, well away from the water, that it can walk to from here. */
  private grassSpot() {
    const nav = this.woods.nav;
    for (let i = 0; i < 400; i++) {
      const p = new THREE.Vector2(rand(-ROOM, ROOM), rand(-ROOM, ROOM));
      if (pondSdf(p.x, p.y) < 0.09) continue;
      const roomy = nav.free(p) && nav.free(p.clone().addScalar(0.03)) && nav.free(p.clone().addScalar(-0.03));
      if (roomy && nav.connected([this.pos, p])) return p;
    }
    return null;
  }

  /**
   * A way in or out: a point just inside a wall and one well beyond it,
   * from which `reach` can be walked to. Nearest to `near`, if given.
   */
  private door(reach: THREE.Vector2, near?: THREE.Vector2) {
    const options: { inside: THREE.Vector2; outside: THREE.Vector2 }[] = [];
    for (let k = -0.36; k <= 0.36; k += 0.06) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const inside = new THREE.Vector2(nx ? nx * IN : k, nz ? nz * IN : k);
        if (!this.woods.nav.free(inside) || !this.woods.nav.connected([inside, reach])) continue;
        options.push({ inside, outside: new THREE.Vector2(nx ? nx * OUT : k, nz ? nz * OUT : k) });
      }
    }
    if (!options.length) return null;
    if (near) {
      options.sort((a, b) => a.inside.distanceTo(near) - b.inside.distanceTo(near));
      return options[Math.floor(Math.random() * Math.min(3, options.length))];
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  private walkTo(goal: THREE.Vector2, then: () => void, trot = false, finish?: THREE.Vector2) {
    const path = this.woods.nav.route(this.pos, goal);
    if (!path) {
      this.leave(trot);
      return;
    }
    if (finish) path.push(finish.clone());
    this.task = { kind: 'walk', path, then, trot, pause: 0 };
  }

  private arrive() {
    // Come in wherever the water can be reached from, as most visits want a drink.
    const drink = this.drinkSpot();
    const door = drink && this.door(drink);
    if (!door || !drink) {
      this.task = { kind: 'away', t: rand(60, 120) };
      return;
    }
    this.pos.copy(door.outside);
    this.yaw = Math.atan2(door.inside.x - door.outside.x, door.inside.y - door.outside.y);
    this.root.visible = true;
    Object.assign(this.pose, { walk: 0, lower: 0, lie: 0, alert: 0, headYaw: 0 });
    this.visit = { t: 0, drank: false, rested: false };
    // Straight in through the glass, then see what it feels like doing.
    this.task = { kind: 'walk', path: [door.inside.clone()], trot: false, then: () => this.next(), pause: 0 };
  }

  /**
   * Whatever it fancies next, weighed loosely: a drink if it has not had
   * one, a nibble of grass, a stroll, a moment standing still to look about,
   * a lie-down, or off home, likelier the longer it has stayed.
   */
  private next() {
    const night = 1 - this.woods.daylight();
    const v = this.visit;
    const options: [string, number][] = [
      ['drink', v.drank ? 0.25 : 1.5],
      ['graze', 0.6],
      ['stroll', 0.45],
      ['look', 0.35],
      ['rest', v.rested ? 0 : 0.35 + 0.3 * night],
      ['leave', 0.05 + v.t / 150],
    ];
    // Drawn by lot, in proportion to the weights: likely things happen
    // most, but anything can.
    let roll = Math.random() * options.reduce((sum, [, w]) => sum + w, 0);
    const choice = options.find(([, w]) => (roll -= w) <= 0)?.[0] ?? 'leave';
    const then = () => this.next();
    switch (choice) {
      case 'drink': {
        const spot = this.drinkSpot();
        if (spot && this.woods.nav.connected([this.pos, spot])) {
          this.walkTo(spot, () => {
            v.drank = true;
            this.task = { kind: 'drink', t: rand(10, 30), sip: 1.5, look: rand(3, 8), reach: 1, fit: 0 };
          });
        } else this.task = { kind: 'idle', t: rand(2, 4), then };
        return;
      }
      case 'graze': {
        // Right here if the grass is fine, otherwise somewhere nearby.
        const here = pondSdf(this.pos.x, this.pos.y) > 0.07 && this.roomy();
        const spot = here ? null : this.grassSpot();
        if (here) this.task = { kind: 'graze', t: rand(6, 20) };
        else if (spot) this.walkTo(spot, () => (this.task = { kind: 'graze', t: rand(6, 20) }));
        else this.task = { kind: 'idle', t: rand(2, 4), then };
        return;
      }
      case 'stroll': {
        const spot = this.grassSpot();
        if (spot) this.walkTo(spot, () => (this.task = { kind: 'idle', t: rand(1, 4), then }));
        else this.task = { kind: 'idle', t: rand(2, 4), then };
        return;
      }
      case 'look':
        this.want.alert = 0.5;
        this.task = { kind: 'idle', t: rand(3, 8), then };
        return;
      case 'rest': {
        const spot = pondSdf(this.pos.x, this.pos.y) > 0.09 && this.roomy() ? this.pos.clone() : this.grassSpot();
        const lie = () => {
          v.rested = true;
          this.task = { kind: 'rest', t: rand(40, 110) * (1 + night) };
        };
        if (!spot) this.task = { kind: 'idle', t: rand(2, 4), then };
        else if (spot.equals(this.pos)) lie();
        else this.walkTo(spot, lie);
        return;
      }
      default:
        this.leave(false);
    }
  }

  private leave(trot: boolean) {
    const door = this.door(this.pos, trot ? this.pos : undefined);
    if (!door) {
      this.task = { kind: 'away', t: rand(90, 240) };
      this.root.visible = false;
      return;
    }
    this.walkTo(
      door.inside,
      () => {
        this.root.visible = false;
        this.watched = false;
        // Deer come by more often around dawn and dusk.
        const d = this.woods.daylight();
        const twilight = d > 0.05 && d < 0.8;
        this.task = { kind: 'away', t: rand(180, 480) * (twilight ? 0.5 : 1) };
      },
      trot,
      door.outside,
    );
  }

  // ---------- each step ----------

  step(dt: number) {
    this.t += dt;
    const task = this.task;
    const want = this.want;
    want.walk = 0;
    want.lower = 0;
    want.lie = 0;
    want.alert = Math.max(0, want.alert - dt * 0.5);

    if (this.root.visible) this.visit.t += dt;
    switch (task.kind) {
      case 'away':
        if ((task.t -= dt) <= 0) this.arrive();
        return;
      case 'walk': {
        // Get up first, if it was lying down.
        if (this.pose.lie > 0.15) break;
        // Now and then, on a long unhurried walk, it stops to look about.
        if (task.pause > 0) {
          task.pause -= dt;
          break;
        }
        if (!task.trot && task.path.length > 1 && Math.random() < dt * 0.05) {
          task.pause = rand(1.5, 4);
          this.lookIn = 0;
          break;
        }
        const target = task.path[0];
        const to = target.clone().sub(this.pos);
        const d = to.length();
        const speed = task.trot ? TROT : WALK;
        want.walk = task.trot ? 2 : 1;
        if (task.trot) want.alert = 1;
        this.turnTo(Math.atan2(to.x, to.y), dt * (task.trot ? 5 : 2.2));
        // Only walk on once roughly facing the way, so it turns before it goes.
        let ahead = Math.cos(Math.atan2(to.x, to.y) - this.yaw);
        ahead = Math.max(0, ahead);
        const step = Math.min(d, speed * dt * (0.25 + 0.75 * ahead));
        this.pos.addScaledVector(to.normalize(), step);
        if (d < 0.004) {
          task.path.shift();
          if (!task.path.length) task.then();
        }
        break;
      }
      case 'drink': {
        // Face the water, head down, lapping; now and then look up.
        const facing = pondInward(this.pos.x, this.pos.y);
        this.turnTo(Math.atan2(facing.x, facing.y), dt * 1.5);
        task.t -= dt;
        task.look -= dt;
        const lookingUp = task.look < 0;
        if (task.look < -2.5) task.look = rand(4, 9);
        // Lower the head just until the muzzle meets the surface.
        if (task.fit <= 0) {
          task.fit = 1;
          task.reach = this.reachWater();
        }
        task.fit -= dt;
        want.lower = lookingUp ? 0 : task.reach;
        const m = this.muzzle();
        if (!lookingUp && this.pose.lower > task.reach - 0.05 && (task.sip -= dt) <= 0) {
          task.sip = rand(0.9, 1.6);
          if (pondSdf(m.x, m.z) < 0.01) this.woods.ripple(m.x, m.z, 0.35);
        }
        if (task.t <= 0) this.next();
        break;
      }
      case 'graze':
        want.lower = 0.8;
        if ((task.t -= dt) <= 0) this.next();
        break;
      case 'rest':
        want.lie = 1;
        if ((task.t -= dt) <= 0) this.next();
        break;
      case 'idle':
        if (this.pose.lie > 0.5) want.lie = 0;
        if ((task.t -= dt) <= 0) task.then();
        break;
    }

    // Look about now and then; look at you when you point at it or click it.
    this.noticed = Math.max(0, this.noticed - dt);
    if ((this.lookIn -= dt) <= 0) {
      this.lookIn = rand(3, 8);
      want.headYaw = Math.random() < 0.5 ? rand(-0.7, 0.7) : 0;
    }
    if ((this.watched || this.noticed > 0) && task.kind !== 'walk') {
      const v = this.woods.viewer();
      let a = Math.atan2(v.x - this.pos.x, v.y - this.pos.y) - this.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      want.headYaw = THREE.MathUtils.clamp(a, -1.2, 1.2);
      want.lower = 0;
      want.alert = Math.max(want.alert, 0.6);
    }
    this.animate(dt);
  }

  private turnTo(goal: number, rate: number) {
    let d = goal - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += THREE.MathUtils.clamp(d, -rate, rate);
  }

  /** Where the tip of its nose is, in world space. */
  private muzzle() {
    this.root.updateMatrixWorld(true);
    return this.head.localToWorld(new THREE.Vector3(0, -0.002, 0.031));
  }

  private animate(dt: number) {
    const p = this.pose;
    const w = this.want;
    const ease = (k: keyof Pose, rate: number) => (p[k] += (w[k] - p[k]) * Math.min(1, dt * rate));
    ease('walk', 4);
    ease('lower', 1.6);
    ease('lie', 0.9);
    ease('alert', 3);
    ease('headYaw', 2);
    this.phase += dt * (p.walk > 1 ? 15 : 8) * Math.min(1, p.walk);
    this.place();

    // Ears twitch, the tail flicks, the eyes blink (and droop when resting at night).
    if ((this.earIn -= dt) <= 0) {
      this.earIn = rand(1.5, 6);
      this.twitch = 1;
    }
    this.twitch = Math.max(0, this.twitch - dt * 4);
    this.ears.forEach((e, i) => {
      const side = i === 0 ? 1 : -1;
      e.rotation.z = -side * (0.75 - 0.35 * p.alert) + Math.sin(this.twitch * 12) * 0.25 * this.twitch * (i === 0 ? 1 : 0.4);
      e.rotation.x = -0.3 * p.alert;
    });
    if ((this.tailIn -= dt) <= 0) {
      this.tailIn = rand(2, 7);
      this.flick = 1;
    }
    this.flick = Math.max(0, this.flick - dt * 3);
    this.tail.rotation.x = -0.4 * p.alert - Math.sin(this.flick * 14) * 0.5 * this.flick;
    if ((this.blinkIn -= dt) <= 0) {
      this.blinkIn = rand(2.5, 6);
      this.blink = 0.15;
    }
    this.blink = Math.max(0, this.blink - dt);
    const sleepy = p.lie * (1 - this.woods.daylight()) * 0.6;
    const lid = Math.max(this.blink > 0 ? 1 : 0, sleepy);
    for (const l of this.lids) l.scale.y = 0.0029 * Math.max(0.03, lid);
  }

  /** Set every joint from the pose dials as they are now (no easing, no timers). */
  private place() {
    const p = this.pose;
    // Stand on the slope: front and back hooves each on the ground.
    const fx = this.pos.x + Math.sin(this.yaw) * LEN * 0.5;
    const fz = this.pos.y + Math.cos(this.yaw) * LEN * 0.5;
    const bx = this.pos.x - Math.sin(this.yaw) * LEN * 0.5;
    const bz = this.pos.y - Math.cos(this.yaw) * LEN * 0.5;
    const hf = groundHeight(fx, fz);
    const hb = groundHeight(bx, bz);
    this.root.position.set(this.pos.x, (hf + hb) / 2, this.pos.y);
    this.root.rotation.y = this.yaw;
    this.body.rotation.x = Math.atan2(hb - hf, LEN) * (1 - p.lie) + 0.12 * p.lower * (1 - p.lie);

    // Gait: diagonal pairs swing together; knees lift on the forward swing.
    const stride = Math.min(1, p.walk);
    const bounce = Math.abs(Math.sin(this.phase)) * 0.004 * stride * (p.walk > 1 ? 2 : 1);
    this.body.position.y = -0.055 * p.lie + bounce - 0.02 * p.lower * (1 - p.lie);
    for (const leg of this.legs) {
      const ph = this.phase + (leg.front === (leg.side > 0) ? 0 : Math.PI);
      const swing = Math.sin(ph) * (p.walk > 1 ? 0.6 : 0.38) * stride;
      const lift = Math.max(0, -Math.cos(ph)) * 0.7 * stride;
      // Lying: each leg folds flat under the body, front shins tucked back,
      // hind shins tucked forward.
      const lieHip = leg.front ? -1.35 : 1.35;
      const lieKnee = leg.front ? 2.9 : -2.9;
      // Drinking: front legs splay a little to bring the shoulders down.
      const splay = leg.front ? -0.25 * p.lower : 0;
      leg.hip.rotation.x = THREE.MathUtils.lerp(swing + splay, lieHip, p.lie);
      leg.hip.rotation.z = leg.side * 0.12 * p.lower * (leg.front ? 1 : 0) * (1 - p.lie);
      leg.knee.rotation.x = THREE.MathUtils.lerp((leg.front ? 1 : -1) * lift, lieKnee, p.lie);
    }

    // Neck: at rest it leans forward with the head held level; lowered, it
    // reaches forward and down and the muzzle points at the ground.
    const graze = p.lower * (1 - p.lie);
    const neck = 0.55 + 1.95 * graze - 0.25 * p.alert;
    this.neck.rotation.x = neck;
    this.neck.rotation.y = p.headYaw * (1 - graze) * 0.6;
    const lap = this.task.kind === 'drink' ? 1 : 0.4;
    this.head.rotation.x = THREE.MathUtils.lerp(-neck - 0.05, Math.PI / 2 - neck, graze) + Math.sin(this.t * 9) * 0.05 * graze * lap;
    this.head.rotation.y = p.headYaw * (1 - graze) * 0.5;
  }

  /**
   * How far to lower the head so the muzzle just meets the water from where
   * it stands: found by trying the pose, not by chasing it, so the head
   * settles once instead of bobbing.
   */
  private reachWater() {
    const saved = this.pose.lower;
    let lo = 0.4;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      this.pose.lower = mid;
      this.place();
      if (this.muzzle().y < WATER - 0.003) hi = mid;
      else lo = mid;
    }
    this.pose.lower = saved;
    this.place();
    return hi;
  }
}
