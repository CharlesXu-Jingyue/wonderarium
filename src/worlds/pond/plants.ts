import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mesh, paintFaces, seeded, type Look } from '../kit';
import { P } from './look';
import { groundHeight, pondSdf } from './terrain';

// Everything that grows: pines and a leafy tree along the back, ferns and
// grass on the banks, cattails at the water's edge, flowers, mushrooms, and
// the lily pads. All of it moves a little in a breeze that never stops.

type Rnd = (a?: number, b?: number) => number;
const pickR = <T>(xs: readonly T[], rnd: Rnd): T => xs[Math.floor(rnd() * xs.length)];

/** The breeze: one clock for every swaying thing, in shaders and out. */
export class Wind {
  readonly time = { value: 0 };

  step(dt: number) {
    this.time.value += dt;
  }

  /** A slow, irregular push, about -1..1, different at every phase. */
  at(phase: number, t = this.time.value) {
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13 + phase * 0.3);
    return (Math.sin(t * 0.9 + phase) * 0.6 + Math.sin(t * 2.1 + phase * 1.7) * 0.25) * (0.5 + gust);
  }

  /**
   * A copy of `base` whose vertices sway, more the higher they are above the
   * mesh's own origin. `tip` is how far a vertex `height` up moves, at most.
   */
  material(base: THREE.MeshStandardMaterial, height: number, tip: number) {
    const bend = tip / (height * height * 1.5);
    const m = base.clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uBend = { value: bend };
      shader.vertexShader = `uniform float uTime;\nuniform float uBend;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 windAt = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float windK = max(position.y, 0.0) * max(position.y, 0.0) * uBend;
        float gust = 0.75 + 0.5 * sin(uTime * 0.13 + windAt.x * 2.0);
        transformed.x += (sin(uTime * 1.3 + windAt.x * 9.0 + windAt.z * 5.0) + 0.5 * sin(uTime * 2.3 + windAt.z * 11.0)) * windK * gust;
        transformed.z += cos(uTime * 1.1 + windAt.x * 6.0 - windAt.z * 8.0) * windK * 0.7 * gust;`,
      );
    };
    m.customProgramCacheKey = () => 'pond-wind';
    return m;
  }
}

/**
 * A blade or leaf: a strip that rises along +y and arches toward +z, with a
 * crease down the middle. 'taper' narrows to a point (grass, reeds); 'leaf'
 * swells in the middle (ferns, fallen leaves).
 */
