import * as THREE from 'three';
import { C, Look, mesh, pick, rand } from './look';

// The cage: a wooden tray of bedding, and the things in it. Furniture stands
// on the bedding at GROUND and can be dragged around; the water bottle hangs
// on the back wall and stays put.

export const GROUND = -0.44;
/** Inner half-size of the tray. */
export const TRAY = 0.45;
/** Furniture is modelled at one size and shown this much larger... */
export const S = 1.08;
/** ...and the hamster this much, so it fits its wheel and its door. */
export const HS = 0.84;
export const HAMSTER_R = 0.065 * HS;
/** How far from the middle the hamster's centre may go. */
export const ROAM = TRAY - HAMSTER_R;

export type FurnitureId = 'wheel' | 'house' | 'bowl' | 'log' | 'cheese';

/** A capsule on the floor, from (-hx,-hz) to (hx,hz) in local x/z, radius r. */
export interface Footprint {
  hx: number;
  hz: number;
  r: number;
}

export interface Capsule {
  a: THREE.Vector2;
  b: THREE.Vector2;
  r: number;
}

export class Furniture {
  readonly group = new THREE.Group();
  /** Points the hamster must be able to reach, in local x/z. */
  access: THREE.Vector2[] = [];

  constructor(
    readonly id: FurnitureId,
    readonly footprint: Footprint,
  ) {}

  get x() {
    return this.group.position.x;
  }
  get z() {
    return this.group.position.z;
  }
  get yaw() {
    return this.group.rotation.y;
  }
  /** Footprint radius in world units. */
  get r() {
    return this.footprint.r * S;
  }

  place(x: number, z: number, yaw = this.yaw) {
    this.group.position.set(x, GROUND, z);
    this.group.rotation.y = yaw;
    this.group.scale.setScalar(S);
  }

  /** Local (x, z), in model units, to world (x, z) as a Vector2. */
  toWorld(lx: number, lz: number, out = new THREE.Vector2()) {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(this.x + (lx * c + lz * s) * S, this.z + (-lx * s + lz * c) * S);
  }

  capsule(): Capsule {
    const f = this.footprint;
    return { a: this.toWorld(-f.hx, -f.hz), b: this.toWorld(f.hx, f.hz), r: f.r * S };
  }

  update(_dt: number, _night: number) {}
}

// ---------- tray and bedding ----------

export function buildTray(root: THREE.Group, look: Look) {
  const t = 0.022;
  const outer = TRAY + t;
  const bottom = -0.49;
  const top = -0.34;
  const floor = mesh(new THREE.BoxGeometry(outer * 2, 0.02, outer * 2), look.mat(C.trayDark), [0, bottom + 0.01, 0]);
  root.add(floor);

  // Each wall is two stacked boards in slightly different shades.
  const boardH = (top - bottom) / 2;
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < 2; k++) {
      const color = k === 0 ? C.trayWood : C.trayWoodLight;
      const along = side < 2;
      const geo = new THREE.BoxGeometry(along ? outer * 2 : t, boardH - 0.003, along ? t : outer * 2 - t * 2);
      const y = bottom + boardH * (k + 0.5);
      const off = outer - t / 2;
      const pos: [number, number, number] =
        side === 0 ? [0, y, off] : side === 1 ? [0, y, -off] : side === 2 ? [off, y, 0] : [-off, y, 0];
      root.add(mesh(geo, look.mat(color), pos));
    }
  }
  // A darker lip along the top edge.
  for (let side = 0; side < 4; side++) {
    const along = side < 2;
    const geo = new THREE.BoxGeometry(along ? outer * 2 + 0.004 : t + 0.004, 0.008, along ? t + 0.004 : outer * 2 + 0.004);
    const off = outer - t / 2;
    const pos: [number, number, number] =
      side === 0 ? [0, top, off] : side === 1 ? [0, top, -off] : side === 2 ? [off, top, 0] : [-off, top, 0];
    root.add(mesh(geo, look.mat(C.trayDark), pos));
  }
}

export function buildBedding(root: THREE.Group, look: Look) {
  const base = mesh(new THREE.BoxGeometry(TRAY * 2, 0.025, TRAY * 2), look.mat(C.bedding), [0, -0.4575, 0]);
  base.castShadow = false;
  root.add(base);

  // Wood shavings: many small flat chips, heaped a little against the walls.
  const count = 1400;
  const chips = new THREE.InstancedMesh(look.chip, look.mat('#FFFFFF'), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = rand(-TRAY + 0.01, TRAY - 0.01);
    const z = rand(-TRAY + 0.01, TRAY - 0.01);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const heap = 0.022 * THREE.MathUtils.smoothstep(edge, 0.28, TRAY) + rand(0, 0.007);
    e.set(rand(-0.5, 0.5), rand(0, Math.PI * 2), rand(-0.5, 0.5));
    m.compose(
      new THREE.Vector3(x, GROUND - 0.006 + heap, z),
      q.setFromEuler(e),
      new THREE.Vector3(rand(0.013, 0.026), rand(0.003, 0.007), rand(0.011, 0.021)),
    );
    chips.setMatrixAt(i, m);
    chips.setColorAt(i, color.set(pick(C.chips)));
  }
  chips.receiveShadow = true;
  root.add(chips);
}

