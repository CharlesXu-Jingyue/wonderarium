import * as THREE from 'three';
import { mesh, paintFaces, seeded, type Look } from '../kit';
import { L, M } from './look';

// The shell of the loft: a plank floor on a slab cut away at the glass, two
// cream walls at the back, a mezzanine bedroom in the back-left with a glass
// railing, and floating stairs that turn in the back-right corner: up from
// the floor beside the right-hand glass to a landing, then along the back
// wall to the mezzanine, high enough that the sofa tucks in beneath them.

/** The top of the floor. */
export const FLOOR = -0.44;
/** Half-width of the floor slab, a hair inside the glass. */
const EDGE = 0.49;
/** The inner faces of the two walls (the left one at x, the back one at z). */
export const WALL = -0.465;
/** The mezzanine: over the back-left of the room, at about two and a half metres. */
export const MEZZ = { x0: WALL, x1: 0.06, z0: WALL, z1: 0.3, top: FLOOR + 2.6 * M, thick: 0.045 };
/**
 * The stairs, an L: the lower flight and the landing stand in a band along
 * the right-hand glass (x0 to x1), the landing and the upper flight in a
 * band along the back wall (z0 to z1).
 */
export const STAIRS = { x0: 0.355, x1: 0.485, z0: WALL, z1: WALL + 0.7 * M };
const STEPS = 13;
/** Risers up to the landing; the rest climb the back wall. */
const LANDING = 6;
export const RISE = (MEZZ.top - FLOOR) / STEPS;
export const LANDING_TOP = FLOOR + LANDING * RISE;
const RUN_LOW = 0.045;
export const RUN_UP = (STAIRS.x0 - MEZZ.x1) / (STEPS - LANDING - 1);

/** The upper flight's floating treads: each one's middle along the back wall, and its top. */
export function treads() {
  const out: { x: number; top: number }[] = [];
  for (let j = LANDING + 1; j < STEPS; j++) out.push({ x: STAIRS.x0 - (j - LANDING - 0.5) * RUN_UP, top: FLOOR + j * RISE });
  return out;
}

/** The lower flight's solid steps, coming toward the front of the room: each one's span in z, and its top. */
export function lowerSteps() {
  const out: { z0: number; z1: number; top: number }[] = [];
  for (let k = 1; k < LANDING; k++) {
    const z0 = STAIRS.z1 + (LANDING - 1 - k) * RUN_LOW;
    out.push({ z0, z1: z0 + RUN_LOW, top: FLOOR + k * RISE });
  }
  return out;
}