export function bladeGeometry(len: number, width: number, arch: number, segs = 4, shape: 'taper' | 'leaf' = 'taper') {
  const rows: THREE.Vector3[][] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    if (i > 0) {
      const a = arch * (t - 0.5 / segs);
      p.add(new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(len / segs));
    }
    const w = shape === 'taper' ? width * (1 - t) : width * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.7);
    const fold = w * 0.22;
    rows.push([
      new THREE.Vector3(-w / 2, p.y - fold, p.z),
      p.clone(),
      new THREE.Vector3(w / 2, p.y - fold, p.z),
    ]);
  }
  const out: number[] = [];
  const tri = (...vs: THREE.Vector3[]) => vs.forEach((v) => out.push(v.x, v.y, v.z));
  for (let i = 0; i < segs; i++) {
    const [l0, c0, r0] = rows[i];
    const [l1, c1, r1] = rows[i + 1];
    tri(l0, c0, c1);
    tri(r0, r1, c1);
    if (i < segs - 1 || shape === 'leaf') {
      tri(l0, c1, l1);
      tri(c0, r0, c1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

/** Shades a geometry with one colour, varied face by face. */
function shade(g: THREE.BufferGeometry, colors: readonly string[], rnd: Rnd) {
  return paintFaces(g, () => pickR(colors, rnd));
}

// ---------- trees ----------

/** Anything that can be shaken by a click and leans in the breeze. */
export class Tree {
  readonly group = new THREE.Group();
  /** The part that sways, pivoting at the base of the trunk. */
  readonly sway = new THREE.Group();
  /** Leafy parts, for picking. */
  readonly crown = new THREE.Group();
  private shaking = 0;

  constructor(readonly leafy: boolean, private readonly phase: number, private readonly stiffness: number) {
    this.group.add(this.sway);
  }

  shake() {
    this.shaking = 1;
  }

  update(wind: Wind, dt: number) {
    this.shaking = Math.max(0, this.shaking - dt * 0.7);
    const t = wind.time.value;
    const k = this.shaking * this.shaking;
    this.sway.rotation.z = wind.at(this.phase) * 0.012 * this.stiffness + Math.sin(t * 13) * 0.035 * k;
    this.sway.rotation.x = wind.at(this.phase + 2) * 0.008 * this.stiffness + Math.cos(t * 11) * 0.025 * k;
  }

  /** A point in the crown, in the tree's parent space, where a leaf could let go. */
  leafSpot(rnd: Rnd) {
    const leaves = this.crown.children;
    const m = leaves[Math.floor(rnd() * leaves.length)] as THREE.Mesh;
    const p = new THREE.Vector3(rnd(-0.6, 0.6), rnd(-0.6, 0.2), rnd(-0.6, 0.6));
    return m.localToWorld(p);
  }
}

export function pine(look: Look, seed: number, height: number): Tree {
  const rnd = seeded(seed);
  const tree = new Tree(false, seed, 0.8);
  const trunkH = height * 0.36;
  tree.sway.add(
    mesh(new THREE.CylinderGeometry(0.011, 0.019, trunkH, 6), look.mat(P.trunk), [0, trunkH / 2, 0]),
  );
  const material = look.mat('#FFFFFF', { vertexColors: true });
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = height * (0.27 - 0.17 * f);
    const h = height * (0.34 - 0.08 * f);
    const g = new THREE.ConeGeometry(r, h, 7, 1).toNonIndexed();
    shade(g, [P.pine[Math.min(3, k)], P.pine[Math.min(3, k + 1)], P.pine[Math.max(0, k - 1)]], rnd);
    g.computeVertexNormals();
    const cone = new THREE.Mesh(g, material);
    cone.position.set(rnd(-0.004, 0.004), height * (0.24 + 0.2 * k) + h / 2, rnd(-0.004, 0.004));
    cone.rotation.set(rnd(-0.05, 0.05), rnd(0, Math.PI), rnd(-0.05, 0.05));
    cone.castShadow = true;
    cone.receiveShadow = true;
    tree.crown.add(cone);
  }
  tree.sway.add(tree.crown);
  return tree;
}

/** A broad, round-crowned tree that leans out over the water. */
export function leafTree(look: Look, seed: number): Tree {
  const rnd = seeded(seed);
  const tree = new Tree(true, seed, 1);
  const bark = look.mat(P.trunk);
  // Trunk in three pieces, leaning toward the pond (+x local), with two limbs.
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const d = new THREE.Vector3().subVectors(to, from);
    const m = mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 6), bark);
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    tree.sway.add(m);
  };
  const a = new THREE.Vector3(0, -0.01, 0);
  const b = new THREE.Vector3(0.015, 0.16, 0.0);
  const c = new THREE.Vector3(-0.03, 0.3, 0.01);
  limb(a, b, 0.03, 0.022);
  limb(b, c, 0.022, 0.015);
  limb(b, new THREE.Vector3(0.12, 0.28, 0.03), 0.014, 0.008);
  limb(c, new THREE.Vector3(-0.1, 0.36, -0.02), 0.012, 0.007);
  // Roots spreading at the foot.
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + 0.4;
    limb(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(Math.cos(ang) * 0.06, -0.01, Math.sin(ang) * 0.06), 0.014, 0.006);
  }

  // The crown: lumpy clusters of leaves, lighter where they face the sky.
  const material = look.mat('#FFFFFF', { vertexColors: true });
  const clusters: [number, number, number, number][] = [
    [0.0, 0.36, 0.0, 0.1],
    [0.12, 0.32, 0.03, 0.085],
    [-0.1, 0.38, -0.02, 0.08],
    [0.05, 0.44, 0.05, 0.08],
    [-0.04, 0.42, -0.08, 0.075],
    [0.09, 0.37, -0.08, 0.07],
    [-0.06, 0.31, 0.08, 0.07],
    [0.15, 0.28, -0.04, 0.06],
  ];
  clusters.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      // Jitter by direction, so shared corners stay together.
      v.fromBufferAttribute(pos, k);
      const j = 1 + 0.12 * Math.sin(v.x * 7 + i) * Math.cos(v.z * 6 - i) + 0.05 * Math.sin(v.y * 9 + i);
      pos.setXYZ(k, v.x * j, v.y * j * 0.85, v.z * j);
    }
    paintFaces(g, (_c, n) => (n.y > 0.45 ? pickR(P.leaf.slice(1, 3), rnd) : n.y < -0.3 ? P.leaf[3] : pickR(P.leaf, rnd)));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.scale.setScalar(r);
    m.rotation.y = rnd(0, Math.PI);
    m.castShadow = true;
    m.receiveShadow = true;
    tree.crown.add(m);
  });
  tree.sway.add(tree.crown);
  return tree;
}

