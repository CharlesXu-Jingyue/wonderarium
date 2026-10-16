import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mesh, paintFaces, seeded, type Look } from '../kit';
import { L, M } from './look';
import { FLOOR, MEZZ, WALL } from './room';

// What furnishes the loft. The stairs turn in the back-right corner and the
// sofa tucks in beneath their upper flight, against the back wall, with a
// round table and a rug before it. Under the mezzanine, a dark kitchen
// along the left wall with the fridge in the back corner and a wooden bar
// reaching out into the room, and a desk against the back wall. Upstairs: a low bed
// against the wall, nightstands, a bookshelf, a green rug. Pictures on the
// walls.
//
// Lamps and anything that gives light are in lights.ts.

type V3 = [number, number, number];

/** A box by its size and the middle of its base. */
function block(look: Look, w: number, h: number, d: number, color: string, x: number, y: number, z: number, yaw = 0, roughness?: number) {
  return mesh(new THREE.BoxGeometry(w, h, d), look.mat(color, roughness === undefined ? {} : { roughness }), [x, y + h / 2, z], 1, [0, yaw, 0]);
}

/** The sofa, under the upper flight of the stairs against the back wall. */
export const SOFA = { x0: 0.03, x1: 0.34, z0: WALL, z1: WALL + 0.16 };
/**
 * How far the kitchen sits out from the back corner, toward the bar end:
 * far enough that the fridge door swings clear of the desk.
 */
const KITCHEN = 0.12;
/** The kitchen's floating shelf, along the left wall above the counter. */
export const SHELF = { z0: -0.29 + KITCHEN, z1: 0.13 + KITCHEN, y: FLOOR + 0.28 }; // about 1.5 m: within reach
/** The bookshelf upstairs: three levels, deep, along the back wall. Its top, for what stands on it. */
export const BOOKSHELF = { x0: -0.41, x1: -0.11, depth: 0.085, top: MEZZ.top + 0.012 + 2 * 0.08 + 0.008 };
/** Where the mug on the table is, for its steam. */
export const MUG: V3 = [0.22, FLOOR + 0.082 + 0.017, -0.2];

