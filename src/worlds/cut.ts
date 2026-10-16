import * as THREE from 'three';

// Rocks that stand against the glass. A world's ground (a slab of soil, a
// bed of sand) stops a hair inside the glass; a rock that reaches past it is
// cut off where the ground ends rather than at the glass a few millimetres
// further out, or its buried base would hang down past the ground's
// cut-away side. Each cut is then closed with a flat face of stone, so the
// rock reads as solid rather than as a hollow shell.

/** The four upright planes at `edge` from the middle, facing inward. */
export function edgePlanes(edge: number) {
  return [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(
    ([x, y, z]) => new THREE.Plane(new THREE.Vector3(x, y, z), edge),
  );
}

/** A copy of `material` that is cut off at `edge`. */
export function cutAt<M extends THREE.Material>(material: M, edge: number): M {
  const m = material.clone() as M;
  m.clippingPlanes = edgePlanes(edge);
  return m;
}

/**
 * Flat faces, in `material`, over every place a mesh in `stones` is cut at
 * `edge`. Each is the outline of the cut, filled in, and sits in the same
 * plane as the ground's side; drawn a touch behind it, so below the
 * ground's surface the ground still shows and only the part standing above
 * it is stone.
 */
export function capCuts(stones: THREE.Object3D, edge: number, material: THREE.MeshStandardMaterial) {
  const caps = new THREE.Group();
  const face = material.clone();
  face.polygonOffset = true;
  face.polygonOffsetFactor = 1;
  face.polygonOffsetUnits = 2;
  const planes = edgePlanes(edge);
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  stones.updateMatrixWorld(true);
  for (const stone of stones.children) {
    if (!(stone instanceof THREE.Mesh)) continue;
    const pos = stone.geometry.getAttribute('position');
    for (const plane of planes) {
      // Where the stone's surface crosses the plane.
      const cut: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i += 3) {
        tri.forEach((v, k) => v.fromBufferAttribute(pos, i + k).applyMatrix4(stone.matrix));
        for (let k = 0; k < 3; k++) {
          const p = tri[k];
          const q = tri[(k + 1) % 3];
          const dp = plane.distanceToPoint(p);
          const dq = plane.distanceToPoint(q);
          if (dp < 0 !== dq < 0) cut.push(p.clone().lerp(q, dp / (dp - dq)));
        }
      }
      if (cut.length < 3) continue;
      const outline = hull(cut, plane.normal.x !== 0 ? 'z' : 'x');
      const out = plane.normal.clone().negate();
      const vertices: number[] = [];
      for (let i = 1; i + 1 < outline.length; i++) {
        const [a, b, c] = [outline[0], outline[i], outline[i + 1]];
        const facing = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(out);
        for (const v of facing > 0 ? [a, b, c] : [a, c, b]) vertices.push(v.x, v.y, v.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const cap = new THREE.Mesh(geometry, face);
      cap.receiveShadow = true;
      caps.add(cap);
    }
  }
  return caps;
}

/** The convex outline of points lying in a wall plane, by height and `along`. */
function hull(points: THREE.Vector3[], along: 'x' | 'z') {
  const pts = [...points].sort((a, b) => a[along] - b[along] || a.y - b.y);
  const cross = (o: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) =>
    (a[along] - o[along]) * (b.y - o.y) - (a.y - o.y) * (b[along] - o[along]);
  const half = (list: THREE.Vector3[]) => {
    const h: THREE.Vector3[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half([...pts].reverse())];
}
