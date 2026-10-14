import * as THREE from 'three';
import { C, Look, mesh } from './look';

// The hamster's body: a low-poly Syrian hamster facing +z, feet at y = 0.
// It has no behaviour of its own; the brain sets a Pose each step and the
// model turns it into part positions.

export interface Pose {
  /** 0 on all fours, 1 sitting up on the hind legs. */
  sit: number;
  /** Lean forward (reaching down to a bowl, digging). */
  lean: number;
  headPitch: number;
  headYaw: number;
  /** Front paws raised to the mouth. */
  paws: number;
  /** Cheek pouches, 0 empty to 1 stuffed. */
  cheeks: number;
  /** 1 open, 0 closed. */
  eyes: number;
  /** Amount of walk cycle (0 standing, 1 walking). */
  walk: number;
  /** Quick nibbling nods. */
  nibble: number;
  /** Paws rubbing the face. */
  groom: number;
  /** Nose twitching. */
  sniff: number;
  /** Ears pricked up, eyes wide. */
  alert: number;
  /** Legs hanging, as when lifted. */
  dangle: number;
  /** Front paws scraping at the bedding. */
  dig: number;
  /** Holding a seed in the front paws. */
  hold: number;
}

export const restPose = (): Pose => ({
  sit: 0, lean: 0, headPitch: 0, headYaw: 0, paws: 0, cheeks: 0, eyes: 1, walk: 0,
  nibble: 0, groom: 0, sniff: 0, alert: 0, dangle: 0, dig: 0, hold: 0,
});

// The body tilts about a pivot near the haunches when sitting up.
const PIVOT = new THREE.Vector3(0, 0.035, -0.08);
const MOUTH = new THREE.Vector3(0, 0.088, 0.135);