export function buildFurniture(look: Look) {
  const g = new THREE.Group();
  const add = (...m: THREE.Object3D[]) => g.add(...m);
  const rnd = seeded(19);
  const counterH = 0.9 * M;

  // ---------- kitchen ----------
  const kx = WALL + 0.06; // middle of the counter's depth
  // The fridge at the counter's back end.
  add(block(look, 0.12, 1.9 * M, 0.13, L.steel, kx, FLOOR, WALL + 0.068 + KITCHEN, 0, 0.45));
  add(block(look, 0.004, 0.11, 0.004, '#8C8A88', kx + 0.061, FLOOR + 0.2, WALL + 0.12 + KITCHEN));
  // The counter run, dark doors under a pale top, with small handles.
  const runZ0 = WALL + 0.14 + KITCHEN;
  const runZ1 = 0.16 + KITCHEN;
  add(block(look, 0.11, counterH - 0.008, runZ1 - runZ0, L.cabinet, kx - 0.004, FLOOR, (runZ0 + runZ1) / 2));
  add(block(look, 0.118, 0.008, runZ1 - runZ0 + 0.004, L.counter, kx, FLOOR + counterH - 0.008, (runZ0 + runZ1) / 2));
  for (let z = runZ0 + 0.045; z < runZ1 - 0.02; z += 0.09) add(block(look, 0.003, 0.003, 0.03, '#9A948C', kx + 0.052, FLOOR + counterH - 0.03, z));
  // A sink and a cooktop set into the top.
  add(block(look, 0.07, 0.002, 0.08, '#8D8B88', kx, FLOOR + counterH, -0.12 + KITCHEN));
  add(block(look, 0.07, 0.002, 0.09, '#2A2826', kx, FLOOR + counterH, 0.05 + KITCHEN));
  add(mesh(new THREE.TorusGeometry(0.018, 0.0025, 4, 8, Math.PI), look.mat('#A8A6A2'), [kx - 0.04, FLOOR + counterH, -0.12 + KITCHEN], 1, [0, Math.PI / 2, 0]));
  // A floating shelf above it, with jars.
  add(block(look, 0.06, 0.01, SHELF.z1 - SHELF.z0, L.shelf, WALL + 0.03, SHELF.y, (SHELF.z0 + SHELF.z1) / 2));
  for (let i = 0; i < 6; i++) {
    const z = -0.24 + KITCHEN + i * 0.05;
    add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.022 + rnd(0, 0.012), 6), look.mat(i % 2 ? '#E7DCCB' : '#C9B79F'), [WALL + 0.03, SHELF.y + 0.023, z]));
  }
  // The bar: a wooden top on a dark base, reaching out into the room.
  const barZ = 0.165 + KITCHEN;
  add(block(look, 0.2, counterH - 0.004, 0.07, L.cabinet, WALL + 0.21, FLOOR, barZ));
  add(block(look, 0.235, 0.01, 0.1, L.table, WALL + 0.215, FLOOR + counterH + 0.012, barZ + 0.012));
  // Two stools at it.
  for (const x of [WALL + 0.16, WALL + 0.27]) {
    add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 8), look.mat(L.table), [x, FLOOR + 0.14, barZ + 0.1]));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      add(mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.14, 4), look.mat(L.metal), [x + Math.cos(a) * 0.013, FLOOR + 0.07, barZ + 0.1 + Math.sin(a) * 0.013], 1, [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]));
    }
  }

  // ---------- desk ----------
  const deskX0 = -0.31;
  const deskX1 = -0.06;
  const deskZ = WALL + 0.055;
  add(block(look, deskX1 - deskX0, 0.01, 0.11, L.table, (deskX0 + deskX1) / 2, FLOOR + 0.75 * M - 0.01, deskZ));
  add(block(look, 0.06, 0.75 * M - 0.01, 0.1, L.cabinet, deskX1 - 0.032, FLOOR, deskZ));
  add(block(look, 0.006, 0.75 * M - 0.01, 0.09, L.metal, deskX0 + 0.006, FLOOR, deskZ));
  // The chair, turned a little toward the room.
  const deskChair = new THREE.Group();
  deskChair.add(block(look, 0.06, 0.01, 0.055, L.metal, 0, 0.085, 0));
  deskChair.add(block(look, 0.058, 0.08, 0.008, L.metal, 0, 0.095, -0.028));
  deskChair.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), look.mat(L.metal), [0, 0.045, 0]));
  deskChair.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 5), look.mat(L.metal), [0, 0.004, 0]));
  deskChair.position.set(-0.19, FLOOR, WALL + 0.16);
  deskChair.rotation.y = Math.PI + 0.35;
  add(deskChair);
  // A shelf of books above the desk.
  add(block(look, 0.22, 0.008, 0.045, L.shelf, -0.19, FLOOR + 0.27, WALL + 0.023));
  add(books(look, rnd, -0.29, -0.12, FLOOR + 0.278, WALL + 0.023, 0.045));

  // ---------- living room ----------
  // The sofa, deep and low on a dark plinth, under the stairs.
  const sofa = new THREE.Group();
  const { x0: sx0, x1: sx1 } = SOFA;
  const sz = (SOFA.z0 + SOFA.z1) / 2;
  const depth = SOFA.z1 - SOFA.z0;
  sofa.add(block(look, sx1 - sx0 - 0.02, 0.018, depth - 0.03, L.metal, (sx0 + sx1) / 2, FLOOR, sz + 0.005));
  sofa.add(block(look, sx1 - sx0, 0.05, depth, L.sofaShade, (sx0 + sx1) / 2, FLOOR + 0.018, sz));
  sofa.add(block(look, sx1 - sx0, 0.085, 0.035, L.sofa, (sx0 + sx1) / 2, FLOOR + 0.068, SOFA.z0 + 0.0175));
  for (const x of [sx0 + 0.014, sx1 - 0.014]) sofa.add(block(look, 0.028, 0.06, depth, L.sofa, x, FLOOR + 0.068, sz));
  for (let k = 0; k < 2; k++) {
    const w = (sx1 - sx0 - 0.056) / 2;
    sofa.add(block(look, w - 0.004, 0.02, depth - 0.04, L.sofa, sx0 + 0.028 + w * (k + 0.5), FLOOR + 0.068, sz + 0.016));
  }
  const pillow = (x: number, color: string, yaw: number) => {
    sofa.add(mesh(new THREE.BoxGeometry(0.05, 0.045, 0.014), look.mat(color), [x, FLOOR + 0.11, SOFA.z0 + 0.044], 1, [-0.25, yaw, 0]));
  };
  pillow(sx0 + 0.05, L.cushion[0], 0.15);
  pillow(sx0 + 0.1, L.cushion[1], -0.1);
  pillow(sx1 - 0.06, L.cushion[2], -0.2);
  add(sofa);
  // A rug, and a round table on it with a mug and a book.
  const rug = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.003, 0.26), look.mat(L.rug, { roughness: 1 }));
  rug.position.set(0.19, FLOOR + 0.0015, -0.2);
  rug.receiveShadow = true;
  add(rug);
  add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 12), look.mat(L.table), [0.19, FLOOR + 0.078, -0.2]));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    add(mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.076, 4), look.mat(L.table), [0.19 + Math.cos(a) * 0.04, FLOOR + 0.038, -0.2 + Math.sin(a) * 0.04], 1, [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2]));
  }
  add(mesh(new THREE.CylinderGeometry(0.009, 0.008, 0.017, 8), look.mat(L.mug), [MUG[0], MUG[1] - 0.0085, MUG[2]]));
  add(mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.001, 8), look.mat(L.coffee), [MUG[0], MUG[1] - 0.001, MUG[2]]));
  add(block(look, 0.045, 0.008, 0.032, '#6F7D9A', 0.16, FLOOR + 0.082, -0.215, 0.4));

  // ---------- the mezzanine bedroom ----------
  const top = MEZZ.top;
  const bz = 0.06;
  const bed = new THREE.Group();
  bed.add(block(look, 0.37, 0.03, 0.3, L.bedFrame, WALL + 0.19, top, bz));
  bed.add(block(look, 0.355, 0.035, 0.285, L.linen, WALL + 0.19, top + 0.03, bz));
  bed.add(block(look, 0.26, 0.012, 0.295, L.linen, WALL + 0.24, top + 0.062, bz));
  bed.add(block(look, 0.09, 0.014, 0.305, L.throw, WALL + 0.31, top + 0.066, bz));
  for (const dz of [-0.07, 0.07]) bed.add(mesh(new THREE.BoxGeometry(0.055, 0.022, 0.12), look.mat(L.pillow), [WALL + 0.045, top + 0.076, bz + dz]));
  bed.add(block(look, 0.016, 0.16, 0.33, L.sofaShade, WALL + 0.008, top, bz));
  add(bed);
  for (const z of [bz - 0.2, bz + 0.2]) add(block(look, 0.07, 0.055, 0.07, L.bedFrame, WALL + 0.04, top, z));
  // The bookshelf along the back wall upstairs: low and deep, three levels,
  // with a model ship on top.
  const { x0: shelfX0, x1: shelfX1, depth: shelfD } = BOOKSHELF;
  const shelfZ = WALL + shelfD / 2;
  for (let k = 0; k < 3; k++) {
    const y = top + 0.012 + k * 0.08;
    add(block(look, shelfX1 - shelfX0, 0.008, shelfD, L.shelf, (shelfX0 + shelfX1) / 2, y, shelfZ));
    if (k < 2) add(books(look, rnd, shelfX0 + 0.01, shelfX1 - 0.01, y + 0.008, shelfZ - 0.01, 0.06));
  }
  for (const x of [shelfX0, shelfX1]) add(block(look, 0.008, BOOKSHELF.top - top, shelfD, L.shelf, x, top, shelfZ));
  add(block(look, shelfX1 - shelfX0, BOOKSHELF.top - top, 0.004, L.shelf, (shelfX0 + shelfX1) / 2, top, WALL + 0.002));
  add(ship(look, -0.27, BOOKSHELF.top, shelfZ));
  // A green rug beside the bed.
  const mezzRug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.003, 0.24), look.mat(L.throw, { roughness: 1 }));
  mezzRug.position.set(-0.02, top + 0.0015, bz);
  mezzRug.receiveShadow = true;
  add(mezzRug);
  // Between the bed and the bookshelf, a bean bag on a round rug.
  const nook = new THREE.Vector3(-0.25, top, -0.255);
  const roundRug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.003, 16), look.mat(L.throw, { roughness: 1 }));
  roundRug.position.set(nook.x, top + 0.0015, nook.z);
  roundRug.receiveShadow = true;
  add(roundRug);
  add(beanBag(look, nook.x, top + 0.003, nook.z));

  // ---------- pictures ----------
  // A large one high on the back wall above the stairs, a small one over the sofa.
  add(picture(look, [0.2, 0.25, WALL + 0.004], 0.19, 0.13, 0, 3));
  add(picture(look, [0.17, FLOOR + 0.2, WALL + 0.004], 0.12, 0.075, 0, 21));
  add(picture(look, [WALL + 0.004, top + 0.24, bz], 0.15, 0.09, Math.PI / 2, 8));
  add(picture(look, [-0.24, FLOOR + 0.34, WALL + 0.004], 0.07, 0.05, 0, 13));

  return g;
}

