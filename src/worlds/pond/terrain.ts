import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintFaces, pick, seeded, type Look } from '../kit';
import { P } from './look';

// The ground: a slab of earth that fills the floor of the cube, cut away at
// the glass like a diorama, with a pond sunk into it and a ridge along the
// back where the water falls in. Everything else stands on `groundHeight`.

/** Half-width of the slab, a hair inside the glass. */
export const EDGE = 0.49;
export const BASE = -0.49;
/** The grass, before the ridge and small bumps. */
export const GRASS = -0.36;
/** The still water line. */
export const WATER = -0.39;

const smoothstep = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;

/** Three overlapping circles, blended into one rounded pond. */
const LOBES: [number, number, number][] = [
  [0.07, 0.1, 0.25],
  [-0.19, -0.07, 0.165],
  [0.13, -0.13, 0.12],
];

function smin(a: number, b: number, k: number) {
  const h = THREE.MathUtils.clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

/** Signed distance to the pond's edge: negative on the water. */
export function pondSdf(x: number, z: number) {
  const lobe = ([cx, cz, r]: [number, number, number]) => Math.hypot(x - cx, z - cz) - r;
  let d = lobe(LOBES[0]);
  for (let i = 1; i < LOBES.length; i++) d = smin(d, lobe(LOBES[i]), 0.09);
  return d + 0.008 * Math.sin(x * 17 + 1.3) * Math.sin(z * 15 - 0.7) + 0.005 * Math.sin((x + z) * 23);
}

/** The direction toward deeper water, for anything that strays to the edge. */
export function pondInward(x: number, z: number, out = new THREE.Vector2()) {
  const e = 0.004;
  out.set(pondSdf(x - e, z) - pondSdf(x + e, z), pondSdf(x, z - e) - pondSdf(x, z + e));
  return out.lengthSq() > 0 ? out.normalize() : out.set(-x, -z).normalize();
}

/** A ridge along the two back walls, highest in the corner. */
function ridge(x: number, z: number) {
  return 0.15 * (1 - smoothstep(Math.min(x + EDGE, z + EDGE), 0.02, 0.36));
}

export function groundHeight(x: number, z: number) {
  const s = pondSdf(x, z);
  if (s < 0) return WATER - 0.006 - 0.058 * smoothstep(-s, 0, 0.13);
  const land = GRASS + ridge(x, z) + 0.005 * Math.sin(x * 21 + z * 6) * Math.cos(z * 17 - x * 4);
  return lerp(WATER - 0.006, land, smoothstep(s, 0, 0.055));
}

const N = 72;

/** The slab: a faceted heightfield on top and banded soil down the sides. */
export function buildTerrain(look: Look): THREE.Mesh {
  const rnd = seeded(7);
  const step = (EDGE * 2) / N;
  const at = (i: number, j: number) => {
    const x = -EDGE + i * step;
    const z = -EDGE + j * step;
    return new THREE.Vector3(x, groundHeight(x, z), z);
  };
  const top: number[] = [];
  const push = (...vs: THREE.Vector3[]) => vs.forEach((v) => top.push(v.x, v.y, v.z));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      // Alternate the diagonal, so the facets don't all lean one way.
      if ((i + j) % 2) push(a, d, b, b, d, c);
      else push(a, d, c, a, c, b);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  paintFaces(surface, (c, n) => {
    const s = pondSdf(c.x, c.z);
    if (s < -0.004) return pick2(s < -0.07 ? P.bedDeep : s < -0.035 ? (rnd() < 0.5 ? P.bedDeep : P.bed) : P.bed, rnd);
    if (s < 0.012) return pick2(P.dirt, rnd);
    // Steep faces are earth low down and stone higher up, under the ridge.
    if (n.y < 0.72) return rnd() < 0.55 - THREE.MathUtils.clamp((c.y - GRASS) / 0.06, 0, 0.4) ? pick2(P.dirt, rnd) : pick2(P.rock, rnd);
    if (s < 0.05 && rnd() < 0.6) return pick2(P.moss, rnd);
    return pick2(P.grass, rnd);
  });

  // The cut-away sides: a band of turf, then soil, darker toward the bottom.
  const side: number[] = [];
  const sideColors: number[] = [];
  const color = new THREE.Color();
  const quad = (p: THREE.Vector3, q: THREE.Vector3, y0: number, y1p: number, y1q: number, hex: string, out: THREE.Vector3) => {
    const v = [
      [p.x, y1p, p.z], [q.x, y1q, q.z], [q.x, y0, q.z],
      [p.x, y1p, p.z], [q.x, y0, q.z], [p.x, y0, p.z],
    ];
    // Wind each side so it faces out of the slab.
    if (out.dot(new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3(0, 1, 0))) > 0) v.reverse();
    color.set(hex);
    for (const [x, y, z] of v) {
      side.push(x, y, z);
      sideColors.push(color.r, color.g, color.b);
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
      const soil = pick2(P.soil, rnd);
      quad(p, q, p.y - 0.012, p.y, q.y, P.turf, out);
      const band = (y0: number, y1: number, hex: string) => quad(p, q, y0, Math.min(y1, p.y - 0.012), Math.min(y1, q.y - 0.012), hex, out);
      band(-0.415, 0, soil);
      band(-0.455, -0.415, P.soilDark);
      band(BASE, -0.455, P.soilDeep);
    }
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
  sides.setAttribute('color', new THREE.Float32BufferAttribute(sideColors, 3));

  const ground = new THREE.Mesh(surface, look.mat('#FFFFFF', { vertexColors: true }));
  ground.receiveShadow = true;
  const skirt = new THREE.Mesh(sides, look.mat('#FFFFFF', { vertexColors: true }));
  skirt.receiveShadow = true;
  ground.add(skirt);
  surface.computeVertexNormals();
  sides.computeVertexNormals();
  return ground;
}

function pick2<T>(xs: readonly T[], rnd: () => number): T {
  return xs[Math.floor(rnd() * xs.length)];
}

// ---------- stones ----------

/**
 * A stone: a lumpy, flat-bottomed icosahedron, grey on the sides, with moss
 * on whatever faces the sky.
 */
export function stoneGeometry(seed: number, moss = 0.55) {
  const rnd = seeded(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(1 + rnd(-0.16, 0.16));
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed();
  const grey = pick2(P.rock, rnd);
  paintFaces(g, (c, n) => {
    if (n.y > moss && c.y > 0) return pick2(P.moss, rnd);
    return rnd() < 0.7 ? grey : pick2(P.rock, rnd);
  });
  g.computeVertexNormals();
  return g;
}

export interface StoneSpec {
  at: [number, number, number];
  size: [number, number, number];
  yaw?: number;
  moss?: number;
}

export function buildStones(look: Look, specs: StoneSpec[]) {
  const group = new THREE.Group();
  const material = look.mat('#FFFFFF', { vertexColors: true });
  specs.forEach((s, i) => {
    const m = new THREE.Mesh(stoneGeometry(101 + i * 17, s.moss ?? 0.55), material);
    m.position.set(...s.at);
    m.scale.set(...s.size);
    m.rotation.y = s.yaw ?? i * 1.7;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });
  return group;
}

/** Small pebbles scattered over the pond bed, seen through the water. */
export function buildPebbles(look: Look) {
  const rnd = seeded(23);
  const count = 130;
  const pebbles = new THREE.InstancedMesh(look.chip, look.mat('#FFFFFF'), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < 4000; tries++) {
    const x = rnd(-0.42, 0.42);
    const z = rnd(-0.42, 0.42);
    const s = pondSdf(x, z);
    if (s > 0.012) continue;
    // Bigger stones gather along the water's edge.
    const r = s > -0.012 ? rnd(0.01, 0.02) : rnd(0.006, 0.013);
    e.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    m.compose(new THREE.Vector3(x, groundHeight(x, z) + r * 0.2, z), q.setFromEuler(e), new THREE.Vector3(r, r * 0.55, r * rnd(0.8, 1.2)));
    pebbles.setMatrixAt(n, m);
    pebbles.setColorAt(n, c.set(pick(rnd() < 0.5 ? P.rock : P.bed)));
    n++;
  }
  pebbles.count = n;
  pebbles.receiveShadow = true;
  return pebbles;
}