// ---------- ground plants ----------

/** A fern: arching fronds in a rosette, swaying from the tips. */
export function fern(look: Look, wind: Wind, seed: number, size: number) {
  const rnd = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rnd(0, 3));
  for (let i = 0; i < n; i++) {
    const g = bladeGeometry(size * rnd(0.85, 1.15), size * 0.32, rnd(1.2, 1.7), 5, 'leaf');
    g.rotateY((i / n) * Math.PI * 2 + rnd(-0.2, 0.2));
    shade(g, P.fern, rnd);
    parts.push(g);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, wind.material(look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide }), size, 0.006));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Tufts of grass scattered over the banks, one instanced mesh. */
export function grass(look: Look, wind: Wind, count: number, avoid: (x: number, z: number) => boolean) {
  const rnd = seeded(41);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = bladeGeometry(rnd(0.026, 0.04), 0.007, rnd(0.4, 0.9), 3);
    g.rotateY((i / 5) * Math.PI * 2 + rnd(-0.3, 0.3));
    g.translate(rnd(-0.004, 0.004), 0, rnd(-0.004, 0.004));
    paintFaces(g, () => new THREE.Color().setScalar(rnd(0.82, 1)));
    parts.push(g);
  }
  const tuft = mergeGeometries(parts)!;
  tuft.computeVertexNormals();
  const material = wind.material(look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide }), 0.035, 0.004);
  const tufts = new THREE.InstancedMesh(tuft, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  let k = 0;
  for (let tries = 0; k < count && tries < count * 20; tries++) {
    const x = rnd(-0.47, 0.47);
    const z = rnd(-0.47, 0.47);
    const s = pondSdf(x, z);
    if (s < 0.012 || avoid(x, z)) continue;
    const sc = rnd(0.8, 1.4) * (s < 0.05 ? 1.3 : 1);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(0, Math.PI * 2));
    m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.002, z), q, new THREE.Vector3(sc, sc, sc));
    tufts.setMatrixAt(k, m);
    tufts.setColorAt(k, c.set(pickR(P.grass, rnd)));
    k++;
  }
  tufts.count = k;
  tufts.receiveShadow = true;
  return tufts;
}

/** Something on the bank that leans in the breeze from its base. */
export interface Swaying {
  obj: THREE.Object3D;
  phase: number;
  amount: number;
}

/** A clump of cattails: stalks with brown heads and long blades at the foot. */
export class Cattails {
  readonly group = new THREE.Group();
  readonly stalks: Swaying[] = [];
  /** Local tips of each stalk, for a dragonfly to land on. */
  private readonly tips: THREE.Object3D[] = [];

  constructor(look: Look, wind: Wind, seed: number, count: number) {
    const rnd = seeded(seed);
    const stalkMat = look.mat(P.reed[0]);
    const headMat = look.mat(P.cattail, { roughness: 1 });
    const head = new THREE.CapsuleGeometry(0.0065, 0.026, 2, 6);
    for (let i = 0; i < count; i++) {
      const h = rnd(0.12, 0.19);
      const s = new THREE.Group();
      s.position.set(rnd(-0.02, 0.02), 0, rnd(-0.02, 0.02));
      s.rotation.set(rnd(-0.1, 0.1), rnd(0, 3), rnd(-0.1, 0.1));
      s.add(
        mesh(new THREE.CylinderGeometry(0.0018, 0.0026, h, 4), stalkMat, [0, h / 2, 0]),
        mesh(head, headMat, [0, h - 0.018, 0]),
        mesh(new THREE.CylinderGeometry(0.0004, 0.0012, 0.02, 3), stalkMat, [0, h + 0.008, 0]),
      );
      const tip = new THREE.Object3D();
      tip.position.set(0, h + 0.016, 0);
      s.add(tip);
      this.tips.push(tip);
      this.group.add(s);
      this.stalks.push({ obj: s, phase: seed + i * 1.3, amount: 0.05 });
    }
    // Long blades around the stalks.
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count + 3; i++) {
      const g = bladeGeometry(rnd(0.08, 0.14), 0.008, rnd(0.3, 0.8), 4);
      g.rotateY(rnd(0, Math.PI * 2));
      g.translate(rnd(-0.02, 0.02), 0, rnd(-0.02, 0.02));
      shade(g, P.reed, rnd);
      parts.push(g);
    }
    const blades = mergeGeometries(parts)!;
    blades.computeVertexNormals();
    const b = new THREE.Mesh(blades, wind.material(look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide }), 0.12, 0.007));
    b.castShadow = true;
    this.group.add(b);
  }

  perches() {
    return this.tips;
  }
}