/** A big white bean bag, slumped low at the front and high at the back as if sat in, with a yellow pillow in its hollow. */
function beanBag(look: Look, x: number, y: number, z: number) {
  const rnd = seeded(57);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Flat underneath, a dip where one sits, the back rising behind it.
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.15;
    // The back rises and leans back a little; the front sinks into a hollow.
    const back = Math.max(0, -v.z) * Math.max(0, v.y + 0.2);
    v.y += 0.9 * back;
    v.z -= 0.25 * back;
    const seat = Math.exp(-((v.x * v.x) / 0.3 + ((v.z - 0.3) ** 2) / 0.25));
    v.y -= 0.75 * seat * Math.max(0, v.y + 0.2);
    v.multiplyScalar(1 + rnd(-0.04, 0.04));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  // Its hollow turned between the bookshelf and the top of the stairs.
  const size = new THREE.Vector3(0.08, 0.058, 0.076);
  const bag = new THREE.Group();
  bag.add(mesh(g, look.mat(L.beanBag, { roughness: 0.95 }), [0, 0.2 * size.y, 0], [size.x, size.y, size.z]));
  // The pillow, leaning back into the hollow.
  bag.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.014), look.mat(L.beanPillow, { roughness: 0.9 }), [0, 0.2 * size.y + 0.03, 0.005], 1, [-0.75, 0.15, 0.05]));
  bag.position.set(x, y, z);
  bag.rotation.y = Math.atan2(0.57, -0.82);
  return bag;
}

