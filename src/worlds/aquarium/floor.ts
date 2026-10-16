import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { capCuts, cutAt } from '../cut';
import { paintFaces, seeded, type Look } from '../kit';
import { A } from './look';

// The bottom of the tank: a bed of pale sand that rises toward the back,
// rocks in slate blue, branching coral, weed that sways in a slow current,
// and an old pot lying on its side. Caustics, the bright net of light the
// surface throws, wander over the sand.

/**
 * Half-width of the sand bed: right up to the glass, so the big rocks the
 * glass cuts off have no gap beside the sand to show their buried parts in.
 */
export const EDGE = 0.495;
const BASE = -0.49;
const SAND = -0.4;

const smoothstep = THREE.MathUtils.smoothstep;

/** The sand's height: low dunes, rising toward the two back walls. */
export function sandHeight(x: number, z: number) {
  const back = 0.06 * (1 - smoothstep(Math.min(x, z) + EDGE, 0.05, 0.55));
  return SAND + back + 0.012 * Math.sin(x * 7 + 1) * Math.cos(z * 5 - 0.4) + 0.006 * Math.sin((x + z) * 13);
}

const N = 48;

export class Floor {
  readonly group = new THREE.Group();
  readonly sand: THREE.Mesh;
  /** Where bubbles come from: the mouth of the pot, and a crack at the foot of the big rock. */
  readonly vents: THREE.Vector3[] = [];
  /** The big rock in the back corner, as an ellipsoid the jellies keep clear of. */
  readonly boulder = { center: new THREE.Vector3(BOULDER[0], 0, BOULDER[1]), radii: new THREE.Vector3(BOULDER[2], BOULDER[3], BOULDER[4]) };
  private readonly weed: Weed;
  private readonly caustics: THREE.ShaderMaterial;
  private readonly coral: THREE.MeshStandardMaterial;
  /** Every lit surface down here and its daytime colour, to dim at night. */
  private readonly lit: { material: THREE.MeshStandardMaterial; day: THREE.Color }[] = [];

  constructor(look: Look) {
    this.sand = buildSand(look);
    this.caustics = causticMaterial();
    const overlay = new THREE.Mesh(this.sand.geometry, this.caustics);
    overlay.position.y = 0.0015;
    overlay.renderOrder = 5;
    this.group.add(this.sand, overlay);

    const rocks = buildRocks(look);
    this.group.add(rocks, capCuts(rocks, EDGE, look.mat(A.rock[4], { roughness: 0.9 })));
    this.boulder.center.y = sandHeight(BOULDER[0], BOULDER[1]) + BOULDER[3] * 0.2;
    this.coral = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, emissive: '#5A2E58' });
    this.group.add(buildCorals(this.coral));
    const pot = buildPot(look);
    this.group.add(pot.group);
    this.vents.push(pot.mouth, new THREE.Vector3(-0.1, sandHeight(-0.1, -0.15), -0.15));
    this.weed = new Weed(look);
    this.group.add(this.weed.mesh);

    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.MeshStandardMaterial && !this.lit.some((l) => l.material === m)) {
        this.lit.push({ material: m, day: m.color.clone() });
      }
    });
  }

  update(t: number, daylight: number) {
    this.weed.update(t);
    this.caustics.uniforms.uTime.value = t;
    // Bright by day, a faint moonlit shimmer at night.
    this.caustics.uniforms.uStrength.value = 0.1 + 0.32 * daylight;
    // The room's night light is never dark, but the bottom of a tank at
    // night should be: everything down here dims, and only what glows
    // keeps its light. Coral keeps a little light of its own.
    const dim = 0.55 + 0.27 * daylight;
    for (const { material, day } of this.lit) material.color.copy(day).multiplyScalar(dim);
    this.coral.emissiveIntensity = 0.25 + 0.55 * (1 - daylight);
  }

  dispose() {
    this.weed.mesh.geometry.dispose();
    this.caustics.dispose();
    this.coral.dispose();
  }
}

// ---------- sand ----------