/** A little flower on a stem: daisy-like, in one of a few soft colours. */
export function flower(look: Look, seed: number): Swaying {
  const rnd = seeded(seed);
  const g = new THREE.Group();
  const h = rnd(0.025, 0.045);
  g.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0016, h, 3), look.mat(P.stem), [0, h / 2, 0]));
  const head = new THREE.Group();
  head.position.y = h;
  head.rotation.x = rnd(-0.4, 0.2);
  const petal = look.mat(pickR(P.petals, rnd));
  const n = 5 + Math.floor(rnd(0, 2));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    head.add(mesh(look.gem, petal, [Math.cos(a) * 0.006, 0, Math.sin(a) * 0.006], [0.006, 0.0018, 0.0035], [0, -a, 0]));
  }
  head.add(mesh(look.blob, look.mat(P.heart), [0, 0.001, 0], 0.0032));
  g.add(head);
  return { obj: g, phase: seed, amount: 0.12 };
}

/** A cluster of small toadstools. */
export function mushrooms(look: Look, seed: number) {
  const rnd = seeded(seed);
  const g = new THREE.Group();
  const cap = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const s = rnd(0.7, 1.2) * (i === 0 ? 1.3 : 1);
    const m = new THREE.Group();
    m.position.set(rnd(-0.015, 0.015), 0, rnd(-0.015, 0.015));
    m.rotation.set(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2));
    m.scale.setScalar(s);
    m.add(
      mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.016, 6), look.mat(P.capStem), [0, 0.008, 0]),
      mesh(cap, look.mat(i === 1 ? P.capBrown : P.capRed), [0, 0.015, 0], [0.012, 0.009, 0.012]),
    );
    g.add(m);
  }
  return g;
}

// ---------- the log ----------

/** A hollow, mossy log lying from `a` to `b` (x/z), resting at height `y`. */
export function log(look: Look, a: THREE.Vector2, b: THREE.Vector2, y: number, r: number) {
  const rnd = seeded(5);
  const len = a.distanceTo(b);
  const g = new THREE.Group();
  g.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
  g.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  const body = new THREE.Group();
  body.rotation.z = Math.PI / 2; // cylinder axis along local x
  g.add(body);

  const bark = new THREE.CylinderGeometry(r, r * 1.05, len, 9, 4, true).toNonIndexed();
  paintFaces(bark, (c) => (Math.sin(c.y * 90 + Math.atan2(c.z, c.x) * 3) > 0.3 ? P.barkDark : rnd() < 0.15 ? P.trunk : P.bark));
  bark.computeVertexNormals();
  const material = look.mat('#FFFFFF', { vertexColors: true });
  body.add(mesh(bark, material));
  const hollow = mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.75, len, 9, 1, true), look.mat(P.barkDark, { side: THREE.BackSide }));
  body.add(hollow);
  for (const end of [1, -1]) {
    const ring = mesh(new THREE.RingGeometry(r * 0.72, r * (end > 0 ? 1 : 1.05), 9), look.mat(P.logInner, { side: THREE.DoubleSide }), [0, (end * len) / 2, 0], 1, [-Math.PI / 2, 0, 0]);
    body.add(ring);
    const inner = mesh(new THREE.RingGeometry(r * 0.78, r * 0.86, 9), look.mat(P.logRing, { side: THREE.DoubleSide }), [0, (end * len) / 2 + end * 0.0008, 0], 1, [-Math.PI / 2, 0, 0]);
    body.add(inner);
  }
  // Moss along the top, and a broken-off branch.
  for (let i = 0; i < 5; i++) {
    const x = rnd(-0.4, 0.4) * len;
    g.add(mesh(look.blob, look.mat(pickR(P.moss, rnd)), [x, r * 0.9, rnd(-0.3, 0.3) * r], [rnd(0.02, 0.035), 0.008, rnd(0.015, 0.022)]));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.05, 5), look.mat(P.bark), [len * 0.18, r * 1.1, -r * 0.4], 1, [0.6, 0, -0.5]));
  return g;
}

