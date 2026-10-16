import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mesh, type Look } from '../kit';
import { L } from './look';
import { BOOKSHELF, SHELF, SOFA } from './furniture';
import { FLOOR, LANDING_TOP, lowerSteps, MEZZ, RUN_UP, STAIRS, treads, WALL } from './room';

// The loft's own light, most of it hidden: LED strips under the mezzanine's
// edge, under each stair tread, beneath the sofa and the bed and under the
// kitchen shelf, so what you see is the glow they throw on the wall, the
// floor or the counter rather than the strip itself. Then a desk lamp and a
// monitor, and a globe lamp by the bed.
//
// Each fixture is a little bundle: real lights that light the furniture
// round it, glowing surfaces where a bulb or a strip shows, and soft
// painted glows where its light falls. It keeps its own hours, and a click
// switches it until those hours next say otherwise.

const GLOW = new THREE.Color(L.glow);

export class Fixture {
  /** How far on it is now, 0 to 1; it fades rather than snapping. */
  level = 0;
  /** Meshes a click on which switches this fixture. */
  readonly handles: THREE.Object3D[] = [];
  private readonly lights: { light: THREE.Light; full: number }[] = [];
  private readonly glows: { material: THREE.MeshStandardMaterial; full: number }[] = [];
  private readonly washes: { material: THREE.ShaderMaterial; full: number }[] = [];
  private override: boolean | null = null;
  private lastWanted: boolean | null = null;
  private readonly delay = Math.random() * 1.5;
  private since = 0;

  constructor(
    readonly name: string,
    /** Whether it would be on at this hour and light. */
    private readonly hours: (hours: number, daylight: number) => boolean,
  ) {}

  light(light: THREE.Light, full: number) {
    this.lights.push({ light, full });
    light.intensity = 0;
    return light;
  }

  glow(material: THREE.MeshStandardMaterial, full: number) {
    this.glows.push({ material, full });
    return material;
  }

  wash(material: THREE.ShaderMaterial, full: number) {
    this.washes.push({ material, full });
    return material;
  }

  /** An invisible box, easier to click than a thin strip, that switches this fixture. */
  hitbox(w: number, h: number, d: number, at: THREE.Vector3) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    box.position.copy(at);
    box.visible = false;
    this.handles.push(box);
    return box;
  }

  /** A click: switch it, until its own hours next change their mind. */
  toggle() {
    this.override = !(this.override ?? this.lastWanted ?? false);
  }

  update(dt: number, hours: number, daylight: number) {
    const wanted = this.hours(hours, daylight);
    if (wanted !== this.lastWanted) {
      if (this.lastWanted !== null) this.override = null;
      this.lastWanted = wanted;
      this.since = 0;
    }
    this.since += dt;
    const on = this.override ?? wanted;
    // Each comes on in its own moment, and every one eases in and out.
    const target = on && (this.override !== null || this.since > this.delay) ? 1 : 0;
    this.level += (target - this.level) * Math.min(1, dt * 1.6);
    if (dt === 0) this.level = target;
    const k = this.level * this.level * (3 - 2 * this.level);
    for (const { light, full } of this.lights) light.intensity = full * k;
    for (const { material, full } of this.glows) material.emissiveIntensity = full * k;
    for (const { material, full } of this.washes) material.uniforms.uStrength.value = full * k;
  }
}

/**
 * A soft glow painted on a surface where hidden light falls. 'wash' is
 * brightest along its top edge and fades downward, soft at the sides, as
 * light from a strip spills down a wall. 'pool' is brightest toward its rim
 * and soft both ways, as light escaping from under a sofa or a bed. 'spot'
 * is a round glow, brightest in the middle, as a lamp throws on a wall.
 */
