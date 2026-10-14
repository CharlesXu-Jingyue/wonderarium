import * as THREE from 'three';
import type { Effects } from './effects';
import { rand } from './look';
import { HamsterModel, restPose, type Pose } from './model';
import { Bottle, GROUND, HAMSTER_R, HS, House, ROAM, S, Wheel, type Capsule, type Furniture } from './scenery';

// The hamster's mind. Five needs rise over time; whenever it finishes
// something, it scores what it could do next and picks the most pressing,
// with a little randomness so it never feels mechanical. Each activity is a
// short sequence of stages (walk there, turn, do the thing, leave).
//
// Nothing can go wrong: the bowl and bottle never run out, so hunger and
// thirst only shape what you get to watch.

export interface Needs {
  hunger: number;
  thirst: number;
  fatigue: number;
  restless: number;
  grooming: number;
}

export interface Treat {
  mesh: THREE.Mesh;
  vy: number;
  landed: boolean;
}

/** What the brain may see and touch of the cage. */
export interface Cage {
  bowl: Furniture;
  wheel: Wheel;
  house: House;
  bottle: Bottle;
  fx: Effects;
  treats: Treat[];
  obstacles(): Capsule[];
  /** Waypoints from one floor point to another around the furniture, or null. */
  route(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] | null;
  /** Changes whenever the furniture moves. */
  navVersion(): number;
  /** Is this floor point clear of furniture, with some margin? */
  isFree(p: THREE.Vector2, margin: number): boolean;
  eatTreat(t: Treat): void;
  daylight(): number;
  /** Where the viewer is, for turning toward them (x, z). */
  viewer(): THREE.Vector2;
}

type Kind =
  | 'wander' | 'sniff' | 'eat' | 'drink' | 'wheel' | 'groom' | 'dig' | 'sleep' | 'hoard'
  | 'treat' | 'startle' | 'pet' | 'held' | 'fall' | 'boop';

interface Task {
  kind: Kind;
  stage: number;
  /** Seconds in the current stage. */
  t: number;
  /** Length of the current stage, when it is timed. */
  dur: number;
  spot: THREE.Vector2;
  from: THREE.Vector3;
  count: number;
  /** Vertical speed while falling. */
  vy: number;
  treat?: Treat;
}

export interface HamsterSave {
  x: number;
  z: number;
  yaw: number;
  needs: Needs;
  cheeks: number;
  asleep: boolean;
}

const WALK = 0.11 * HS;
const STRIDE = 0.035 * HS;
const GIVE_UP = 14;
/** The wheel stage in which it is actually running. */
const RUNNING = 3;
/** Reach of the nose ahead of, and the tail behind, the hamster's centre. */
const NOSE = 0.17 * HS;
const TAIL = 0.14 * HS;
/** Height it is held at when picked up. */
export const HOLD = 0.2; // seconds walking toward something before trying another plan

const tmp = new THREE.Vector2();
const tmp3 = new THREE.Vector3();

