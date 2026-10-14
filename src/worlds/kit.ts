import * as THREE from 'three';

// A small kit shared by every world: cached flat-shaded materials, a few
// stock shapes, one-call meshes, and the glass a click can tap.

interface MatOptions {
  roughness?: number;
  emissive?: string;
  opacity?: number;
  side?: THREE.Side;
  /** Colour comes from the geometry's per-vertex colours (times `color`). */
  vertexColors?: boolean;
}

/** Materials and geometries made once per world, and disposed with it. */
export class Look {
  readonly blob = new THREE.IcosahedronGeometry(1, 1);
  readonly gem = new THREE.IcosahedronGeometry(1, 0);
  readonly chip = new THREE.DodecahedronGeometry(1, 0);
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();

  mat(color: string, o: MatOptions = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${o.roughness ?? ''}|${o.emissive ?? ''}|${o.opacity ?? ''}|${o.side ?? ''}|${o.vertexColors ?? ''}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: o.roughness ?? 0.85,
        metalness: 0,
        emissive: o.emissive ?? '#000000',
        transparent: o.opacity !== undefined,
        opacity: o.opacity ?? 1,
        depthWrite: o.opacity === undefined,
        side: o.side ?? THREE.FrontSide,
        vertexColors: o.vertexColors ?? false,
      });
      this.mats.set(key, m);
    }
    return m;
  }
}

type V3 = [number, number, number];

/** A shadow-casting mesh, placed in one call. */
export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at: V3 = [0, 0, 0],
  scale: number | V3 = 1,
  rot: V3 = [0, 0, 0],
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...at);
  if (typeof scale === 'number') m.scale.setScalar(scale);
  else m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A repeatable random stream, so hand-placed scenery looks the same every time. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return a + u * (b - a);
  };
}

const GLASS = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));

/** Where a ray first meets the glass, and the outward normal of that pane. */
export function glassHit(ray: THREE.Ray): { at: THREE.Vector3; normal: THREE.Vector3 } | null {
  const at = ray.intersectBox(GLASS, new THREE.Vector3());
  if (!at) return null;
  const a = [Math.abs(at.x), Math.abs(at.y), Math.abs(at.z)];
  const axis = a.indexOf(Math.max(...a));
  const normal = new THREE.Vector3();
  normal.setComponent(axis, Math.sign(at.getComponent(axis)));
  return { at, normal };
}

/**
 * Give every triangle of a non-indexed geometry one flat colour, chosen from
 * where it sits and which way it faces. The low-poly look in one pass.
 */
export function paintFaces(
  geometry: THREE.BufferGeometry,
  color: (center: THREE.Vector3, normal: THREE.Vector3, face: number) => THREE.ColorRepresentation,
) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    center.copy(a).add(b).add(c).divideScalar(3);
    normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    tint.set(color(center, normal, i / 3));
    for (let k = 0; k < 3; k++) tint.toArray(colors, (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