function washMaterial(kind: 'wash' | 'pool' | 'spot', color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uColor: { value: color.clone() } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        ${{
          wash: `float across = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
                 float a = across * pow(vUv.y, 2.2);`,
          pool: `vec2 p = abs(vUv - 0.5) * 2.0;
                 float d = max(p.x, p.y);
                 float a = smoothstep(1.0, 0.72, d) * (0.35 + 0.65 * smoothstep(0.3, 0.8, d));`,
          spot: `float d = length((vUv - 0.5) * 2.0);
                 float a = pow(max(0.0, 1.0 - d), 2.0);`,
        }[kind]}
        gl_FragColor = vec4(uColor * a * uStrength, 0.0);
      }
    `,
  });
}

/** A painted glow: `w` by `h`, its middle at `at`, facing `normal`. */
function washMesh(material: THREE.ShaderMaterial, w: number, h: number, at: THREE.Vector3, normal: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.copy(at);
  m.lookAt(at.clone().add(normal));
  m.renderOrder = 15;
  return m;
}

/** A rectangle of light, `w` long, at `at`, shining toward `toward`. */
function strip(w: number, h: number, at: THREE.Vector3, toward: THREE.Vector3, color = GLOW) {
  const light = new THREE.RectAreaLight(color, 0, w, h);
  light.position.copy(at);
  light.lookAt(toward);
  return light;
}

export function buildLights(look: Look) {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  const fixtures: Fixture[] = [];
  const evening = (_h: number, daylight: number) => daylight < 0.55;
  const m = MEZZ;
  const under = m.top - m.thick;

  // ---------- under the mezzanine's edge ----------
  {
    const f = new Fixture('mezzanine', evening);
    const mat = f.glow(new THREE.MeshStandardMaterial({ color: L.shade, emissive: GLOW, emissiveIntensity: 0 }), 3);
    const lenZ = m.z1 - STAIRS.z1;
    const lenX = m.x1 - m.x0;
    const sz = mesh(new THREE.BoxGeometry(0.006, 0.003, lenZ), mat, [m.x1 - 0.006, under - 0.0015, (m.z1 + STAIRS.z1) / 2]);
    const sx = mesh(new THREE.BoxGeometry(lenX, 0.003, 0.006), mat, [(m.x0 + m.x1) / 2, under - 0.0015, m.z1 - 0.006]);
    sz.castShadow = sx.castShadow = false;
    group.add(sz, sx);
    group.add(f.light(strip(lenZ, 0.012, new THREE.Vector3(m.x1 - 0.006, under - 0.004, (m.z1 + STAIRS.z1) / 2), new THREE.Vector3(m.x1 - 0.03, FLOOR, (m.z1 + STAIRS.z1) / 2)), 16));
    group.add(f.light(strip(lenX, 0.012, new THREE.Vector3((m.x0 + m.x1) / 2, under - 0.004, m.z1 - 0.006), new THREE.Vector3((m.x0 + m.x1) / 2, FLOOR, m.z1 - 0.03)), 16));
    group.add(f.hitbox(0.04, 0.05, lenZ, new THREE.Vector3(m.x1, under, (m.z1 + STAIRS.z1) / 2)));
    group.add(f.hitbox(lenX, 0.05, 0.04, new THREE.Vector3((m.x0 + m.x1) / 2, under, m.z1)));
    fixtures.push(f);
  }

  // ---------- under the kitchen shelf ----------
  {
    const f = new Fixture('kitchen', evening);
    const z0 = SHELF.z0 + 0.01;
    const z1 = SHELF.z1 - 0.01;
    const mat = f.glow(new THREE.MeshStandardMaterial({ color: L.shade, emissive: GLOW, emissiveIntensity: 0 }), 2.2);
    const s = mesh(new THREE.BoxGeometry(0.004, 0.003, z1 - z0 - 0.01), mat, [WALL + 0.05, SHELF.y - 0.0015, (z0 + z1) / 2]);
    s.castShadow = false;
    group.add(s);
    group.add(f.light(strip(z1 - z0, 0.012, new THREE.Vector3(WALL + 0.035, SHELF.y - 0.005, (z0 + z1) / 2), new THREE.Vector3(WALL + 0.06, FLOOR, (z0 + z1) / 2)), 18));
    const wash = f.wash(washMaterial('wash', GLOW), 0.9);
    const counterTop = FLOOR + 0.9 * 0.185;
    const washH = SHELF.y - 0.006 - counterTop;
    group.add(washMesh(wash, z1 - z0, washH, new THREE.Vector3(WALL + 0.0015, counterTop + washH / 2, (z0 + z1) / 2), new THREE.Vector3(1, 0, 0)));
    group.add(f.hitbox(0.08, 0.04, z1 - z0, new THREE.Vector3(WALL + 0.03, SHELF.y, (z0 + z1) / 2)));
    fixtures.push(f);
  }

  // ---------- under each stair tread ----------
  {
    const f = new Fixture('stairs', evening);
    const st = STAIRS;
    const wash = f.wash(washMaterial('wash', GLOW), 1.7);
    // The strip itself shows only as a bright line along each tread's edge.
    const line = f.glow(new THREE.MeshStandardMaterial({ color: L.shade, emissive: GLOW, emissiveIntensity: 0 }), 3);
    const edge = (w: number, d: number, at: [number, number, number]) => {
      const e = mesh(new THREE.BoxGeometry(w, 0.002, d), line, at);
      e.castShadow = false;
      group.add(e);
    };
    // The upper flight: a wash down the back wall beneath each floating tread.
    for (const t of treads()) {
      group.add(washMesh(wash, RUN_UP * 1.1, 0.1, new THREE.Vector3(t.x, t.top - 0.014 - 0.05, WALL + 0.0015), new THREE.Vector3(0, 0, 1)));
      edge(RUN_UP * 0.96, 0.004, [t.x, t.top - 0.0145, st.z1 - 0.004]);
    }
    // The landing and the lower flight: a line under each nosing, a little
    // light on the tread below, a soft pool on the floor beneath each one
    // (nothing fills them in), and a wash down the wall under the landing.
    edge(0.004, st.z1 - st.z0, [st.x0 - 0.002, LANDING_TOP - 0.0245, (st.z0 + st.z1) / 2]);
    group.add(washMesh(wash, st.x1 - st.x0, 0.12, new THREE.Vector3((st.x0 + st.x1) / 2, LANDING_TOP - 0.024 - 0.06, WALL + 0.0015), new THREE.Vector3(0, 0, 1)));
    const spill = f.wash(washMaterial('wash', GLOW), 0.9);
    const floorGlow = f.wash(washMaterial('spot', GLOW), 0.35);
    const steps = lowerSteps();
    steps.forEach((step, i) => {
      edge(st.x1 - st.x0 - 0.004, 0.004, [(st.x0 + st.x1) / 2, step.top - 0.0145, step.z1 + 0.002]);
      const below = steps[i - 1];
      const at = below ? below.top + 0.0008 : FLOOR + 0.0008;
      group.add(washMesh(spill, st.x1 - st.x0, 0.04, new THREE.Vector3((st.x0 + st.x1) / 2, at, step.z1 + 0.02), new THREE.Vector3(0, 1, 0)));
      group.add(washMesh(floorGlow, st.x1 - st.x0 + 0.03, 0.09, new THREE.Vector3((st.x0 + st.x1) / 2, FLOOR + 0.0006, (step.z0 + step.z1) / 2), new THREE.Vector3(0, 1, 0)));
    });
    // Real light down from under the upper flight onto the sofa tucked beneath it.
    const sx = (SOFA.x0 + SOFA.x1) / 2;
    group.add(f.light(strip(SOFA.x1 - SOFA.x0, 0.03, new THREE.Vector3(sx, FLOOR + 0.25, WALL + 0.06), new THREE.Vector3(sx, FLOOR, WALL + 0.12)), 5));
    // Either flight switches them.
    const upLen = st.x0 - m.x1;
    group.add(f.hitbox(upLen, 0.06, st.z1 - st.z0, new THREE.Vector3(m.x1 + upLen / 2, (LANDING_TOP + m.top) / 2, (st.z0 + st.z1) / 2)));
    const lowEnd = steps[0].z1;
    group.add(f.hitbox(st.x1 - st.x0, LANDING_TOP - FLOOR, lowEnd - st.z0, new THREE.Vector3((st.x0 + st.x1) / 2, (FLOOR + LANDING_TOP) / 2, (st.z0 + lowEnd) / 2)));
    fixtures.push(f);
  }

  // ---------- beneath the sofa ----------
  {
    const f = new Fixture('sofa', evening);
    const wash = f.wash(washMaterial('pool', GLOW), 1.2);
    const sx = (SOFA.x0 + SOFA.x1) / 2;
    const sz = (SOFA.z0 + SOFA.z1) / 2;
    group.add(washMesh(wash, SOFA.x1 - SOFA.x0 + 0.05, SOFA.z1 - SOFA.z0 + 0.06, new THREE.Vector3(sx, FLOOR + 0.0008, sz + 0.01), new THREE.Vector3(0, 1, 0)));
    group.add(f.hitbox(SOFA.x1 - SOFA.x0, 0.15, SOFA.z1 - SOFA.z0, new THREE.Vector3(sx, FLOOR + 0.075, sz)));
    fixtures.push(f);
  }

  // ---------- beneath the bed ----------
  {
    const f = new Fixture('bed', evening);
    const wash = f.wash(washMaterial('pool', GLOW), 1.1);
    group.add(washMesh(wash, 0.45, 0.37, new THREE.Vector3(WALL + 0.2, m.top + 0.0008, 0.06), new THREE.Vector3(0, 1, 0)));
    group.add(f.hitbox(0.37, 0.09, 0.3, new THREE.Vector3(WALL + 0.19, m.top + 0.045, 0.06)));
    fixtures.push(f);
  }

  // ---------- the desk: a lamp, and the monitor ----------
  {
    // Someone works late at the desk, and calls it a night before midnight.
    const f = new Fixture('desk', (h, daylight) => h >= 17.5 && h < 23.5 && daylight < 0.7);
    const deskTop = FLOOR + 0.75 * 0.185;
    const x = -0.1;
    const z = WALL + 0.05;
    const metal = look.mat(L.metal, { roughness: 0.5 });
    group.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.004, 8), metal, [x, deskTop + 0.002, z]));
    const arm = mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.08, 4), metal, [x - 0.012, deskTop + 0.04, z + 0.008], 1, [0.2, 0, 0.3]);
    group.add(arm);
    const shade = mesh(new THREE.ConeGeometry(0.016, 0.022, 8, 1, true), look.mat(L.metal, { side: THREE.DoubleSide }), [x - 0.03, deskTop + 0.075, z + 0.02], 1, [0.3, 0, 0.6]);
    group.add(shade);
    const bulbMat = f.glow(new THREE.MeshStandardMaterial({ color: L.shade, emissive: GLOW, emissiveIntensity: 0 }), 2.2);
    const bulb = mesh(new THREE.SphereGeometry(0.006, 6, 4), bulbMat, [x - 0.032, deskTop + 0.068, z + 0.021]);
    bulb.castShadow = false;
    group.add(bulb);
    const lamp = f.light(new THREE.PointLight(GLOW, 0, 0.45, 2), 0.055);
    lamp.position.set(x - 0.035, deskTop + 0.06, z + 0.03);
    group.add(lamp);
    const pool = f.wash(washMaterial('spot', GLOW), 0.3);
    group.add(washMesh(pool, 0.12, 0.09, new THREE.Vector3(x - 0.05, deskTop + 0.0008, z + 0.01), new THREE.Vector3(0, 1, 0)));
    // The monitor, a little cool light among the warm.
    const screenX = -0.2;
    group.add(mesh(new THREE.BoxGeometry(0.012, 0.035, 0.004), metal, [screenX, deskTop + 0.0175, WALL + 0.035]));
    group.add(mesh(new THREE.BoxGeometry(0.11, 0.066, 0.004), metal, [screenX, deskTop + 0.065, WALL + 0.037]));
    const screenMat = f.glow(new THREE.MeshStandardMaterial({ color: '#1C2230', emissive: L.screen, emissiveIntensity: 0 }), 1.1);
    const screen = mesh(new THREE.PlaneGeometry(0.104, 0.06), screenMat, [screenX, deskTop + 0.065, WALL + 0.0395]);
    screen.castShadow = false;
    group.add(screen);
    group.add(f.light(strip(0.1, 0.06, new THREE.Vector3(screenX, deskTop + 0.065, WALL + 0.042), new THREE.Vector3(screenX, deskTop + 0.04, 0.2), new THREE.Color(L.screen)), 1.5));
    f.handles.push(shade, bulb, screen);
    fixtures.push(f);
  }

  // ---------- the globe lamp by the bed, and one on the shelf ----------
  {
    // On for reading in bed, out a little after midnight.
    const f = new Fixture('bedside', (h, daylight) => daylight < 0.5 && (h >= 20.5 || h < 0.75));
    const globeMat = f.glow(new THREE.MeshStandardMaterial({ color: L.shade, emissive: GLOW, emissiveIntensity: 0, roughness: 0.4 }), 1.7);
    const top = m.top;
    const nx = WALL + 0.04;
    const nz = 0.06 - 0.2;
    group.add(mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.02, 6), look.mat(L.bedFrame), [nx, top + 0.065, nz]));
    const globe = mesh(new THREE.SphereGeometry(0.02, 10, 8), globeMat, [nx, top + 0.095, nz]);
    globe.castShadow = false;
    group.add(globe);
    const lamp = f.light(new THREE.PointLight(GLOW, 0, 0.55, 2), 0.085);
    lamp.position.set(nx + 0.02, top + 0.1, nz);
    group.add(lamp);
    const shelfGlobe = mesh(new THREE.SphereGeometry(0.013, 8, 6), globeMat, [-0.15, BOOKSHELF.top + 0.013, WALL + BOOKSHELF.depth / 2]);
    shelfGlobe.castShadow = false;
    group.add(shelfGlobe);
    const glowOnWall = f.wash(washMaterial('spot', GLOW), 0.28);
    group.add(washMesh(glowOnWall, 0.12, 0.12, new THREE.Vector3(WALL + 0.0015, top + 0.1, nz), new THREE.Vector3(1, 0, 0)));
    f.handles.push(globe, shelfGlobe);
    fixtures.push(f);
  }

  return { group, fixtures };
}
