import * as THREE from 'three';
import { mesh, paintFaces, rand, type Look } from '../kit';
import { P } from './look';
import { pondSdf, WATER } from './terrain';

// A dragonfly: it hangs in the air, darts somewhere else in an instant,
// hangs again; it rests on cattail tips, dips to touch the water, and
// sleeps on a stalk through the night.

export interface Sky {
  perches(): THREE.Object3D[];
  ripple(x: number, z: number, strength: number): void;
  daylight(): number;
}

type Mode = 'hover' | 'dart' | 'perch' | 'dip';

const ease = (k: number) => k * k * (3 - 2 * k);

export class Dragonfly {
  readonly root = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];
  private mode: Mode = 'hover';
  private timer = 2;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private home = new THREE.Vector3();
  private dur = 0.5;
  private t = 0;
  private yaw = 0;
  private perch: THREE.Object3D | null = null;
  private dipped = false;

  constructor(look: Look, start: THREE.Vector3) {
    const body = look.mat(P.dragonfly, { roughness: 0.35 });
    const dark = look.mat(P.dragonflyDark, { roughness: 0.35 });
    const tail = new THREE.CylinderGeometry(0.0016, 0.0024, 0.034, 5, 6).toNonIndexed();
    paintFaces(tail, (c) => (Math.sin(c.y * 420) > 0.55 ? P.dragonflyDark : P.dragonfly));
    tail.computeVertexNormals();
    this.root.add(
      mesh(look.blob, body, [0, 0, 0.002], [0.0035, 0.0035, 0.006]),
      mesh(tail, look.mat('#FFFFFF', { vertexColors: true, roughness: 0.35 }), [0, 0, -0.019], 1, [Math.PI / 2, 0, 0]),
      mesh(look.blob, dark, [0.002, 0.001, 0.009], 0.0028),
      mesh(look.blob, dark, [-0.002, 0.001, 0.009], 0.0028),
    );
    const wing = new THREE.CircleGeometry(1, 8);
    wing.rotateX(-Math.PI / 2);
    const membrane = new THREE.MeshStandardMaterial({
      color: P.wing, roughness: 0.2, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
    });
    for (const [z, len] of [[0.003, 0.012], [-0.003, 0.011]] as const) {
      for (const side of [1, -1]) {
        const w = new THREE.Group();
        w.position.set(side * 0.002, 0.002, z);
        const m = new THREE.Mesh(wing, membrane);
        m.position.x = side * len;
        m.scale.set(len, 1, 0.003);
        w.add(m);
        this.root.add(w);
        this.wings.push(m);
      }
    }
    this.root.position.copy(start);
    this.home.copy(start);
  }

  /** Off somewhere else, quick. */
  scare() {
    if (this.mode === 'dart') return;
    this.perch = null;
    this.flyTo(this.somewhere(0.25, 0.4), 0.45);
  }

  get flying() {
    return this.mode !== 'perch';
  }

  get position() {
    return this.root.position;
  }

  private somewhere(near: number, far: number) {
    const p = new THREE.Vector3();
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(near, far);
      p.set(this.root.position.x + Math.cos(a) * d, WATER + rand(0.04, 0.16), this.root.position.z + Math.sin(a) * d);
      if (Math.abs(p.x) < 0.38 && Math.abs(p.z) < 0.38 && pondSdf(p.x, p.z) < 0.08) return p;
    }
    return p.set(rand(-0.15, 0.25), WATER + rand(0.05, 0.14), rand(-0.05, 0.3));
  }

  private flyTo(p: THREE.Vector3, dur?: number) {
    this.mode = 'dart';
    this.from.copy(this.root.position);
    this.to.copy(p);
    this.t = 0;
    this.dur = dur ?? 0.35 + this.from.distanceTo(p) * 1.4;
  }

  step(dt: number, sky: Sky) {
    const night = sky.daylight() < 0.3;
    const pos = this.root.position;
    this.t += dt;

    switch (this.mode) {
      case 'hover': {
        // Hang in place, wobbling a little, turning now and then.
        pos.set(
          this.home.x + Math.sin(this.t * 1.7) * 0.004,
          this.home.y + Math.sin(this.t * 2.3) * 0.003,
          this.home.z + Math.cos(this.t * 1.3) * 0.004,
        );
        if ((this.timer -= dt) <= 0) this.choose(sky, night);
        break;
      }
      case 'dart': {
        const k = Math.min(1, this.t / this.dur);
        pos.lerpVectors(this.from, this.to, ease(k));
        pos.y += Math.sin(k * Math.PI) * 0.01;
        const dx = this.to.x - this.from.x;
        const dz = this.to.z - this.from.z;
        if (dx * dx + dz * dz > 1e-6) this.turnTo(Math.atan2(dx, dz), dt * 10);
        if (k >= 1) {
          if (this.perch) {
            this.mode = 'perch';
            this.timer = rand(6, 20);
          } else if (this.dipped) {
            this.dipped = false;
            sky.ripple(pos.x, pos.z, 0.4);
            this.flyTo(pos.clone().setY(WATER + rand(0.05, 0.1)), 0.5);
          } else {
            this.mode = 'hover';
            this.home.copy(this.to);
            this.timer = rand(2, 6);
            this.t = 0;
          }
        }
        break;
      }
      case 'perch': {
        if (this.perch) this.perch.getWorldPosition(pos);
        if (!night && (this.timer -= dt) <= 0) {
          this.perch = null;
          this.flyTo(this.somewhere(0.1, 0.3));
        }
        break;
      }
    }

    if (this.mode === 'hover') this.turnTo(this.yaw + Math.sin(this.t * 0.6) * 0.3, dt * 0.5);
    this.root.rotation.set(this.mode === 'dart' ? -0.15 : 0, this.yaw, 0);

    // Wings: a shimmer while flying, held flat and still at rest.
    const flap = this.mode === 'perch' ? 0 : 1;
    this.wings.forEach((w, i) => {
      const side = i % 2 ? -1 : 1;
      const parent = w.parent!;
      parent.rotation.z = flap * side * Math.sin(this.t * 55 + (i < 2 ? 0 : 1.6)) * 0.5;
      parent.rotation.y = side * (i < 2 ? -0.15 : 0.2);
    });
  }

  private turnTo(target: number, rate: number) {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += THREE.MathUtils.clamp(d, -rate, rate);
  }

  private choose(sky: Sky, night: boolean) {
    const perches = sky.perches();
    const r = Math.random();
    if ((night || r < 0.2) && perches.length) {
      this.perch = perches[Math.floor(Math.random() * perches.length)];
      this.flyTo(this.perch.getWorldPosition(new THREE.Vector3()));
    } else if (r < 0.32) {
      // Down to touch the water and straight back up.
      const p = this.somewhere(0.03, 0.12);
      if (pondSdf(p.x, p.z) < -0.03) {
        this.dipped = true;
        this.flyTo(p.setY(WATER + 0.004));
      } else this.flyTo(p);
    } else this.flyTo(this.somewhere(0.08, 0.3));
  }

  /** Hover somewhere near a point (the frog's head, say). */
  visit(p: THREE.Vector3) {
    if (this.mode !== 'hover') return;
    this.flyTo(new THREE.Vector3(p.x + rand(-0.05, 0.05), p.y + rand(0.03, 0.05), p.z + rand(-0.05, 0.05)));
  }
}