// ---------- wheel ----------

export class Wheel extends Furniture {
  static readonly R = 0.165;
  static readonly W = 0.17;
  static readonly CY = Wheel.R + 0.03;
  readonly spinner = new THREE.Group();
  /** Spin the hamster asks for (rad/s); the wheel coasts down without it. */
  drive = 0;
  private omega = 0;

  constructor(look: Look) {
    super('wheel', { hx: 0, hz: 0.062, r: 0.115 });
    const { R, W, CY } = Wheel;
    this.spinner.position.y = CY;
    this.group.add(this.spinner);

    const back = mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.012, 16), look.mat(C.wheel), [-W / 2, 0, 0], 1, [0, 0, Math.PI / 2]);
    const hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 10), look.mat(C.wheelLight), [-W / 2 + 0.006, 0, 0], 1, [0, 0, Math.PI / 2]);
    const ring = mesh(new THREE.TorusGeometry(R + 0.004, 0.011, 4, 16), look.mat(C.wheelDark), [W / 2, 0, 0], 1, [0, Math.PI / 2, 0]);
    this.spinner.add(back, hub, ring);

    // Running surface: wooden slats around the rim.
    const n = 16;
    const chord = ((2 * Math.PI * R) / n) * 0.86;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const slat = mesh(new THREE.BoxGeometry(W, 0.01, chord), look.mat(i % 2 ? C.wheel : C.wheelLight), [0, R * Math.cos(a), R * Math.sin(a)], 1, [a, 0, 0]);
      this.spinner.add(slat);
    }

    // A-frame stand behind the wheel.
    const sx = -W / 2 - 0.028;
    const legLen = Math.hypot(0.1, CY);
    for (const sz of [1, -1]) {
      const leg = mesh(new THREE.BoxGeometry(0.02, legLen, 0.024), look.mat(C.wheelDark), [sx, CY / 2, (sz * 0.1) / 2], 1, [Math.atan2(-sz * 0.1, CY), 0, 0]);
      this.group.add(leg);
    }
    this.group.add(
      mesh(new THREE.BoxGeometry(0.04, 0.012, 0.26), look.mat(C.wheelDark), [sx, 0.006, 0]),
      mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 6), look.mat(C.metal), [sx + 0.012, CY, 0], 1, [0, 0, Math.PI / 2]),
    );

    // The hamster climbs in from the open side.
    this.access = [this.entryLocal];
  }

  get entryLocal() {
    return new THREE.Vector2(Wheel.W / 2 + 0.11, 0);
  }

  /** Where the hamster's feet go when running: local x/z, and world height above the bedding. */
  get runLocal() {
    return new THREE.Vector3(0, (Wheel.CY - Wheel.R + 0.006) * S, 0);
  }

  update(dt: number) {
    if (this.drive > 0) this.omega += (this.drive - this.omega) * (1 - Math.exp(-dt * 3));
    else this.omega *= Math.exp(-dt * 0.7);
    this.spinner.rotation.x += this.omega * dt;
  }
}

// ---------- house ----------

export class House extends Furniture {
  static readonly W = 0.3;
  static readonly D = 0.24;
  static readonly H = 0.17;
  private readonly glow: THREE.PointLight;
  private knocked = 0;
  private wobble = 0;
  private readonly lit: THREE.MeshStandardMaterial[] = [];