// ---------- lily pads ----------

export class LilyPad {
  readonly group = new THREE.Group();
  readonly pad: THREE.Mesh;
  /** The flower's petals, which open by day and fold up at night. */
  private readonly petals: { pivot: THREE.Object3D; open: number; closed: number }[] = [];
  readonly vel = new THREE.Vector2();
  spin = 0;
  /** Pressed down by a frog, or bumped by a ripple; springs back. */
  dip = 0;
  private dipVel = 0;
  bloom = 1;

  constructor(look: Look, seed: number, readonly r: number, flower: 'white' | 'pink' | null) {
    const rnd = seeded(seed);
    const notch = 0.55;
    const g = new THREE.CylinderGeometry(r, r * 0.97, 0.003, 14, 1, false, notch / 2, Math.PI * 2 - notch).toNonIndexed();
    const sector = (Math.PI * 2 - notch) / 14;
    paintFaces(g, (c, n) => {
      if (n.y < 0.5) return P.padRim;
      const k = Math.floor((Math.atan2(c.x, c.z) - notch / 2 + Math.PI * 4) / sector);
      return k % 2 ? P.pad[0] : rnd() < 0.5 ? P.pad[1] : P.pad[2];
    });
    g.computeVertexNormals();
    this.pad = mesh(g, look.mat('#FFFFFF', { vertexColors: true }));
    this.pad.castShadow = false;
    this.group.add(this.pad);

    if (flower) {
      const head = new THREE.Group();
      head.position.set(rnd(-0.3, 0.3) * r, 0.003, rnd(-0.3, 0.3) * r);
      const color = look.mat(flower === 'pink' ? P.lilyPink : P.lily);
      const tip = look.mat(flower === 'pink' ? '#F2A9BA' : P.lilyPink);
      const ring = (n: number, len: number, open: number, closed: number, offset: number) => {
        for (let i = 0; i < n; i++) {
          const pivot = new THREE.Group();
          pivot.rotation.y = (i / n) * Math.PI * 2 + offset;
          const tilt = new THREE.Group();
          pivot.add(tilt);
          const p = mesh(look.gem, i % 3 ? color : tip, [0, 0, len], [len * 0.42, len * 0.16, len]);
          tilt.add(p);
          head.add(pivot);
          this.petals.push({ pivot: tilt, open, closed });
        }
      };
      ring(8, 0.012, -0.3, -1.25, 0);
      ring(6, 0.009, -0.75, -1.4, 0.3);
      head.add(mesh(look.blob, look.mat(P.lilyHeart), [0, 0.004, 0], [0.006, 0.004, 0.006]));
      this.group.add(head);
    }
  }

  get x() {
    return this.group.position.x;
  }
  get z() {
    return this.group.position.z;
  }

  /** Push the pad down (a frog landing, a ripple passing). */
  press(amount: number) {
    this.dipVel -= amount;
  }

  update(dt: number, waterY: number, wave: number, daylight: number) {
    // A damped spring keeps the pad on the surface.
    this.dipVel += (-this.dip * 60 - this.dipVel * 7) * dt;
    this.dip += this.dipVel * dt;
    this.group.position.y = waterY + 0.0015 + wave + this.dip;
    this.group.rotation.y += this.spin * dt;
    // Water lilies open in the morning and close toward evening.
    this.bloom += (THREE.MathUtils.smoothstep(daylight, 0.25, 0.7) - this.bloom) * Math.min(1, dt * 0.15);
    for (const p of this.petals) p.pivot.rotation.x = THREE.MathUtils.lerp(p.closed, p.open, this.bloom);
  }
}