function buildSand(look: Look) {
  const rnd = seeded(41);
  const step = (EDGE * 2) / N;
  const at = (i: number, j: number) => {
    const x = -EDGE + i * step;
    const z = -EDGE + j * step;
    return new THREE.Vector3(x, sandHeight(x, z), z);
  };
  const top: number[] = [];
  const push = (...vs: THREE.Vector3[]) => vs.forEach((v) => top.push(v.x, v.y, v.z));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if ((i + j) % 2) push(a, d, b, b, d, c);
      else push(a, d, c, a, c, b);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  paintFaces(surface, () => A.sand[Math.floor(rnd() * A.sand.length)]);
  surface.computeVertexNormals();

  // The cut-away sides, seen through the glass: sand over a darker layer.
  const side: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const quad = (p: THREE.Vector3, q: THREE.Vector3, y0p: number, y0q: number, y1p: number, y1q: number, hex: string, out: THREE.Vector3) => {
    const v = [
      [p.x, y1p, p.z], [q.x, y1q, q.z], [q.x, y0q, q.z],
      [p.x, y1p, p.z], [q.x, y0q, q.z], [p.x, y0p, p.z],
    ];
    if (out.dot(new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3(0, 1, 0))) > 0) v.reverse();
    color.set(hex);
    for (const [x, y, z] of v) {
      side.push(x, y, z);
      colors.push(color.r, color.g, color.b);
    }
  };
  const edges: [(k: number) => THREE.Vector3, THREE.Vector3][] = [
    [(k) => at(k, 0), new THREE.Vector3(0, 0, -1)],
    [(k) => at(k, N), new THREE.Vector3(0, 0, 1)],
    [(k) => at(0, k), new THREE.Vector3(-1, 0, 0)],
    [(k) => at(N, k), new THREE.Vector3(1, 0, 0)],
  ];
  for (const [edge, out] of edges) {
    for (let k = 0; k < N; k++) {
      const p = edge(k);
      const q = edge(k + 1);
      const mid = -0.455;
      quad(p, q, mid, mid, p.y, q.y, A.sandSide[Math.floor(rnd() * A.sandSide.length)], out);
      quad(p, q, BASE, BASE, mid, mid, A.sandDeep, out);
    }
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
  sides.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sides.computeVertexNormals();

  const sand = new THREE.Mesh(surface, look.mat('#FFFFFF', { vertexColors: true }));
  sand.receiveShadow = true;
  // Two-sided, so where the glass's rounded corners trim the bed, the
  // notch shows sand from within rather than a hole.
  const skirt = new THREE.Mesh(sides, look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide }));
  skirt.receiveShadow = true;
  sand.add(skirt);
  return sand;
}

