import * as THREE from 'three';
import { mesh, rand, type Look } from '../kit';
import { P } from './look';
import type { LilyPad } from './plants';
import { pondInward, pondSdf, WATER } from './terrain';

// The frog: it sits for a long time, which is most of what frogs do. Its
// throat pulses as it breathes; now and then it croaks, more often after
// dark; it looks around, snaps at a dragonfly that comes too close (and
// misses), and every so often moves house: a hop if the next perch is near,
// otherwise a plop into the water, a lazy swim, and a hop back out.

/** Somewhere to sit: a fixed spot, or a lily pad that drifts. */
export interface Perch {
  id: string;
  pad?: LilyPad;
  spot?: THREE.Vector3;
}

export interface FrogWorld {
  perches: Perch[];
  /** Stones standing in the water (x, z, radius), to swim around. */
  obstacles: THREE.Vector3[];
  ripple(x: number, z: number, strength: number): void;
  splash(at: THREE.Vector3, count: number): void;
  note(at: THREE.Vector3): void;
  daylight(): number;
  /** Where the viewer is, in x/z. */
  viewer(): THREE.Vector2;
}

export function perchPos(p: Perch, out = new THREE.Vector3()) {
  if (p.pad) return out.set(p.pad.x, p.pad.group.position.y + 0.003, p.pad.z);
  return out.copy(p.spot!);
}

type Task =
  | { kind: 'sit' }
  | { kind: 'hop'; from: THREE.Vector3; to: Perch | THREE.Vector3; t: number; dur: number; height: number }
  | { kind: 'swim'; to: THREE.Vector3; then: Perch | null; under: number };

const SWIM_Y = WATER - 0.008;

export class Frog {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly throat: THREE.Mesh;
  private readonly hind: THREE.Group[] = [];
  private readonly front: THREE.Mesh[] = [];
  private readonly lids: THREE.Mesh[] = [];
  private readonly tongue: THREE.Mesh;

  perch: Perch | null;
  /** True while the pointer rests on it: it turns to look at you. */
  watched = false;
  private task: Task = { kind: 'sit' };
  private yaw = rand(0, Math.PI * 2);
  private lookYaw = 0;
  private lookIn = 3;
  private croakIn = rand(6, 15);
  private croaking = 0;
  private moveIn = rand(25, 60);
  private blinkIn = 2;
  private blinking = 0;
  private snapping = 0;
  private snapAt = new THREE.Vector3();
  private snapRest = 0;
  private kick = 0;
  private t = 0;