/** A model sailing ship on a little stand: dark hull, three masts, pale sails. */
function ship(look: Look, x: number, y: number, z: number) {
  const g = new THREE.Group();
  const wood = look.mat(L.frame);
  const deck = look.mat(L.bedFrame);
  const sail = look.mat(L.pillow, { side: THREE.DoubleSide });
  // The stand.
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.003, 0.012), deck, [0, 0.0015, 0]));
  for (const dx of [-0.015, 0.015]) g.add(mesh(new THREE.BoxGeometry(0.003, 0.01, 0.003), deck, [dx, 0.008, 0]));
  // The hull, narrowing to a pointed bow.
  const hull = new THREE.Shape();
  hull.moveTo(-0.035, 0.0);
  hull.lineTo(0.025, 0.0);
  hull.quadraticCurveTo(0.042, 0.004, 0.048, 0.016);
  hull.lineTo(-0.038, 0.016);
  hull.lineTo(-0.035, 0.0);
  const body = new THREE.ExtrudeGeometry(hull, { depth: 0.014, bevelEnabled: false });
  body.translate(0, 0, -0.007);
  g.add(mesh(body, wood, [0, 0.012, 0]));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.002, 0.012), deck, [0.004, 0.029, 0]));
  // Masts and square sails, tallest in the middle.
  for (const [mx, h] of [[-0.022, 0.05], [0.004, 0.062], [0.028, 0.045]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, h, 4), wood, [mx, 0.03 + h / 2, 0]));
    for (const [sy, sw] of [[0.42, 1.0], [0.72, 0.8]] as const) {
      const s = mesh(new THREE.PlaneGeometry(0.022 * sw, h * 0.26), sail, [mx, 0.03 + h * sy, 0.001]);
      s.rotation.y = Math.PI / 2 - 0.35;
      s.castShadow = false;
      g.add(s);
    }
  }
  // A jib at the bow and a little flag at the top.
  const jib = new THREE.BufferGeometry();
  jib.setAttribute('position', new THREE.Float32BufferAttribute([0.028, 0.075, 0, 0.028, 0.035, 0, 0.06, 0.033, 0], 3));
  jib.computeVertexNormals();
  g.add(mesh(jib, sail));
  g.add(mesh(new THREE.PlaneGeometry(0.008, 0.005), look.mat(L.cushion[2], { side: THREE.DoubleSide }), [0.008, 0.094, 0]));
  g.position.set(x, y, z);
  g.rotation.y = 0.3;
  return g;
}