export function buildRoom(look: Look) {
  const group = new THREE.Group();
  const rnd = seeded(5);

  // The floor: a slab whose top is laid with planks, staggered at the ends.
  group.add(slab(look, rnd));

  // Two walls, with a skirting board along their feet. They stand on the
  // floor rather than reaching down into the slab, where their faces would
  // share planes with its sides and flicker.
  const wallTop = 0.475;
  const height = wallTop - FLOOR;
  const wallMat = look.mat(L.wall, { roughness: 0.95 });
  group.add(mesh(new THREE.BoxGeometry(WALL + 0.49, height, 0.98), wallMat, [(WALL - 0.49) / 2, wallTop - height / 2, 0]));
  group.add(mesh(new THREE.BoxGeometry(0.49 - WALL, height, WALL + 0.49), wallMat, [(0.49 + WALL) / 2, wallTop - height / 2, (WALL - 0.49) / 2]));
  const skirt = look.mat(L.skirting);
  group.add(mesh(new THREE.BoxGeometry(0.006, 0.02, 0.49 - WALL - 0.002), skirt, [WALL + 0.003, FLOOR + 0.01, (0.49 + WALL) / 2]));
  group.add(mesh(new THREE.BoxGeometry(0.49 - WALL - 0.002, 0.02, 0.006), skirt, [(0.49 + WALL) / 2, FLOOR + 0.01, WALL + 0.003]));

  // The mezzanine: planked on top, plaster underneath, a wooden beam for its edge.
  const m = MEZZ;
  const deck = new THREE.BoxGeometry(m.x1 - m.x0, m.thick, m.z1 - m.z0, 12, 1, 20).toNonIndexed();
  deck.translate((m.x0 + m.x1) / 2, m.top - m.thick / 2, (m.z0 + m.z1) / 2);
  paintFaces(deck, (c, n) => {
    if (n.y > 0.5) return plankColor(c.x, c.z, rnd);
    if (n.y < -0.5) return L.underside;
    return L.beam;
  });
  deck.computeVertexNormals();
  group.add(mesh(deck, look.mat('#FFFFFF', { vertexColors: true })));
  // A slim post holds up its open corner.
  group.add(mesh(new THREE.BoxGeometry(0.018, m.top - m.thick - FLOOR, 0.018), look.mat(L.beam), [m.x1 - 0.012, (FLOOR + m.top - m.thick) / 2, m.z1 - 0.012]));

  // The stairs: floating treads all the way, the lower flight beside the
  // glass, the landing a thicker slab fixed into the back wall in the
  // corner, and the upper flight fixed into the back wall, with room for
  // the sofa beneath.
  const treadMat = look.mat(L.tread);
  const st = STAIRS;
  for (const step of lowerSteps()) {
    group.add(mesh(new THREE.BoxGeometry(st.x1 - st.x0, 0.014, step.z1 - step.z0 + 0.004), treadMat, [(st.x0 + st.x1) / 2, step.top - 0.007, (step.z0 + step.z1) / 2 + 0.002]));
  }
  group.add(mesh(new THREE.BoxGeometry(st.x1 - st.x0 + 0.004, 0.024, st.z1 - st.z0 + 0.004), treadMat, [(st.x0 + st.x1) / 2 - 0.002, LANDING_TOP - 0.012, (st.z0 + st.z1) / 2 + 0.002]));
  for (const t of treads()) {
    group.add(mesh(new THREE.BoxGeometry(RUN_UP * 1.04, 0.014, st.z1 - st.z0), treadMat, [t.x, t.top - 0.007, (st.z0 + st.z1) / 2]));
  }

  // Glass railings with a dark top rail: round the mezzanine's open edges,
  // and handrails up both flights.
  const glass = look.mat(L.railGlass, { opacity: 0.22, roughness: 0.1 });
  const metal = look.mat(L.metal, { roughness: 0.5 });
  const railH = 0.95 * M;
  const rail = (from: THREE.Vector3, to: THREE.Vector3) => {
    const along = to.clone().sub(from);
    const length = along.length();
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const yaw = Math.atan2(-along.z, along.x);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(length, railH, 0.003), glass);
    pane.position.set(mid.x, mid.y + railH / 2, mid.z);
    pane.rotation.y = yaw;
    pane.renderOrder = 10;
    const top = mesh(new THREE.BoxGeometry(length, 0.006, 0.008), metal, [mid.x, mid.y + railH, mid.z], 1, [0, yaw, 0]);
    group.add(pane, top);
  };
  rail(new THREE.Vector3(m.x1, m.top, st.z1), new THREE.Vector3(m.x1, m.top, m.z1));
  rail(new THREE.Vector3(m.x1, m.top, m.z1), new THREE.Vector3(m.x0 + 0.002, m.top, m.z1));
  // Slim dark handrails on posts, following each flight's pitch.
  const handrail = (from: THREE.Vector3, to: THREE.Vector3, posts: THREE.Vector3[]) => {
    const pitch = to.clone().sub(from);
    const r = mesh(new THREE.CylinderGeometry(0.003, 0.003, pitch.length(), 5), metal, from.clone().add(to).multiplyScalar(0.5).toArray() as [number, number, number]);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pitch.normalize());
    group.add(r);
    for (const p of posts) group.add(mesh(new THREE.CylinderGeometry(0.0022, 0.0022, railH, 4), metal, [p.x, p.y + railH / 2, p.z]));
  };
  const up = treads();
  handrail(
    new THREE.Vector3(st.x0, LANDING_TOP + railH, st.z1 - 0.006),
    new THREE.Vector3(m.x1 + RUN_UP * 0.5, m.top + railH, st.z1 - 0.006),
    up.filter((_, i) => i % 2 === 0).map((t) => new THREE.Vector3(t.x, t.top, st.z1 - 0.006)),
  );
  const low = lowerSteps();
  handrail(
    new THREE.Vector3(st.x0 + 0.006, low[0].top + railH, low[0].z1 - 0.01),
    new THREE.Vector3(st.x0 + 0.006, LANDING_TOP + railH, st.z1),
    low.filter((_, i) => i % 2 === 0).map((s) => new THREE.Vector3(st.x0 + 0.006, s.top, (s.z0 + s.z1) / 2)),
  );

  return group;
}

/** A plank's colour at (x, z): boards run along x, a different length on each row. */
function plankColor(x: number, z: number, rnd: () => number) {
  const row = Math.floor((z + 0.5) / 0.034);
  const offset = ((row * 0.37) % 1) * 0.3;
  const board = Math.floor((x + 0.5 + offset) / 0.26);
  const k = (row * 7 + board * 3) % L.plank.length;
  return rnd() < 0.08 ? L.plank[(k + 1) % L.plank.length] : L.plank[k];
}

function slab(look: Look, rnd: () => number) {
  // Two rows down the sides, so the lighter and darker bands each fill a row.
  const g = new THREE.BoxGeometry(EDGE * 2, 0.05, EDGE * 2, 28, 2, 28).toNonIndexed();
  g.translate(0, FLOOR - 0.025, 0);
  paintFaces(g, (c, n) => {
    if (n.y > 0.5) return plankColor(c.x, c.z, rnd);
    return c.y > FLOOR - 0.025 ? L.slabSide : L.slabDeep;
  });
  g.computeVertexNormals();
  // Two-sided, so where the glass's rounded corners trim it, it reads solid.
  const m = mesh(g, look.mat('#FFFFFF', { vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = false;
  return m;
}