  constructor(look: Look, start: Perch) {
    this.perch = start;
    const skin = look.mat(P.frog, { roughness: 0.55 });
    const dark = look.mat(P.frogDark, { roughness: 0.6 });
    const belly = look.mat(P.frogBelly);
    const blob = look.blob;
    this.root.add(this.body);
    this.body.add(this.head);

    // Body sits with its front raised.
    this.body.position.set(0, 0.014, 0);
    this.body.add(
      mesh(blob, skin, [0, 0.004, -0.004], [0.022, 0.014, 0.026], [-0.3, 0, 0]),
      mesh(blob, belly, [0, -0.002, 0.004], [0.018, 0.011, 0.021], [-0.3, 0, 0]),
      mesh(blob, dark, [0.008, 0.015, -0.01], [0.006, 0.003, 0.006]),
      mesh(blob, dark, [-0.009, 0.014, -0.004], [0.005, 0.003, 0.005]),
      mesh(blob, dark, [0.001, 0.012, -0.022], [0.006, 0.003, 0.005]),
    );
    this.head.position.set(0, 0.012, 0.016);
    this.head.add(mesh(blob, skin, [0, 0, 0.004], [0.02, 0.011, 0.018]));
    this.head.add(mesh(new THREE.TorusGeometry(0.014, 0.0009, 3, 10, Math.PI * 0.7), dark, [0, -0.004, 0.006], 1, [Math.PI / 2, 0, Math.PI * 0.15]));
    this.throat = mesh(blob, look.mat(P.frogThroat), [0, -0.007, 0.012], 0.006);
    this.head.add(this.throat);
    for (const side of [1, -1]) {
      this.head.add(
        mesh(blob, skin, [side * 0.011, 0.008, 0.006], 0.0085),
        mesh(blob, look.mat(P.frogEye, { roughness: 0.3 }), [side * 0.0135, 0.0105, 0.0085], 0.0062),
        mesh(blob, look.mat(P.pupil, { roughness: 0.2 }), [side * 0.0158, 0.0112, 0.0128], [0.0028, 0.0036, 0.0026], [0, side * 0.6, 0]),
        mesh(blob, look.mat('#FFFFFF', { roughness: 0.2 }), [side * 0.0162, 0.0132, 0.0142], 0.0011),
      );
      const lid = mesh(blob, skin, [side * 0.0135, 0.0105, 0.0085], 0.0066);
      lid.scale.y = 0.001;
      this.lids.push(lid);
      this.head.add(lid);

      // Front legs: little posts with splayed feet.
      const arm = mesh(blob, skin, [side * 0.012, -0.004, 0.018], [0.0035, 0.009, 0.0035], [0.2, 0, side * 0.2]);
      this.front.push(arm);
      this.body.add(arm, mesh(blob, belly, [side * 0.014, -0.013, 0.021], [0.004, 0.0015, 0.004]));

      // Hind legs fold up beside the body; they straighten to jump and kick.
      const hip = new THREE.Group();
      hip.position.set(side * 0.014, -0.002, -0.014);
      hip.add(
        mesh(blob, skin, [side * 0.006, -0.002, 0.006], [0.008, 0.0065, 0.013], [0, side * 0.3, 0]),
        mesh(blob, dark, [side * 0.009, -0.007, -0.002], [0.005, 0.004, 0.011], [0, -side * 0.4, 0]),
        mesh(blob, belly, [side * 0.008, -0.011, 0.011], [0.006, 0.0018, 0.009]),
      );
      this.hind.push(hip);
      this.body.add(hip);
    }
    this.tongue = mesh(blob, look.mat(P.tongue), [0, 0, 0], [0.002, 0.002, 0.5]);
    this.tongue.visible = false;
    this.root.add(this.tongue);
    perchPos(start, this.root.position);
  }

  get busy() {
    return this.task.kind !== 'sit' || this.snapping > 0;
  }

  get sitting() {
    return this.task.kind === 'sit' && !!this.perch;
  }

  get inWater() {
    return this.task.kind === 'swim';
  }

  /** Where its mouth is, for a dragonfly that wanders too close. */
  mouth(out = new THREE.Vector3()) {
    return out.set(0, 0.026, 0.03).applyMatrix4(this.root.matrixWorld);
  }

  croak() {
    if (this.croaking <= 0 && this.task.kind === 'sit') this.croaking = 1.6;
  }

  /** Flick the tongue at something (it never quite catches anything). */
  snap(at: THREE.Vector3) {
    if (this.snapping > 0 || this.snapRest > 0 || !this.sitting) return false;
    this.snapping = 0.3;
    this.snapRest = rand(45, 120);
    this.snapAt.copy(at);
    return true;
  }

  /** A tap on the glass: off the perch and into the water. */
  startle(w: FrogWorld) {
    if (this.task.kind !== 'sit' || !this.perch) return;
    const from = this.root.position.clone();
    const into = this.waterNear(from, pondInward(from.x, from.z), 0.07);
    this.hopTo(into, w);
  }

  /** A click on the frog: a croak if resting, or off to somewhere new. */
  poke() {
    if (this.task.kind !== 'sit') return;
    if (this.croaking <= 0 && Math.random() < 0.6) this.croak();
    else this.moveIn = 0;
  }

  private waterNear(from: THREE.Vector3, dir: THREE.Vector2, dist: number) {
    const p = new THREE.Vector2(from.x, from.z).addScaledVector(dir, dist);
    for (let i = 0; i < 10 && pondSdf(p.x, p.y) > -0.035; i++) p.addScaledVector(pondInward(p.x, p.y), 0.015);
    return new THREE.Vector3(p.x, SWIM_Y, p.y);
  }

  private hopTo(to: Perch | THREE.Vector3, w: FrogWorld) {
    const from = this.root.position.clone();
    const end = to instanceof THREE.Vector3 ? to : perchPos(to);
    const d = Math.hypot(end.x - from.x, end.z - from.z);
    this.yaw = Math.atan2(end.x - from.x, end.z - from.z);
    this.perch = null;
    this.task = { kind: 'hop', from, to, t: 0, dur: 0.35 + d * 1.2, height: 0.025 + d * 0.25 };
    w.ripple(from.x, from.z, 0.25);
  }