export class HamsterModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  private readonly cheekL: THREE.Mesh;
  private readonly cheekR: THREE.Mesh;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly ears: THREE.Group[] = [];
  private readonly nose: THREE.Mesh;
  private readonly front: THREE.Mesh[] = [];
  private readonly back: THREE.Mesh[] = [];
  private readonly seed: THREE.Mesh;
  private blinkIn = 2;
  private blinking = 0;
  /** Its own materials, so clipping the hamster never clips the cage. */
  private readonly materials: THREE.Material[] = [];

  constructor(look: Look) {
    const own = (m: THREE.Material) => {
      const c = m.clone();
      this.materials.push(c);
      return c;
    };
    const fur = own(look.mat(C.fur));
    const cream = own(look.mat(C.cream));
    const pink = own(look.mat(C.pink));
    const eye = own(look.mat(C.eye, { roughness: 0.3 }));
    const shine = own(look.mat('#FFFFFF', { roughness: 0.3 }));
    const seed = own(look.mat(C.seed));
    const blob = look.blob;
    // Parts of the body are given in root coordinates and shifted by the pivot.
    const onBody = (m: THREE.Mesh) => {
      m.position.sub(PIVOT);
      this.body.add(m);
      return m;
    };

    this.body.position.copy(PIVOT);
    this.root.add(this.body);

    onBody(mesh(blob, fur, [0, 0.085, -0.005], [0.1, 0.085, 0.125]));
    onBody(mesh(blob, cream, [0, 0.068, 0.04], [0.078, 0.068, 0.092]));
    onBody(mesh(blob, pink, [0, 0.06, -0.128], 0.012));

    this.head.position.set(0, 0.115, 0.085).sub(PIVOT);
    this.body.add(this.head);
    this.head.add(
      mesh(blob, fur, [0, 0, 0], [0.075, 0.066, 0.068]),
      mesh(blob, cream, [0, -0.017, 0.03], [0.058, 0.05, 0.05]),
    );
    this.cheekL = mesh(blob, cream, [0.043, -0.022, 0.022], [0.034, 0.03, 0.034]);
    this.cheekR = mesh(blob, cream, [-0.043, -0.022, 0.022], [0.034, 0.03, 0.034]);
    this.head.add(this.cheekL, this.cheekR);

    for (const side of [1, -1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 0.042, 0.052, -0.012);
      ear.rotation.z = -side * 0.35;
      ear.add(
        mesh(look.gem, fur, [0, 0, 0], [0.026, 0.03, 0.012]),
        mesh(look.gem, pink, [0, 0.002, 0.006], [0.016, 0.019, 0.006]),
      );
      this.ears.push(ear);
      this.head.add(ear);

      const e = mesh(blob, eye, [side * 0.032, 0.012, 0.052], 0.012);
      this.eyes.push(e);
      this.head.add(e, mesh(blob, shine, [side * 0.035, 0.018, 0.062], 0.0035));

      const f = onBody(mesh(blob, pink, [side * 0.038, 0.012, 0.085], [0.016, 0.011, 0.02]));
      this.front.push(f);
      const b = mesh(blob, pink, [side * 0.055, 0.011, -0.07], [0.018, 0.011, 0.024]);
      this.back.push(b);
      this.root.add(b);
    }
    this.nose = mesh(blob, pink, [0, -0.005, 0.083], 0.008);
    this.head.add(this.nose);

    this.seed = mesh(look.blob, seed, [0, 0, 0], [0.008, 0.006, 0.016]);
    this.seed.position.copy(MOUTH).sub(PIVOT);
    this.seed.visible = false;
    this.body.add(this.seed);
  }

  /** Hide whatever part of the hamster is behind this plane (or stop). */
  clip(plane: THREE.Plane | null) {
    const planes = plane ? [plane] : [];
    for (const m of this.materials) m.clippingPlanes = planes;
  }

  /** All the meshes, for pointer picking. */
  get parts(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) out.push(o);
    });
    return out;
  }

  apply(p: Pose, walkPhase: number, t: number, dt: number, asleep = false) {
    // Body: sit up about the haunches, lean forward, roll a little in stride.
    const stride = Math.sin(walkPhase);
    this.body.rotation.x = -0.62 * p.sit + 0.28 * p.lean + 0.12 * p.dig;
    this.body.rotation.z = stride * 0.05 * p.walk;
    const breathe = 1 + Math.sin(t * (asleep ? 1.6 : 3.2)) * 0.018;
    this.body.scale.set(1, breathe * (1 + 0.06 * p.dangle), 1);
    this.body.position.y = PIVOT.y + Math.abs(stride) * 0.007 * p.walk;

    // Head: keep looking forward-ish while sitting up; nibble and nod.
    this.head.rotation.x = p.headPitch + 0.4 * p.sit - 0.2 * p.lean + Math.sin(t * 30) * 0.06 * p.nibble;
    this.head.rotation.y = p.headYaw;
    this.head.rotation.z = Math.sin(t * 6) * 0.08 * p.groom;

    const cheek = 1 + 0.75 * p.cheeks;
    this.cheekL.scale.set(0.034 * cheek, 0.03 * (1 + 0.4 * p.cheeks), 0.034 * cheek);
    this.cheekR.scale.copy(this.cheekL.scale);
    this.nose.scale.setScalar(0.008 * (1 + Math.sin(t * 26) * 0.18 * p.sniff));
    for (const ear of this.ears) ear.scale.set(1, 1 + 0.25 * p.alert, 1);

    // Blink now and then.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinking = 0.14;
      this.blinkIn = 2 + Math.random() * 4;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const open = Math.min(p.eyes, this.blinking > 0 ? 0.1 : 1) * (1 + 0.25 * p.alert);
    for (const eye of this.eyes) eye.scale.set(0.012, 0.012 * Math.max(0.12, open), 0.012);

    // Front paws: on the ground (walking, digging) or up at the mouth.
    this.front.forEach((paw, i) => {
      const side = i === 0 ? 1 : -1;
      const phase = walkPhase + (i === 0 ? 0 : Math.PI);
      const ground = new THREE.Vector3(side * 0.038, 0.012 - 0.015 * p.dangle, 0.085 + Math.sin(phase) * 0.022 * p.walk);
      ground.z += Math.sin(t * 22 + i * Math.PI) * 0.02 * p.dig;
      const up = new THREE.Vector3(side * 0.022, MOUTH.y, MOUTH.z - 0.012);
      up.x += Math.sin(t * 11 + i) * 0.012 * p.groom;
      up.y += Math.cos(t * 11 + i) * 0.014 * p.groom;
      paw.position.lerpVectors(ground, up, Math.max(p.paws, p.groom)).sub(PIVOT);
    });
    this.back.forEach((paw, i) => {
      const side = i === 0 ? 1 : -1;
      const phase = walkPhase + (i === 0 ? Math.PI : 0);
      paw.position.set(side * (0.055 + 0.01 * p.dangle), 0.011 - 0.03 * p.dangle, -0.07 + Math.sin(phase) * 0.02 * p.walk);
    });
    this.seed.visible = p.hold > 0.5;
  }
}
