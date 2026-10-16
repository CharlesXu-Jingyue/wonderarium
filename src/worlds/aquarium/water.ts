import * as THREE from 'three';
import { dotMaterial, glowUniforms, trackPixels } from '../glow';
import { rand } from '../kit';
import { A } from './look';

// The water itself: the blue that fills the tank right up to the lid, its
// gently heaving surface, shafts of light leaning down
// from it, bubbles rising from the pot and the rocks, and the fine specks
// that drift in any real water and catch the light.

/** The waterline: right up under the lid, with room for the swell to stay inside the glass. */
export const WATER_Y = 0.485;
const INNER = 0.494;

export class Water {
  readonly group = new THREE.Group();
  private readonly volume: THREE.Mesh;
  private readonly surface: THREE.Mesh;
  private readonly surfaceRest: Float32Array;
  private readonly shafts: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; phase: number; x: number; z: number }[] = [];
  private readonly bubbles: Bubbles;
  private readonly snow: Snow;
  private readonly top = new THREE.Color();
  private readonly deep = new THREE.Color();
  private readonly tmp = new THREE.Color();
  private colourIn = 0;

  constructor() {
    // The body of water: the inside of a box, seen from within, shaded from
    // a lighter blue under the surface to a deep one at the sand.
    const box = new THREE.BoxGeometry(INNER * 2, WATER_Y + INNER, INNER * 2);
    box.translate(0, (WATER_Y - INNER) / 2, 0);
    box.setAttribute('color', new THREE.BufferAttribute(new Float32Array(box.attributes.position.count * 3), 3));
    this.volume = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    );
    this.volume.renderOrder = -0.5;
    this.group.add(this.volume);

    const plane = new THREE.PlaneGeometry(INNER * 2, INNER * 2, 22, 22);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, WATER_Y, 0);
    this.surfaceRest = (plane.attributes.position.array as Float32Array).slice();
    this.surface = new THREE.Mesh(
      plane,
      new THREE.MeshStandardMaterial({
        color: A.surface.day,
        emissive: '#3A6FB0',
        emissiveIntensity: 0.4,
        roughness: 0.25,
        flatShading: true,
        transparent: true,
        // Faint, so from above you look down into the tank through it.
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.surface.renderOrder = 50;
    this.group.add(this.surface);

    for (const [x, z, width, phase] of [
      [-0.18, -0.12, 0.13, 0], [0.05, -0.2, 0.09, 1.7], [0.2, 0.02, 0.12, 3.1], [-0.05, 0.16, 0.08, 4.4], [-0.28, 0.12, 0.07, 5.6],
    ]) {
      const material = shaftMaterial();
      const geometry = new THREE.PlaneGeometry(width, WATER_Y + 0.33);
      geometry.translate(0, -(WATER_Y + 0.33) / 2, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, WATER_Y, z);
      mesh.renderOrder = 40;
      // Always face the viewer, turning only about the vertical.
      mesh.onBeforeRender = (_r, _s, camera) => {
        mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
        mesh.updateMatrixWorld();
      };
      this.shafts.push({ mesh, material, phase, x, z });
      this.group.add(mesh);
    }

    this.bubbles = new Bubbles();
    this.snow = new Snow();
    this.group.add(this.bubbles.mesh, this.snow.points);
  }

  /** Let a few bubbles go from `at`, one after another. */
  bubble(at: THREE.Vector3, count: number, spread = 0.004) {
    this.bubbles.emit(at, count, spread);
  }

  update(t: number, dt: number, daylight: number) {
    // The surface heaves in long, slow, overlapping swells.
    const attr = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    const r = this.surfaceRest;
    for (let i = 0; i < p.length; i += 3) {
      const x = r[i];
      const z = r[i + 2];
      p[i + 1] = WATER_Y + 0.006 * Math.sin(x * 9 + t * 0.7) * Math.cos(z * 7 - t * 0.5) + 0.003 * Math.sin((x - z) * 17 + t * 1.1);
    }
    attr.needsUpdate = true;

    for (const s of this.shafts) {
      // Each shaft brightens and fades on its own slow breath, and leans a little.
      const breath = 0.5 + 0.5 * Math.sin(t * 0.13 + s.phase);
      s.material.uniforms.uStrength.value = (0.1 + 0.9 * breath * breath) * (0.3 + 0.7 * daylight);
      s.mesh.position.x = s.x + 0.02 * Math.sin(t * 0.07 + s.phase);
    }

    this.bubbles.update(dt);
    this.snow.update(t, dt);

    // The water's colours follow the day, checked now and then.
    if ((this.colourIn -= dt) <= 0 || dt === 0) {
      this.colourIn = 0.5;
      this.top.set(A.waterTop.night).lerp(this.tmp.set(A.waterTop.day), daylight);
      this.deep.set(A.waterDeep.night).lerp(this.tmp.set(A.waterDeep.day), daylight);
      const pos = this.volume.geometry.getAttribute('position');
      const col = this.volume.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const h = THREE.MathUtils.clamp((pos.getY(i) + INNER) / (WATER_Y + INNER), 0, 1);
        this.tmp.copy(this.deep).lerp(this.top, h);
        col.setXYZ(i, this.tmp.r, this.tmp.g, this.tmp.b);
      }
      col.needsUpdate = true;
      const surface = this.surface.material as THREE.MeshStandardMaterial;
      surface.color.set(A.surface.night).lerp(this.tmp.set(A.surface.day), daylight);
      surface.emissiveIntensity = 0.12 + 0.18 * daylight;
    }
  }

  dispose() {
    for (const m of [this.volume, this.surface, ...this.shafts.map((s) => s.mesh)]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.bubbles.dispose();
    this.snow.dispose();
  }
}

/** A soft shaft of light: brightest under the surface, fading with depth and at its edges. */
function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0.5 } },
    transparent: true,
    depthWrite: false,
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
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float down = vUv.y;
        float a = pow(across, 2.2) * pow(down, 1.6) * uStrength * 0.16;
        gl_FragColor = vec4(vec3(0.62, 0.82, 1.0) * a, 0.0);
      }
    `,
  });
}

// ---------- bubbles ----------

const BUBBLES = 90;

class Bubbles {
  readonly mesh: THREE.InstancedMesh;
  private readonly live: { at: THREE.Vector3; r: number; speed: number; phase: number; delay: number; t: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: A.bubble,
        emissive: '#6FA8D8',
        emissiveIntensity: 0.35,
        roughness: 0.1,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
      BUBBLES,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  emit(at: THREE.Vector3, count: number, spread: number) {
    for (let i = 0; i < count && this.live.length < BUBBLES; i++) {
      this.live.push({
        at: at.clone().add(new THREE.Vector3(rand(-spread, spread), 0, rand(-spread, spread))),
        r: rand(0.0035, 0.008),
        speed: rand(0.05, 0.08),
        phase: rand(0, 6.3),
        delay: i * rand(0.18, 0.35),
        t: 0,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      if (b.delay > 0) {
        b.delay -= dt;
        continue;
      }
      b.t += dt;
      // Up, wobbling, and a touch larger as the pressure eases.
      b.at.y += b.speed * dt;
      b.at.x += Math.sin(b.t * 7 + b.phase) * 0.012 * dt;
      b.at.z += Math.cos(b.t * 6 + b.phase) * 0.012 * dt;
      const r = b.r * (1 + 0.25 * Math.min(1, b.t / 6));
      if (b.at.y > WATER_Y - r) {
        this.live.splice(i, 1);
        continue;
      }
      this.s.set(r, r * (1 - 0.12 * Math.sin(b.t * 9 + b.phase)), r);
      this.mesh.setMatrixAt(n++, this.m.compose(this.p.copy(b.at), this.q, this.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------- drifting specks ----------

const SPECKS = 170;

class Snow {
  readonly points: THREE.Points;
  private readonly uniforms = glowUniforms();
  private readonly speed = new Float32Array(SPECKS);

  constructor() {
    const pos = new Float32Array(SPECKS * 3);
    const col = new Float32Array(SPECKS * 3);
    const size = new Float32Array(SPECKS);
    const wander = new Float32Array(SPECKS * 4);
    for (let i = 0; i < SPECKS; i++) {
      pos.set([rand(-0.44, 0.44), rand(-0.36, WATER_Y - 0.03), rand(-0.44, 0.44)], i * 3);
      const k = rand(0.6, 1.1);
      col.set(A.snow.map((v) => v * k), i * 3);
      size[i] = Math.random() < 0.1 ? rand(0.022, 0.035) : rand(0.008, 0.016);
      wander.set([rand(0, 6.3), rand(0, 6.3), rand(0, 6.3), rand(0.006, 0.02)], i * 4);
      this.speed[i] = rand(0.002, 0.007);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('aWander', new THREE.BufferAttribute(wander, 4));
    this.points = new THREE.Points(geometry, dotMaterial(this.uniforms));
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    trackPixels(this.points, this.uniforms);
  }

  update(t: number, dt: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uIntensity.value = 0.7;
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    for (let i = 0; i < SPECKS; i++) {
      p[i * 3 + 1] -= this.speed[i] * dt;
      // Settled to the sand: start again just under the surface.
      if (p[i * 3 + 1] < -0.37) p[i * 3 + 1] = WATER_Y - 0.03;
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