  constructor(look: Look) {
    super('house', { hx: 0.04, hz: 0, r: 0.13 });
    const { W, D, H } = House;
    const t = 0.016;
    const wood = look.mat(C.house);
    const groove = look.mat(C.houseGroove);

    this.group.add(
      mesh(new THREE.BoxGeometry(W, H, t), wood, [0, H / 2, D / 2 - t / 2]),
      mesh(new THREE.BoxGeometry(W, H, t), wood, [0, H / 2, -D / 2 + t / 2]),
      mesh(new THREE.BoxGeometry(t, H, D - 2 * t), wood, [W / 2 - t / 2, H / 2, 0]),
      mesh(new THREE.BoxGeometry(t, H, D - 2 * t), wood, [-W / 2 + t / 2, H / 2, 0]),
    );
    // Plank grooves.
    for (const y of [0.05, 0.1, 0.145]) {
      this.group.add(
        mesh(new THREE.BoxGeometry(W + 0.002, 0.003, D + 0.002), groove, [0, y, 0]),
      );
    }

    // Gables.
    const gh = 0.09;
    const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, gh)]);
    const gable = new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false });
    this.group.add(
      mesh(gable, wood, [W / 2 - t, H, 0], 1, [0, Math.PI / 2, 0]),
      mesh(gable, wood, [-W / 2, H, 0], 1, [0, Math.PI / 2, 0]),
    );

    // Roof: two sloped panels of three planks each, and a ridge.
    const slope = Math.atan2(gh, D / 2);
    const len = Math.hypot(gh, D / 2) + 0.04;
    for (const side of [1, -1]) {
      const panel = new THREE.Group();
      panel.position.set(0, H + gh / 2 + 0.01, side * (D / 4 + 0.012));
      panel.rotation.x = side * slope;
      for (let k = -1; k <= 1; k++) {
        panel.add(mesh(new THREE.BoxGeometry(W + 0.05, 0.018, len / 3 - 0.004), look.mat(k === 0 ? C.roofLight : C.roof), [0, 0, (k * len) / 3]));
      }
      this.group.add(panel);
    }
    this.group.add(mesh(new THREE.BoxGeometry(W + 0.06, 0.02, 0.03), look.mat(C.roof), [0, H + gh + 0.012, 0]));

    // Arched doorway on the front, a round window on one side. Both glow
    // warmly at night.
    const arch = (w: number, h: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(-w / 2, h - w / 2);
      s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
      s.lineTo(w / 2, 0);
      s.closePath();
      return new THREE.ShapeGeometry(s, 8);
    };
    const doorMat = look.mat(C.doorway, { roughness: 1, emissive: '#000000' }).clone();
    const winMat = doorMat.clone();
    this.lit.push(doorMat, winMat);
    this.group.add(
      mesh(arch(0.17, 0.165), look.mat(C.roofLight), [0, 0, D / 2 + 0.001]),
      mesh(arch(0.15, 0.15), doorMat, [0, 0, D / 2 + 0.002]),
      mesh(new THREE.CircleGeometry(0.036, 12), look.mat(C.roofLight), [W / 2 + 0.001, 0.1, 0], 1, [0, Math.PI / 2, 0]),
      mesh(new THREE.CircleGeometry(0.027, 12), winMat, [W / 2 + 0.002, 0.1, 0], 1, [0, Math.PI / 2, 0]),
    );

    // The scene is tiny (the cube is one unit), so a little goes a long way.
    this.glow = new THREE.PointLight(C.glow, 0, 0.45, 2);
    this.glow.position.set(0, 0.06, D / 2 + 0.07);
    this.group.add(this.glow);

    this.access = [this.doorLocal];
  }

  /** Far enough out that the hamster's nose clears the wall while it waits. */
  get doorLocal() {
    return new THREE.Vector2(0, House.D / 2 + (0.18 * HS) / S);
  }

  /** The plane of the front wall, facing out: whatever is behind it is inside. */
  frontPlane(out = new THREE.Plane()) {
    const n = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const p = new THREE.Vector3(this.x, 0, this.z).addScaledVector(n, (House.D / 2) * S);
    return out.setFromNormalAndCoplanarPoint(n, p);
  }

  /** Someone knocked: the house rocks a little on its base. */
  knock() {
    this.knocked = 1;
  }

  update(dt: number, night: number) {
    this.knocked = Math.max(0, this.knocked - dt * 2.5);
    this.wobble += dt;
    this.group.rotation.z = Math.sin(this.wobble * 38) * 0.035 * this.knocked * this.knocked;
    this.glow.intensity = 0.008 * night;
    for (const m of this.lit) m.emissive.set(C.glow).multiplyScalar(0.55 * night);
  }
}

// ---------- bowl, log, cheese ----------