/** The net of light the rippling surface throws on the sand, drifting slowly. */
function causticMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.3 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      varying vec2 vXZ;
      // A well-worn trick: a few rounds of warping a point by sines, then
      // measuring how tightly the warped lines bunch together. It is tuned
      // for points far from the origin, hence the offset, and it tiles.
      const float TAU = 6.28318530718;
      float caustic(vec2 uv, float t) {
        vec2 p = mod(uv * TAU, TAU) - 250.0;
        vec2 i = p;
        float c = 1.0;
        for (int n = 0; n < 5; n++) {
          float tt = t * (1.0 - 3.5 / float(n + 1));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0 / max(1e-3, length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005))));
        }
        c /= 5.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 8.0), 0.0, 1.0);
      }
      void main() {
        float c = caustic(vXZ * 1.6 + 0.5, uTime * 0.25 + 23.0);
        gl_FragColor = vec4(vec3(${A.caustic.map((v) => v.toFixed(2)).join(', ')}) * c * uStrength, 0.0);
      }
    `,
  });
}

// ---------- rocks ----------

/** x, z, and size; each sits a little sunk into the sand. */
/**
 * A great rock in the back corner, far bigger than the rest, to make a
 * landscape of the tank: it rises well past halfway up and the glass cuts
 * it off on both back walls. x, z, and size.
 */
const BOULDER: [number, number, number, number, number] = [-0.36, -0.36, 0.3, 0.42, 0.28];

const ROCKS: [number, number, number, number, number][] = [
  BOULDER,
  // Its neighbours along the back walls.
  [-0.06, -0.42, 0.11, 0.1, 0.1],
  [-0.44, -0.02, 0.1, 0.12, 0.1],
  [0.13, -0.43, 0.08, 0.07, 0.07],
  [0.3, -0.36, 0.13, 0.13, 0.11],
  [0.42, -0.13, 0.1, 0.09, 0.1],
  // Down the left side and across the front.
  [-0.36, 0.16, 0.11, 0.09, 0.1],
  [-0.2, 0.33, 0.08, 0.06, 0.07],
  [-0.4, 0.38, 0.07, 0.06, 0.07],
  [0.36, 0.33, 0.08, 0.06, 0.08],
  // A few loose stones on the open sand.
  [0.05, 0.14, 0.045, 0.035, 0.045],
  [-0.08, -0.16, 0.05, 0.04, 0.05],
  [0.15, 0.4, 0.04, 0.03, 0.04],
];

function rockGeometry(seed: number) {
  const rnd = seeded(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(1 + rnd(-0.18, 0.18));
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed();
  paintFaces(g, (c, n) => {
    if (n.y > 0.6 && c.y > 0.2) return A.rockTop[Math.floor(rnd() * A.rockTop.length)];
    return A.rock[Math.floor(rnd() * A.rock.length)];
  });
  g.computeVertexNormals();
  return g;
}

function buildRocks(look: Look) {
  const group = new THREE.Group();
  const material = cutAt(look.mat('#FFFFFF', { vertexColors: true, roughness: 0.9 }), EDGE);
  ROCKS.forEach(([x, z, sx, sy, sz], i) => {
    const m = new THREE.Mesh(rockGeometry(300 + i * 13), material);
    m.position.set(x, sandHeight(x, z) + sy * 0.2, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = i * 1.9;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });
  return group;
}

// ---------- coral ----------

const CORALS: { x: number; z: number; size: number; colors: readonly string[]; seed: number }[] = [
  { x: -0.03, z: -0.2, size: 1.7, colors: A.coral, seed: 3 },
  { x: 0.05, z: -0.33, size: 1.3, colors: A.coralLilac, seed: 9 },
  { x: 0.26, z: -0.2, size: 1.5, colors: A.coralWarm, seed: 14 },
  { x: -0.3, z: 0.02, size: 1.2, colors: A.coral, seed: 21 },
  { x: 0.24, z: 0.3, size: 1.1, colors: A.coralWarm, seed: 27 },
  { x: 0.1, z: -0.08, size: 0.9, colors: A.coralLilac, seed: 33 },
  { x: -0.25, z: 0.3, size: 0.9, colors: A.coralLilac, seed: 41 },
];

/** A branching coral: tapered limbs forking upward, with rounded tips. */
function coralGeometry(seed: number, size: number, colors: readonly string[]) {
  const rnd = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, length);
    const limb = new THREE.CylinderGeometry(radius * 0.7, radius, length, 5, 1);
    limb.translate(0, length / 2, 0);
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    limb.translate(from.x, from.y, from.z);
    parts.push(limb.toNonIndexed());
    if (depth === 0) {
      const tip = new THREE.IcosahedronGeometry(radius * 1.1, 0);
      tip.translate(to.x, to.y, to.z);
      parts.push(tip); // already one vertex per corner
      return;
    }
    const forks = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < forks; k++) {
      const spin = (k / forks) * Math.PI * 2 + rnd(-0.5, 0.5);
      const tilt = rnd(0.3, 0.65);
      const next = dir.clone().applyAxisAngle(new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin)), tilt);
      next.lerp(up, 0.35).normalize();
      grow(to, next, length * rnd(0.62, 0.8), radius * 0.72, depth - 1);
    }
  };
  for (let s = 0; s < 3; s++) {
    const a = rnd(0, Math.PI * 2);
    const base = new THREE.Vector3(Math.cos(a) * 0.012, 0, Math.sin(a) * 0.012);
    grow(base, new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize(), 0.045 * size, 0.009 * size, 3);
  }
  for (const p of parts) {
    p.deleteAttribute('uv');
    p.deleteAttribute('normal');
  }
  const g = mergeGeometries(parts)!;
  paintFaces(g, () => colors[Math.floor(rnd() * colors.length)]);
  g.computeVertexNormals();
  return g;
}

function buildCorals(material: THREE.Material) {
  const group = new THREE.Group();
  for (const c of CORALS) {
    const m = new THREE.Mesh(coralGeometry(c.seed, c.size, c.colors), material);
    m.position.set(c.x, sandHeight(c.x, c.z) - 0.004, c.z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// ---------- the pot ----------

/** An old amphora lying on its side, half in the sand, its mouth toward the view. */
function buildPot(look: Look) {
  const profile = [
    [0.03, 0], [0.058, 0.03], [0.074, 0.08], [0.068, 0.13], [0.046, 0.165],
    [0.03, 0.19], [0.032, 0.205], [0.04, 0.215],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const outer = new THREE.LatheGeometry(profile, 9);
  const inner = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p.x * 0.88, p.y)), 9);
  const group = new THREE.Group();
  const shell = new THREE.Mesh(outer, look.mat(A.pot[0], { roughness: 0.95 }));
  const hollow = new THREE.Mesh(inner, look.mat(A.potInner, { side: THREE.BackSide }));
  shell.castShadow = true;
  shell.receiveShadow = true;
  hollow.receiveShadow = true;
  const body = new THREE.Group();
  body.add(shell, hollow);
  // Lay it down along +x, then turn its mouth toward the front.
  body.rotation.z = -Math.PI / 2;
  body.position.x = -0.1;
  group.add(body);
  group.scale.setScalar(1.45);
  const x = 0.2;
  const z = 0.08;
  group.position.set(x, sandHeight(x, z) + 0.05, z);
  group.rotation.y = -0.75;
  group.rotation.z = 0.1;
  group.updateMatrixWorld(true);
  const mouth = new THREE.Vector3(0.115, 0.015, 0).applyMatrix4(group.matrixWorld);
  return { group, mouth };
}

// ---------- weed ----------

/** Ribbons of weed rooted in the sand, swaying in one slow current. */
class Weed {
  readonly mesh: THREE.Mesh;
  private readonly strands: { x: number; z: number; y: number; height: number; width: number; facing: number; phase: number }[] = [];
  private static readonly SEGMENTS = 12;

  constructor(look: Look) {
    const rnd = seeded(77);
    const clumps: [number, number, number][] = [
      [-0.12, -0.08, 4], [-0.42, 0.06, 4], [0.0, -0.42, 4], [0.18, -0.4, 4], [-0.08, -0.26, 3],
      [0.42, -0.26, 3], [-0.27, 0.24, 4], [0.42, 0.18, 3], [0.06, 0.38, 3], [-0.42, 0.42, 3],
      [0.32, 0.1, 2], [0.14, -0.22, 2],
    ];
    for (const [cx, cz, count] of clumps) {
      for (let k = 0; k < count; k++) {
        const x = cx + rnd(-0.035, 0.035);
        const z = cz + rnd(-0.035, 0.035);
        this.strands.push({
          x,
          z,
          y: sandHeight(x, z) - 0.005,
          height: rnd(0.2, 0.46) * (Math.abs(cx) > 0.3 || cz < -0.3 ? 1.15 : 0.8),
          width: rnd(0.02, 0.034),
          facing: rnd(0, Math.PI),
          phase: rnd(0, Math.PI * 2),
        });
      }
    }
    const S = Weed.SEGMENTS;
    const count = this.strands.length * (S + 1) * 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const colors = new Float32Array(count * 3);
    const index: number[] = [];
    const base = new THREE.Color();
    const tip = new THREE.Color();
    const c = new THREE.Color();
    this.strands.forEach((_, s) => {
      base.set(A.weed[s % A.weed.length]);
      tip.set(A.weedTip[s % A.weedTip.length]);
      for (let i = 0; i <= S; i++) {
        c.copy(base).lerp(tip, (i / S) ** 1.5);
        const v = (s * (S + 1) + i) * 2;
        c.toArray(colors, v * 3);
        c.toArray(colors, (v + 1) * 3);
        if (i < S) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  update(t: number) {
    const S = Weed.SEGMENTS;
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    this.strands.forEach((w, s) => {
      const fx = Math.cos(w.facing);
      const fz = Math.sin(w.facing);
      let x = w.x;
      let z = w.z;
      let y = w.y;
      const seg = w.height / S;
      for (let i = 0; i <= S; i++) {
        const h = i / S;
        // Leaf-like: wider in the middle, frilled, narrowing to a point.
        const half = (w.width / 2) * Math.sin(Math.PI * Math.min(1, h * 0.9 + 0.08)) * (1 + 0.35 * Math.sin(h * 26 + w.phase));
        const v = (s * (S + 1) + i) * 2;
        p[v * 3] = x - fx * half;
        p[v * 3 + 1] = y;
        p[v * 3 + 2] = z - fz * half;
        p[v * 3 + 3] = x + fx * half;
        p[v * 3 + 4] = y;
        p[v * 3 + 5] = z + fz * half;
        // The current leans each strand more the higher it goes.
        const lean = 0.5 * h * (Math.sin(t * 0.55 + w.phase + h * 2.2) * 0.8 + 0.25);
        const sway = 0.35 * h * Math.sin(t * 0.8 + w.phase * 1.7 + h * 3);
        x += seg * (lean * 0.8);
        z += seg * (sway * 0.8 + lean * 0.3);
        y += seg * Math.sqrt(Math.max(0.2, 1 - lean * lean * 0.64 - sway * sway * 0.64));
      }
    });
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
