import * as THREE from 'three';
import { mesh, pick, seeded, type Look } from '../kit';
import { L } from './look';
import { BOOKSHELF } from './furniture';
import { FLOOR, MEZZ, WALL } from './room';

// Green things: potted plants round the room, and pothos trailing over the
// mezzanine's edge in long strands that sway a little, as if a window
// somewhere were open.

/** A leaf: a flat, pointed diamond, a little cupped, its stalk at the origin. */
function leafGeometry() {
  const g = new THREE.BufferGeometry();
  const v = [
    0, 0, 0, 0.5, 0.08, 0.35, 1, 0, 0,
    0, 0, 0, 1, 0, 0, 0.5, 0.08, -0.35,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

interface Strand {
  group: THREE.Group;
  phase: number;
  length: number;
}

export class Plants {
  readonly group = new THREE.Group();
  private readonly strands: Strand[] = [];
  private readonly leaf = leafGeometry();

  constructor(look: Look) {
    const rnd = seeded(31);
    const leafMats = L.leaf.map((c) => look.mat(c, { side: THREE.DoubleSide, roughness: 0.75 }));

    // Potted plants: a pot, and leaves fanning up and out from its middle.
    const potted = (x: number, y: number, z: number, size: number, dark = false) => {
      const g = new THREE.Group();
      const potH = 0.05 * size;
      g.add(mesh(new THREE.CylinderGeometry(0.03 * size, 0.022 * size, potH, 8), look.mat(dark ? L.potDark : L.pot), [0, potH / 2, 0]));
      const count = Math.round(14 * size + 6);
      for (let i = 0; i < count; i++) {
        const a = rnd(0, Math.PI * 2);
        const tilt = rnd(0.25, 1.1);
        const l = mesh(this.leaf, pick(leafMats), [Math.cos(a) * 0.006, potH + rnd(0.0, 0.05) * size, Math.sin(a) * 0.006], 0.05 * size * rnd(0.7, 1.2));
        l.rotation.set(0, -a, Math.PI / 2 - tilt, 'YZX');
        l.castShadow = true;
        g.add(l);
      }
      g.position.set(x, y, z);
      g.rotation.y = rnd(0, 6);
      this.group.add(g);
    };
    potted(0.44, FLOOR, 0.07, 1.2, true); // just past the foot of the stairs
    potted(0.43, FLOOR, 0.3, 1.3); // in the front corner
    potted(WALL + 0.055, FLOOR + 0.9 * 0.185, 0.24, 0.45); // herbs on the counter
    potted(WALL + 0.06, FLOOR, WALL + 0.06, 1.9, true); // tall, in the back corner the kitchen left
    potted(-0.085, FLOOR + 0.75 * 0.185, WALL + 0.03, 0.4); // on the desk
    potted(-0.385, BOOKSHELF.top, WALL + BOOKSHELF.depth / 2, 0.5); // on top of the bookshelf
    potted(WALL + 0.04, MEZZ.top + 0.055, 0.26, 0.55, true); // on the far nightstand

    // Pothos trailing over the edge of the mezzanine.
    const m = MEZZ;
    const hang = (x: number, z: number, length: number) => {
      const group = new THREE.Group();
      group.position.set(x, m.top - 0.002, z);
      const n = Math.round(length / 0.014);
      for (let i = 0; i < n; i++) {
        const y = -i * 0.014;
        const side = i % 2 ? 1 : -1;
        const l = mesh(this.leaf, pick(leafMats), [0, y, 0], 0.022 * rnd(0.8, 1.2) * (1 - 0.3 * (i / n)));
        l.rotation.set(rnd(-0.3, 0.3), side * rnd(0.6, 1.4) + rnd(0, Math.PI), -0.6 - rnd(0, 0.5), 'YXZ');
        group.add(l);
      }
      // A pot at the top, sitting on the deck behind the glass.
      this.group.add(group);
      this.strands.push({ group, phase: rnd(0, Math.PI * 2), length });
    };
    // Along the front edge, from a long planter on the deck.
    this.group.add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.025), look.mat(L.potDark), [m.x0 + 0.2, m.top + 0.015, m.z1 - 0.025]));
    for (const [x, len] of [[m.x0 + 0.12, 0.2], [m.x0 + 0.17, 0.27], [m.x0 + 0.22, 0.15], [m.x0 + 0.27, 0.23]] as const) hang(x, m.z1 + 0.004, len);
    // And down the side, beside the stairs.
    this.group.add(mesh(new THREE.BoxGeometry(0.025, 0.03, 0.12), look.mat(L.potDark), [m.x1 - 0.025, m.top + 0.015, -0.18]));
    for (const [z, len] of [[-0.22, 0.18], [-0.17, 0.26], [-0.13, 0.14]] as const) hang(m.x1 + 0.004, z, len);
    // Leaves at the planters' tops.
    for (let i = 0; i < 26; i++) {
      const front = i < 16;
      const x = front ? m.x0 + 0.11 + rnd(0, 0.18) : m.x1 - 0.025 + rnd(-0.01, 0.01);
      const z = front ? m.z1 - 0.025 + rnd(-0.01, 0.01) : -0.24 + rnd(0, 0.12);
      const l = mesh(this.leaf, pick(leafMats), [x, m.top + 0.03 + rnd(0, 0.015), z], 0.025 * rnd(0.8, 1.2));
      l.rotation.set(0, rnd(0, Math.PI * 2), rnd(-0.6, 0.2), 'YZX');
      this.group.add(l);
    }
  }

  update(t: number) {
    // The strands sway from where they hang, longer ones a little more slowly.
    for (const s of this.strands) {
      const slow = 0.6 / Math.sqrt(s.length / 0.2);
      s.group.rotation.x = 0.06 * Math.sin(t * slow + s.phase);
      s.group.rotation.z = 0.05 * Math.sin(t * slow * 0.8 + s.phase * 1.7);
    }
  }

  dispose() {
    this.leaf.dispose();
  }
}