export class Bowl extends Furniture {
  constructor(look: Look) {
    super('bowl', { hx: 0, hz: 0, r: 0.08 });
    const profile = [
      [0.0, 0.0], [0.055, 0.0], [0.07, 0.008], [0.078, 0.034], [0.072, 0.04], [0.062, 0.014], [0.0, 0.014],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    this.group.add(mesh(new THREE.LatheGeometry(profile, 14), look.mat(C.bowl, { roughness: 0.6, side: THREE.DoubleSide })));
    // A mound of mixed food.
    for (let i = 0; i < 34; i++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * 0.05;
      const y = 0.022 + (0.05 - r) * 0.42 + rand(0, 0.004);
      this.group.add(mesh(look.gem, look.mat(pick(C.kibble)), [Math.cos(a) * r, y, Math.sin(a) * r], rand(0.009, 0.013), [rand(0, 3), rand(0, 3), 0]));
    }
  }
}

export class Log extends Furniture {
  constructor(look: Look) {
    super('log', { hx: 0.075, hz: 0, r: 0.045 });
    const along: [number, number, number] = [0, 0, Math.PI / 2];
    this.group.add(
      mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.17, 7), look.mat(C.bark), [0, 0.041, 0], 1, along),
      mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.174, 7), look.mat(C.logInner), [0, 0.041, 0], 1, along),
      mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.176, 6), look.mat(C.logHole), [0, 0.041, 0], 1, along),
      mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.035, 5), look.mat(C.bark), [0.03, 0.085, 0.01], 1, [0.4, 0, -0.3]),
    );
  }
}

export class Cheese extends Furniture {
  constructor(look: Look) {
    super('cheese', { hx: 0, hz: 0, r: 0.045 });
    this.group.add(mesh(new THREE.BoxGeometry(0.062, 0.046, 0.05), look.mat(C.cheese, { roughness: 0.7 }), [0, 0.023, 0], 1, [0, 0.3, 0]));
    for (const [x, y, z, s] of [[0.012, 0.03, 0.022, 0.008], [-0.018, 0.016, 0.021, 0.006], [0.031, 0.02, -0.004, 0.007]]) {
      this.group.add(mesh(look.blob, look.mat(C.cheeseHole), [x, y, z], s));
    }
  }
}

// ---------- bottle ----------

export class Bottle {
  readonly group = new THREE.Group();
  /** Tip of the spout, in world space. */
  readonly tip: THREE.Vector3;
  /** Where the hamster stands to drink (x, z) and which way it faces. */
  readonly stand: THREE.Vector2;
  readonly standYaw = Math.PI;
  /** Bubbles rise from here to `waterTop` while the hamster drinks. */
  readonly bubbleFrom: THREE.Vector3;
  readonly waterTop: number;

  constructor(look: Look, x = 0.33) {
    // Modelled around the bottle's centre, then hung on the back wall at a
    // height that puts the spout at the hamster's mouth.
    const h = 0.16;
    const tilt = Math.PI / 6;
    const len = 0.075;
    const spoutY = -h / 2 - 0.025;
    const localTip = new THREE.Vector3(0, spoutY - Math.cos(tilt) * len, Math.sin(tilt) * len);
    const radius = 0.042;
    // The spout tip sits at the height of the hamster's mouth when it reaches up.
    this.group.position.set(x, GROUND + 0.13 * HS - localTip.y * S, -0.49 + radius * S + 0.004);
    this.group.scale.setScalar(S);

    const glass = look.mat(C.glass, { roughness: 0.1, opacity: 0.32 });
    const metal = look.mat(C.metal, { roughness: 0.4 });
    this.group.add(
      mesh(new THREE.CylinderGeometry(radius, radius, h, 12), glass),
      mesh(new THREE.CylinderGeometry(0.036, 0.036, h * 0.62, 12), look.mat(C.water, { roughness: 0.2, opacity: 0.75 }), [0, -h * 0.18, 0]),
      mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.028, 12), look.mat(C.cap), [0, h / 2 + 0.012, 0]),
      mesh(new THREE.CylinderGeometry(0.03, 0.044, 0.026, 12), look.mat(C.cap), [0, -h / 2 - 0.012, 0]),
      mesh(new THREE.BoxGeometry(0.06, 0.03, 0.008), metal, [0, 0.03, -radius - 0.002]),
      mesh(new THREE.TorusGeometry(0.045, 0.004, 4, 14), metal, [0, 0.03, 0], 1, [Math.PI / 2, 0, 0]),
      // Spout: down and out from the bottom, 30 degrees from vertical.
      mesh(new THREE.CylinderGeometry(0.006, 0.007, len, 6), look.mat(C.metal, { roughness: 0.35 }), [0, spoutY - (Math.cos(tilt) * len) / 2, (Math.sin(tilt) * len) / 2], 1, [-tilt, 0, 0]),
    );
    this.group.updateMatrixWorld(true);
    this.tip = this.group.localToWorld(localTip);
    this.stand = new THREE.Vector2(x, this.tip.z + 0.128 * HS);
    this.bubbleFrom = this.group.localToWorld(new THREE.Vector3(0, -h / 2 + 0.01, 0));
    this.waterTop = this.group.localToWorld(new THREE.Vector3(0, -h * 0.18 + h * 0.31, 0)).y;
  }
}