/** A row of books standing on a shelf, a few leaning, with gaps now and then. */
function books(look: Look, rnd: ReturnType<typeof seeded>, x0: number, x1: number, y: number, z: number, maxH: number) {
  const g = new THREE.Group();
  let x = x0;
  while (x < x1 - 0.012) {
    if (rnd() < 0.12) {
      x += rnd(0.015, 0.035);
      continue;
    }
    const w = rnd(0.006, 0.011);
    const h = maxH * rnd(0.55, 0.85);
    const lean = rnd() < 0.08 ? 0.25 : 0;
    const b = mesh(new THREE.BoxGeometry(w, h, 0.032), look.mat(L.books[Math.floor(rnd() * L.books.length)]), [x + w / 2, y + h / 2, z], 1, [0, 0, lean]);
    b.castShadow = false;
    g.add(b);
    x += w + 0.0008;
  }
  return g;
}

/** A framed picture: a low-poly landscape of hills under a warm sky. */
function picture(look: Look, at: V3, w: number, h: number, yaw: number, seed: number) {
  const rnd = seeded(seed);
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.006), look.mat(L.frame)));
  const canvas = new THREE.PlaneGeometry(w - 0.014, h - 0.014, 6, 4).toNonIndexed();
  paintFaces(canvas, (c) => {
    const ridge = (h / 2) * (-0.35 + 0.35 * Math.sin(c.x * 40 + seed) + rnd(-0.1, 0.1));
    if (c.y < ridge - h * 0.15) return L.hills[2];
    if (c.y < ridge) return L.hills[Math.floor(rnd() * 2)];
    return L.sky[Math.floor(rnd() * L.sky.length)];
  });
  const art = new THREE.Mesh(canvas, look.mat('#FFFFFF', { vertexColors: true }));
  art.position.z = 0.0035;
  g.add(art);
  g.position.set(...at);
  g.rotation.y = yaw;
  return g;
}