function angleTo(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function closestOn(c: Capsule, p: THREE.Vector2, out = new THREE.Vector2()) {
  const ab = tmp.subVectors(c.b, c.a);
  const len = ab.lengthSq();
  const t = len === 0 ? 0 : THREE.MathUtils.clamp(((p.x - c.a.x) * ab.x + (p.y - c.a.y) * ab.y) / len, 0, 1);
  return out.set(c.a.x + ab.x * t, c.a.y + ab.y * t);
}

export class Hamster {
  readonly model: HamsterModel;
  readonly pos = new THREE.Vector2(0.05, 0.05);
  yaw = 0.6;
  /** Height above the bedding (lifted, in the wheel). */
  lift = 0;
  /** False while tucked inside the house. */
  shown = true;
  cheeks = 0;
  readonly needs: Needs = { hunger: 0.3, thirst: 0.3, fatigue: 0.2, restless: 0.4, grooming: 0.2 };
  /** Set by the world while the pointer rests on the hamster. */
  petting = false;
  /** Where the hand wants the hamster while it is held (x, z). */
  readonly holdAt = new THREE.Vector2();

  private task: Task;
  private readonly pose: Pose = restPose();
  private target: Pose = restPose();
  private walkPhase = 0;
  private walking = 0;
  private solid = true;
  private time = 0;
  private petIdle = 0;
  private path: { to: THREE.Vector2; version: number; points: THREE.Vector2[]; age: number } | null = null;

  constructor(
    private readonly cage: Cage,
    look: ConstructorParameters<typeof HamsterModel>[0],
    saved?: HamsterSave,
  ) {
    this.model = new HamsterModel(look);
    this.model.root.scale.setScalar(HS);
    this.task = this.make('sniff');
    if (saved) {
      this.pos.set(saved.x, saved.z);
      this.yaw = saved.yaw;
      Object.assign(this.needs, saved.needs);
      this.cheeks = saved.cheeks;
      if (saved.asleep) {
        this.task = this.make('sleep');
        this.task.stage = 2;
        this.shown = false;
        this.solid = false;
        this.pos.copy(this.cage.house.toWorld(0, -0.06));
        this.yaw = this.cage.house.yaw;
      }
    }
  }

  get asleep() {
    return this.task.kind === 'sleep' && this.task.stage === 2;
  }

  /** Can it be picked up right now? */
  get reachable() {
    return this.shown && this.task.kind !== 'fall';
  }

  get holding() {
    return this.task.kind === 'held';
  }

  /** Standing on open bedding (not in a doorway, the wheel, or the air). */
  get grounded() {
    return this.shown && this.solid && this.lift === 0;
  }

  save(): HamsterSave {
    return { x: this.pos.x, z: this.pos.y, yaw: this.yaw, needs: { ...this.needs }, cheeks: this.cheeks, asleep: this.asleep };
  }

  // ---------- reactions to the outside world ----------

  /** Too absorbed to be distracted: tucked away, in the air, or in the wheel. */
  private get busy() {
    const { kind, stage } = this.task;
    return kind === 'sleep' || kind === 'hoard' || kind === 'held' || kind === 'fall' || (kind === 'wheel' && stage >= 2);
  }

  /** What it is doing, for debugging. */
  get doing() {
    return `${this.task.kind}:${this.task.stage}`;
  }

  /** Someone tapped the glass. */
  startle() {
    if (!this.shown || this.busy) return;
    this.begin('startle');
  }

  /** A seed landed somewhere. */
  noticeTreat() {
    if (this.busy || this.task.kind === 'treat' || this.task.kind === 'eat') return;
    this.begin('treat');
  }

  pickUp() {
    if (!this.reachable) return;
    this.cage.wheel.drive = 0;
    this.holdAt.copy(this.pos);
    this.begin('held');
  }

  drop() {
    if (this.task.kind === 'held') this.begin('fall');
  }

  boop() {
    if (!this.shown || this.busy) return;
    this.begin('boop');
  }

  // ---------- the step ----------

  step(dt: number) {
    this.time += dt;
    this.updateNeeds(dt);
    this.target = restPose();
    this.target.cheeks = this.cheeks;
    this.walking = 0;
    // Idle glances when nothing else is steering the head.
    this.target.headYaw = Math.sin(this.time * 0.7) * 0.25 + Math.sin(this.time * 1.9) * 0.1;

    this.run(dt);
    this.task.t += dt;

    if (this.solid) this.resolve();

    // Ease toward the target pose; the walk cycle follows directly.
    const k = 1 - Math.exp(-dt * 9);
    for (const key of Object.keys(this.pose) as (keyof Pose)[]) {
      this.pose[key] += (this.target[key] - this.pose[key]) * k;
    }
    this.pose.walk = this.walking;

    const r = this.model.root;
    r.position.set(this.pos.x, GROUND + this.lift, this.pos.y);
    r.rotation.y = this.yaw;
    r.visible = this.shown;
    this.model.apply(this.pose, this.walkPhase, this.time, dt, this.asleep);
  }

  private updateNeeds(dt: number) {
    const n = this.needs;
    const day = this.cage.daylight();
    if (this.asleep) {
      n.fatigue -= dt / (day > 0.5 ? 300 : 160);
      n.hunger += dt / 1500;
      n.thirst += dt / 1300;
      n.restless = Math.max(0, n.restless - dt / 200);
    } else {
      const running = this.task.kind === 'wheel' && this.task.stage === RUNNING;
      n.hunger += dt / 420;
      n.thirst += dt / 360;
      n.fatigue += dt / (running ? 330 : 720);
      n.restless += running ? -dt / 18 : dt / 140;
      n.grooming += dt / 240;
    }
    for (const key of Object.keys(n) as (keyof Needs)[]) n[key] = THREE.MathUtils.clamp(n[key], 0, 1);
  }

  // ---------- choosing ----------

  private make(kind: Kind): Task {
    return { kind, stage: 0, t: 0, dur: 0, spot: new THREE.Vector2(), from: new THREE.Vector3(), count: 0, vy: 0 };
  }

  private begin(kind: Kind) {
    if (this.task.kind === 'wheel') this.cage.wheel.drive = 0;
    this.model.clip(null);
    this.task = this.make(kind);
    this.solid = kind !== 'held' && kind !== 'fall';
    if (kind !== 'held' && kind !== 'fall') this.lift = 0;
    this.shown = true;
  }

  private next(stage = this.task.stage + 1, dur = 0) {
    this.task.stage = stage;
    this.task.t = 0;
    this.task.dur = dur;
  }

  private choose() {
    const n = this.needs;
    const day = this.cage.daylight();
    // Needs get a little noise; idle pastimes get a lot, so they take turns.
    const r = () => 0.85 + Math.random() * 0.3;
    const idle = () => 0.6 + Math.random() * 0.8;
    const drowsy = n.fatigue + 0.3 * day;
    const options: [Kind, number][] = [
      ['sleep', drowsy > 0.65 ? (drowsy + 0.4) * r() : 0],
      ['eat', n.hunger * 1.1 * r()],
      ['drink', n.thirst * 1.1 * r()],
      ['wheel', n.restless * (1.6 - 0.7 * day) * r()],
      ['groom', n.grooming * 0.9 * r()],
      ['hoard', this.cheeks > 0.5 ? 0.75 * r() : 0],
      ['dig', (0.16 + 0.15 * n.restless) * idle()],
      ['wander', (0.24 + 0.15 * n.restless) * idle()],
      ['sniff', 0.22 * idle()],
    ];
    if (this.cage.treats.some((t) => t.landed)) options.push(['treat', 0.95 * r()]);
    options.sort((a, b) => b[1] - a[1]);
    this.begin(options[0][0]);
  }

  // ---------- moving ----------

  private turnTo(yaw: number, dt: number, rate = 5) {
    const d = angleTo(this.yaw, yaw);
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    return Math.abs(d) < 0.08;
  }

  private face(x: number, z: number, dt: number) {
    return this.turnTo(Math.atan2(x - this.pos.x, z - this.pos.y), dt);
  }

  /**
   * Step toward a floor point. With `route`, follow a path around the
   * furniture (refreshed when the target or the furniture moves); without
   * it, head straight there. True on arrival.
   */
  private walkTo(target: THREE.Vector2, dt: number, speed = WALK, route = true): boolean {
    let aim = target;
    let goal = target;
    if (route) {
      const p = this.path;
      if (!p || p.to.distanceTo(target) > 0.02 || p.version !== this.cage.navVersion() || p.age > 2) {
        const points = this.cage.route(this.pos, target);
        this.path = { to: target.clone(), version: this.cage.navVersion(), points: points ?? [target.clone()], age: 0 };
      }
      const path = this.path!;
      path.age += dt;
      while (path.points.length > 1 && this.pos.distanceTo(path.points[0]) < 0.02) path.points.shift();
      aim = path.points[0];
      goal = path.points[path.points.length - 1];
    }
    if (this.pos.distanceTo(goal) < 0.012) {
      this.path = null;
      return true;
    }
    const to = new THREE.Vector2().subVectors(aim, this.pos);
    const dist = to.length();
    const want = Math.atan2(to.x, to.y);
    this.turnTo(want, dt, 6);
    const ahead = Math.max(0, Math.cos(angleTo(this.yaw, want)));
    const step = Math.min(speed * dt * ahead, dist);
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.y += Math.cos(this.yaw) * step;
    this.walking = ahead > 0.2 ? 1 : 0.4;
    this.walkPhase += (step / STRIDE) * Math.PI;
    if (this.walking < 1) this.walkPhase += dt * 6; // shuffle while turning
    return false;
  }

  /** Push out of furniture and keep inside the tray. */
  private resolve() {
    const q = new THREE.Vector2();
    for (const o of this.cage.obstacles()) {
      closestOn(o, this.pos, q);
      const away = new THREE.Vector2().subVectors(this.pos, q);
      const min = o.r + HAMSTER_R;
      const d = away.length();
      if (d < min) {
        if (d < 1e-6) away.set(1, 0);
        else away.divideScalar(d);
        this.pos.copy(q).addScaledVector(away, min);
      }
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ROAM, ROAM);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, -ROAM, ROAM);
  }

  /** Standing point beside a round thing: the open side nearest the hamster. */
  private beside(f: Furniture, gap = 0.006) {
    let best: THREE.Vector2 | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = new THREE.Vector2(f.x + Math.cos(a) * (f.r + HAMSTER_R + gap), f.z + Math.sin(a) * (f.r + HAMSTER_R + gap));
      if (Math.abs(p.x) > ROAM || Math.abs(p.y) > ROAM || !this.cage.isFree(p, HAMSTER_R - 0.005)) continue;
      const d = p.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ?? new THREE.Vector2(f.x, f.z);
  }

  private randomSpot(near?: THREE.Vector2) {
    for (let i = 0; i < 30; i++) {
      const p = near
        ? new THREE.Vector2(near.x + rand(-0.3, 0.3), near.y + rand(-0.3, 0.3))
        : new THREE.Vector2(rand(-ROAM, ROAM), rand(-ROAM, ROAM));
      if (Math.abs(p.x) > ROAM - 0.02 || Math.abs(p.y) > ROAM - 0.02) continue;
      if (this.cage.isFree(p, HAMSTER_R + 0.02) && this.cage.route(this.pos, p)) return p;
    }
    return this.pos.clone();
  }

  /** Walk stage helper: true once there, and gives up when stuck. */
  private approach(target: THREE.Vector2, dt: number) {
    if (this.task.t > GIVE_UP) {
      this.choose();
      return false;
    }
    return this.walkTo(target, dt);
  }

  private headWorld() {
    return this.model.head.getWorldPosition(tmp3).clone();
  }

  // ---------- activities ----------

  private run(dt: number) {
    const task = this.task;
    const p = this.target;
    const done = () => this.choose();

    switch (task.kind) {
      case 'wander': {
        if (task.stage === 0) {
          task.spot = this.randomSpot(Math.random() < 0.6 ? this.pos : undefined);
          task.count = 1 + Math.floor(rand(0, 3));
          this.next(1);
        } else if (task.stage === 1) {
          p.sniff = 0.4;
          if (this.approach(task.spot, dt)) this.next(2, rand(0.6, 1.8));
        } else {
          p.sniff = 0.8;
          p.headYaw = Math.sin(this.time * 2.2) * 0.5;
          if (task.t > task.dur) {
            this.needs.restless = Math.max(0, this.needs.restless - 0.02);
            if (--task.count > 0) {
              task.spot = this.randomSpot(this.pos);
              this.next(1);
            } else done();
          }
        }
        break;
      }

      case 'sniff': {
        if (task.stage === 0) this.next(1, rand(2, 4));
        p.sniff = 1;
        p.headYaw = Math.sin(this.time * 1.6) * 0.6;
        p.headPitch = -0.15;
        if (task.t > task.dur * 0.4 && task.t < task.dur * 0.8) {
          p.sit = 0.75;
          p.paws = 0.5;
          p.alert = 0.4;
        }
        if (task.t > task.dur) done();
        break;
      }

      case 'eat': {
        const bowl = this.cage.bowl;
        if (task.stage === 0) {
          if (this.approach(this.beside(bowl), dt)) this.next(1);
        } else if (task.stage === 1) {
          if (this.face(bowl.x, bowl.z, dt)) this.next(2, rand(2.5, 3.5));
        } else if (task.stage === 2) {
          // Rummage in the bowl.
          p.lean = 0.9;
          p.headPitch = 0.45;
          p.nibble = 1;
          if (task.t > task.dur) this.next(3, rand(3, 4.5));
        } else if (task.stage === 3) {
          // Sit up and eat a seed from the paws.
          p.sit = 1;
          p.paws = 1;
          p.hold = 1;
          p.nibble = 1;
          p.headPitch = 0.15;
          if (task.t > task.dur) {
            this.needs.hunger = Math.max(0, this.needs.hunger - 0.55);
            if (Math.random() < 0.6) this.next(4, rand(2, 3));
            else done();
          }
        } else {
          // Stuff the cheeks for later.
          p.lean = 0.9;
          p.headPitch = 0.45;
          p.nibble = 1.2;
          this.cheeks = Math.min(1, this.cheeks + dt * 0.22);
          if (task.t > task.dur) done();
        }
        break;
      }

      case 'drink': {
        const b = this.cage.bottle;
        if (task.stage === 0) {
          if (this.approach(b.stand, dt)) this.next(1);
        } else if (task.stage === 1) {
          if (this.turnTo(b.standYaw, dt)) this.next(2, rand(3, 5));
        } else {
          p.sit = 0.55;
          p.paws = 0.3;
          p.headPitch = -0.55;
          p.nibble = 0.4;
          if (Math.floor(task.t * 2.2) !== Math.floor((task.t - dt) * 2.2)) this.cage.fx.bubble(b.bubbleFrom, b.waterTop);
          if (task.t > task.dur) {
            this.needs.thirst = 0;
            done();
          }
        }
        break;
      }

      case 'wheel': {
        // Stages: walk to the open side, face in, hop in, run, coast, hop out.
        const w = this.cage.wheel;
        const entry = w.toWorld(w.entryLocal.x, w.entryLocal.y);
        const run = w.runLocal;
        const runAt = w.toWorld(run.x, run.z);
        const runYaw = w.yaw; // local +z runs along the slats
        const hop = (from: THREE.Vector3, toXZ: THREE.Vector2, toLift: number) => {
          const k = Math.min(1, task.t / task.dur);
          this.pos.set(THREE.MathUtils.lerp(from.x, toXZ.x, k), THREE.MathUtils.lerp(from.z, toXZ.y, k));
          this.lift = THREE.MathUtils.lerp(from.y, toLift, k) + Math.sin(k * Math.PI) * 0.05;
          this.walking = 0.5;
          this.walkPhase += dt * 10;
          return k >= 1;
        };
        if (task.stage === 0) {
          if (this.approach(entry, dt)) this.next(1);
        } else if (task.stage === 1) {
          if (this.face(runAt.x, runAt.y, dt)) {
            task.from.set(this.pos.x, 0, this.pos.y);
            this.solid = false;
            this.next(2, 0.7);
          }
        } else if (task.stage === 2) {
          this.turnTo(runYaw, dt, 8);
          if (hop(task.from, runAt, run.y)) this.next(RUNNING, rand(8, 25));
        } else if (task.stage === RUNNING) {
          this.pos.copy(runAt);
          this.lift = run.y;
          this.yaw = runYaw;
          w.drive = 4;
          this.walking = 1;
          this.walkPhase += ((dt * 4 * Wheel.R * S) / STRIDE) * Math.PI;
          p.headPitch = -0.1;
          p.lean = 0.25;
          if (task.t > task.dur || this.needs.fatigue > 0.95) {
            w.drive = 0;
            this.next(4, 1.2);
          }
        } else if (task.stage === 4) {
          // Ride the coasting wheel for a moment.
          this.pos.copy(runAt);
          this.lift = run.y;
          p.sit = 0.3;
          p.sniff = 1;
          if (task.t > task.dur) {
            task.from.set(this.pos.x, this.lift, this.pos.y);
            this.next(5, 0.6);
          }
        } else {
          this.face(entry.x + (entry.x - runAt.x), entry.y + (entry.y - runAt.y), dt);
          if (hop(task.from, entry, 0)) {
            this.lift = 0;
            this.solid = true;
            done();
          }
        }
        break;
      }

      case 'groom': {
        if (task.stage === 0) this.next(1, rand(3, 5));
        p.sit = 1;
        p.groom = 1;
        p.headPitch = 0.2;
        p.eyes = 0.4;
        if (task.t > task.dur) {
          this.needs.grooming = 0;
          done();
        }
        break;
      }

      case 'dig': {
        if (task.stage === 0) {
          task.spot = this.randomSpot();
          this.next(1);
        } else if (task.stage === 1) {
          if (this.approach(task.spot, dt)) this.next(2, rand(2, 3.5));
        } else {
          p.dig = 1;
          p.lean = 0.7;
          p.headPitch = 0.4;
          if (Math.floor(task.t * 7) !== Math.floor((task.t - dt) * 7)) {
            const fwd = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
            this.cage.fx.chips(new THREE.Vector3(this.pos.x + fwd.x * 0.09 * HS, GROUND + 0.01, this.pos.y + fwd.y * 0.09 * HS), fwd.clone().negate());
          }
          if (task.t > task.dur) {
            this.needs.restless = Math.max(0, this.needs.restless - 0.25);
            done();
          }
        }
        break;
      }

      case 'sleep':
      case 'hoard': {
        const h = this.cage.house;
        const door = h.toWorld(h.doorLocal.x, h.doorLocal.y);
        const inside = h.toWorld(0, -0.06);
        const front = h.frontPlane();
        // How far in front of the wall the hamster's centre is; its nose
        // reaches NOSE ahead of that and its tail TAIL behind.
        const out = front.distanceToPoint(tmp3.set(this.pos.x, 0, this.pos.y));
        if (task.stage === 0) {
          if (this.approach(door, dt)) {
            this.solid = false;
            this.model.clip(front);
            this.next(1);
          }
        } else if (task.stage === 1) {
          // Duck in through the doorway, disappearing behind the wall.
          this.walkTo(inside, dt, WALK * 0.8, false);
          p.headPitch = 0.3;
          this.model.clip(front);
          if (out < -TAIL || this.pos.distanceTo(inside) < 0.012) {
            this.shown = false;
            this.next(2, task.kind === 'hoard' ? rand(2, 3.5) : 0);
          }
        } else if (task.stage === 2) {
          this.pos.copy(inside);
          this.yaw = h.yaw;
          if (task.kind === 'hoard') {
            this.cheeks = 0;
            if (task.t > task.dur) this.next(3);
          } else {
            if (Math.floor(task.t / 2.4) !== Math.floor((task.t - dt) / 2.4)) {
              const roof = h.toWorld(0.05, 0);
              this.cage.fx.zzz(new THREE.Vector3(roof.x, GROUND + (House.H + 0.12) * S, roof.y));
            }
            const day = this.cage.daylight();
            const wake = this.needs.fatigue < 0.05 && Math.random() < dt * (0.04 + 0.2 * (1 - day));
            if (wake) this.next(3);
          }
        } else if (task.stage === 3) {
          // Come back out, appearing from behind the wall.
          this.shown = true;
          this.model.clip(front);
          if (this.walkTo(door, dt, WALK * 0.8, false) || out > NOSE) {
            this.model.clip(null);
            this.solid = true;
            if (task.kind === 'sleep') this.next(4, 1.6);
            else done();
          }
        } else {
          // A good stretch and yawn after waking.
          p.sit = 0.8;
          p.headPitch = -0.35;
          p.eyes = 0.2;
          p.paws = 0.4;
          if (task.t > task.dur) this.begin('groom');
        }
        break;
      }

      case 'treat': {
        if (task.stage === 0) {
          // A beat of alertness, then go for the nearest landed seed.
          p.sit = 0.6;
          p.alert = 1;
          p.sniff = 1;
          if (task.t > 0.5) {
            let best: Treat | undefined;
            let bestD = Infinity;
            for (const t of this.cage.treats) {
              if (!t.landed) continue;
              const d = this.pos.distanceTo(new THREE.Vector2(t.mesh.position.x, t.mesh.position.z));
              if (d < bestD) {
                bestD = d;
                best = t;
              }
            }
            if (!best) {
              if (task.t > 2) done();
              break;
            }
            task.treat = best;
            this.next(1);
          }
        } else if (task.stage === 1) {
          const t = task.treat!;
          if (!this.cage.treats.includes(t)) {
            this.begin('treat');
            break;
          }
          const at = new THREE.Vector2(t.mesh.position.x, t.mesh.position.z);
          const dir = new THREE.Vector2().subVectors(this.pos, at);
          const reach = at.clone().addScaledVector(dir.lengthSq() > 1e-6 ? dir.normalize() : dir.set(0, 1), 0.1 * HS);
          if (this.approach(reach, dt)) {
            if (this.face(at.x, at.y, dt)) {
              this.cage.eatTreat(t);
              this.next(2, rand(2.5, 3.5));
            }
          }
        } else {
          // Treats go into the cheeks when full, otherwise straight down.
          const stuff = this.needs.hunger < 0.25;
          p.sit = stuff ? 0.2 : 1;
          p.paws = stuff ? 0.2 : 1;
          p.hold = stuff ? 0 : 1;
          p.nibble = 1;
          if (stuff) this.cheeks = Math.min(1, this.cheeks + dt * 0.12);
          if (task.t > task.dur) {
            this.needs.hunger = Math.max(0, this.needs.hunger - 0.15);
            done();
          }
        }
        break;
      }

      case 'startle': {
        const v = this.cage.viewer();
        this.face(v.x, v.y, dt * 2.5);
        p.sit = 1;
        p.alert = 1;
        p.eyes = 1.2;
        p.paws = 0.6;
        p.headYaw = 0;
        if (task.t > 1.8) this.begin('sniff');
        break;
      }

      case 'pet': {
        const v = this.cage.viewer();
        this.face(v.x, v.y, dt);
        p.sit = 0.35;
        p.eyes = 0.25;
        p.headPitch = -0.2;
        p.headYaw = Math.sin(this.time * 1.4) * 0.15;
        if (Math.floor(task.t / 0.8) !== Math.floor((task.t - dt) / 0.8)) {
          this.cage.fx.heart(this.headWorld().add(new THREE.Vector3(0, 0.07 * HS, 0)));
        }
        this.petIdle = this.petting ? 0 : this.petIdle + dt;
        if (this.petIdle > 0.6) done();
        break;
      }

      case 'held': {
        this.solid = false;
        this.lift += (HOLD - this.lift) * (1 - Math.exp(-dt * 10));
        this.pos.lerp(this.holdAt, 1 - Math.exp(-dt * 14));
        this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ROAM, ROAM);
        this.pos.y = THREE.MathUtils.clamp(this.pos.y, -ROAM, ROAM);
        p.dangle = 1;
        p.alert = 0.6;
        p.headPitch = 0.15;
        p.sniff = 1;
        break;
      }

      case 'fall': {
        task.vy -= 1.6 * dt;
        this.lift = Math.max(0, this.lift + task.vy * dt);
        p.dangle = this.lift > 0 ? 1 : 0;
        if (this.lift === 0) {
          this.solid = true;
          this.begin('sniff');
        }
        break;
      }

      case 'boop': {
        // A little hop of surprise and a heart.
        const k = Math.min(1, task.t / 0.45);
        this.lift = Math.sin(k * Math.PI) * 0.03;
        p.eyes = 0.2;
        p.alert = 0.5;
        if (task.stage === 0) {
          this.cage.fx.heart(this.headWorld().add(new THREE.Vector3(0, 0.07 * HS, 0)));
          this.next(1);
        }
        if (task.t > 0.8) {
          this.lift = 0;
          done();
        }
        break;
      }
    }

    // Petting interrupts quiet moments.
    if (this.petting && this.shown && (task.kind === 'wander' || task.kind === 'sniff' || task.kind === 'groom' || task.kind === 'dig')) {
      this.petIdle = 0;
      this.begin('pet');
    }
  }
}