  /** Off to another perch: one hop if it is close, otherwise by water. */
  private wander(w: FrogWorld) {
    const here = this.root.position;
    const options = w.perches.filter((p) => p !== this.perch);
    const next = options[Math.floor(Math.random() * options.length)];
    if (!next) return;
    const there = perchPos(next);
    const d = Math.hypot(there.x - here.x, there.z - here.z);
    if (d < 0.17) {
      this.hopTo(next, w);
      return;
    }
    const dir = new THREE.Vector2(there.x - here.x, there.z - here.z).normalize();
    this.hopTo(this.waterNear(here, dir, 0.07), w);
    this.after = next;
  }

  /** Where to go once a hop into the water lands. */
  private after: Perch | null = null;

  step(dt: number, w: FrogWorld) {
    this.t += dt;
    const night = 1 - w.daylight();
    this.snapRest = Math.max(0, this.snapRest - dt);
    const task = this.task;
    let legs = 0; // 0 folded, 1 straight back
    let pitch = 0;

    if (task.kind === 'sit') {
      if (this.perch) perchPos(this.perch, this.root.position);
      if (this.perch?.pad) this.perch.pad.dip = Math.min(this.perch.pad.dip, -0.0012);
      // Look about; turn toward whoever is watching.
      if ((this.lookIn -= dt) <= 0) {
        this.lookIn = rand(3, 9);
        this.lookYaw = Math.random() < 0.6 ? rand(-0.6, 0.6) : 0;
        if (Math.random() < 0.25) this.yaw += rand(-0.8, 0.8);
      }
      if (this.watched) {
        const v = w.viewer();
        const toward = Math.atan2(v.x - this.root.position.x, v.y - this.root.position.z);
        let d = toward - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += THREE.MathUtils.clamp(d, -dt * 2, dt * 2);
        this.lookYaw *= 1 - Math.min(1, dt * 4);
      }
      if ((this.croakIn -= dt) <= 0) {
        this.croakIn = night > 0.5 ? rand(8, 20) : rand(20, 50);
        this.croak();
      }
      if (!this.watched && this.croaking <= 0 && (this.moveIn -= dt) <= 0) {
        this.moveIn = rand(30, 80);
        this.wander(w);
      }
    } else if (task.kind === 'hop') {
      task.t += dt;
      const k = Math.min(1, task.t / task.dur);
      const end = task.to instanceof THREE.Vector3 ? task.to : perchPos(task.to);
      this.root.position.lerpVectors(task.from, end, k);
      this.root.position.y += Math.sin(k * Math.PI) * task.height;
      legs = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, k - 0.8) * 5);
      pitch = (k - 0.5) * 0.9;
      if (k >= 1) {
        if (task.to instanceof THREE.Vector3) {
          // Into the water: a plop, then paddle on.
          w.ripple(end.x, end.z, 1.1);
          w.splash(end, 6);
          const then = this.after;
          this.after = null;
          const goal = then ? perchPos(then) : end;
          const dir = new THREE.Vector2(goal.x - end.x, goal.z - end.z);
          const stop = then ? this.waterNear(goal, dir.lengthSq() ? dir.normalize().negate() : dir, 0.05) : end.clone();
          this.task = { kind: 'swim', to: stop, then, under: then ? 0 : rand(2, 4) };
        } else {
          this.perch = task.to;
          if (task.to.pad) task.to.pad.press(0.05);
          w.ripple(end.x, end.z, 0.5);
          this.task = { kind: 'sit' };
          this.croakIn = Math.max(this.croakIn, 2);
        }
      }
    } else {
      // Swimming: slow frog-kicks, gliding between them, only the eyes above water.
      if (task.under > 0) {
        task.under -= dt;
        this.root.position.y += (WATER - 0.022 - this.root.position.y) * Math.min(1, dt * 3);
        if (task.under <= 0) {
          const next = w.perches[Math.floor(Math.random() * w.perches.length)];
          const there = perchPos(next);
          const here = this.root.position;
          const dir = new THREE.Vector2(here.x - there.x, here.z - there.z).normalize();
          task.then = next;
          task.to = this.waterNear(there, dir, 0.05);
        }
      } else {
        const here = this.root.position;
        const to = new THREE.Vector2(task.to.x - here.x, task.to.z - here.z);
        const d = to.length();
        let turn = Math.atan2(to.x, to.y) - this.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.yaw += THREE.MathUtils.clamp(turn, -dt * 2.5, dt * 2.5);
        this.kick += dt;
        const cycle = 1.1;
        const ph = (this.kick % cycle) / cycle;
        legs = ph < 0.25 ? ph / 0.25 : 1 - (ph - 0.25) / 0.75;
        const speed = 0.012 + 0.05 * Math.max(0, Math.sin(ph * Math.PI * 1.2));
        here.x += Math.sin(this.yaw) * speed * dt;
        here.z += Math.cos(this.yaw) * speed * dt;
        for (const o of w.obstacles) {
          const dx = here.x - o.x;
          const dz = here.z - o.y;
          const gap = Math.hypot(dx, dz) - o.z - 0.02;
          if (gap < 0) {
            here.x -= (dx / (o.z + 0.02 + gap)) * gap;
            here.z -= (dz / (o.z + 0.02 + gap)) * gap;
          }
        }
        const s = pondSdf(here.x, here.z);
        if (s > -0.025) {
          const inward = pondInward(here.x, here.z);
          here.x += inward.x * (s + 0.025);
          here.z += inward.y * (s + 0.025);
        }
        here.y += (SWIM_Y - here.y) * Math.min(1, dt * 3);
        if (ph < this.lastPh) w.ripple(here.x, here.z, 0.35);
        this.lastPh = ph;
        if (d < 0.02) {
          if (task.then) this.hopTo(task.then, w);
          else this.task = { kind: 'swim', to: here.clone(), then: null, under: 0.01 };
        }
      }
    }

    // Croak: the throat swells up three times.
    let throat = 0.006 + Math.sin(this.t * 9) * 0.0006;
    if (this.croaking > 0) {
      const before = this.croaking;
      this.croaking -= dt;
      const k = (1.6 - this.croaking) / 1.6;
      throat = 0.006 + 0.008 * Math.max(0, Math.sin(k * Math.PI * 3));
      if (Math.floor(before / 0.533) !== Math.floor(this.croaking / 0.533) && this.croaking > 0.2) {
        w.note(this.mouth().add(new THREE.Vector3(0, 0.02, 0)));
      }
    }
    this.throat.scale.set(throat * 1.2, throat, throat * 1.1);

    // Blink.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinking = 0.16;
      this.blinkIn = rand(2.5, 6);
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const asleep = night > 0.8 && this.sitting && !this.watched && this.croaking <= 0 ? 0.5 : 0;
    const lid = this.blinking > 0 ? 1 : asleep;
    for (const l of this.lids) l.scale.y = 0.0066 * Math.max(0.001, lid);

    // Tongue: out to the target and back in a blink.
    if (this.snapping > 0) {
      this.snapping -= dt;
      const k = Math.sin((1 - this.snapping / 0.3) * Math.PI);
      const from = this.mouth();
      const reach = Math.min(from.distanceTo(this.snapAt), 0.09) * k;
      const dir = this.snapAt.clone().sub(from).normalize();
      this.root.updateMatrixWorld();
      const local = this.root.worldToLocal(from.clone().addScaledVector(dir, reach / 2));
      this.tongue.position.copy(local);
      this.tongue.lookAt(this.snapAt);
      this.tongue.scale.set(0.0022, 0.0022, Math.max(0.001, reach / 2));
      this.tongue.visible = this.snapping > 0;
      // Face the snack.
      const want = Math.atan2(this.snapAt.x - this.root.position.x, this.snapAt.z - this.root.position.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += THREE.MathUtils.clamp(d, -dt * 8, dt * 8);
    } else this.tongue.visible = false;

    // Pose.
    this.root.rotation.y = this.yaw;
    const swim = this.task.kind === 'swim' ? 1 : 0;
    this.body.rotation.x = pitch * (1 - swim) + swim * 0.3;
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, this.lookYaw, Math.min(1, dt * 3));
    this.head.rotation.x = swim * -0.25;
    this.hind.forEach((hip, i) => {
      const side = i === 0 ? 1 : -1;
      hip.rotation.x = legs * 2.4;
      hip.rotation.y = side * legs * -0.3;
      hip.scale.z = 1 + legs * 0.6;
    });
    for (const f of this.front) f.rotation.x = 0.2 + legs * 1.2;
  }

  private lastPh = 0;
}
