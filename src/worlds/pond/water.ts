import * as THREE from 'three';
import { P } from './look';
import { groundHeight, pondSdf, WATER } from './terrain';

// The water: a faceted pond surface that breathes with small waves, shows
// the stones through its shallows, rings outward wherever something touches
// it, and froths along its edge; and a little waterfall that pours into it
// over the rocks at the back.

const RIPPLES = 24;
const RIPPLE_LIFE = 2.6;
const RIPPLE_SPEED = 0.055;

const NIGHT_SKY = new THREE.Color('#56648F');
const DAY_SKY = new THREE.Color('#E2F2F0');

/** Ring shapes shared by the surface's vertex and fragment shaders. */
const rippleGlsl = /* glsl */ `
  uniform float uTime;
  uniform vec4 uRipples[${RIPPLES}];
  // x, z, start time, strength. Returns (ring line, wave height).
  vec2 ripples(vec2 p) {
    vec2 sum = vec2(0.0);
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > ${RIPPLE_LIFE.toFixed(2)}) continue;
      float fade = 1.0 - age / ${RIPPLE_LIFE.toFixed(2)};
      fade *= fade * r.w;
      float d = distance(p, r.xy);
      float front = age * ${RIPPLE_SPEED.toFixed(3)};
      float x = d - front;
      float inner = d - front * 0.62;
      sum.x += (exp(-x * x / 0.000014) + 0.6 * exp(-inner * inner / 0.000012)) * fade;
      sum.y += sin(x * 150.0) * exp(-x * x / 0.0005) * fade;
    }
    return sum;
  }
`;

export class Water {
  readonly surface: THREE.Mesh;
  readonly group = new THREE.Group();
  private readonly ripplesU: THREE.Vector4[] = [];
  private nextRipple = 0;
  private readonly time = { value: 0 };
  private readonly uniforms = {
    uSky: { value: new THREE.Color() },
    uFoam: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color(P.shallow) },
    uDeep: { value: new THREE.Color(P.deep) },
  };
  private readonly fall: Waterfall;
  private fallRipple = 0;

  /**
   * @param source where the spring wells up, deep in the cleft
   * @param lip where the water leaves the rock's face
   * @param impact where it meets the pond
   */
  constructor(source: THREE.Vector3, lip: THREE.Vector3, readonly impact: THREE.Vector3) {
    for (let i = 0; i < RIPPLES; i++) this.ripplesU.push(new THREE.Vector4(0, 0, -100, 0));

    // A grid over the pond's bounding box. Where it runs under the banks the
    // ground hides it; each vertex knows the depth of the water above the bed.
    const x0 = -0.4;
    const x1 = 0.36;
    const z0 = -0.3;
    const z1 = 0.4;
    const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 96, 88);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geometry.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) depth[i] = WATER - groundHeight(pos.getX(i), pos.getZ(i));
    geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

    const material = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.16,
      metalness: 0,
      transparent: true,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, {
        uTime: this.time,
        uRipples: { value: this.ripplesU },
      });
      shader.vertexShader = `attribute float aDepth;\nvarying float vDepth;\nvarying vec2 vXZ;\n${rippleGlsl}\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vDepth = aDepth;
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vXZ = wp.xz;
        float wave = sin(wp.x * 38.0 + uTime * 1.1) * 0.6
                   + sin(wp.z * 31.0 - uTime * 0.9 + wp.x * 9.0) * 0.5
                   + sin((wp.x + wp.z) * 57.0 + uTime * 1.7) * 0.3;
        transformed.y += (wave * 0.0011 + ripples(wp.xz).y * 0.0022) * smoothstep(0.0, 0.012, aDepth);`,
      );
      shader.fragmentShader = `uniform vec3 uSky;\nuniform vec3 uFoam;\nuniform vec3 uShallow;\nuniform vec3 uDeep;\nvarying float vDepth;\nvarying vec2 vXZ;\n${rippleGlsl}\n${shader.fragmentShader}`
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float deepness = smoothstep(0.0, 0.05, vDepth);
          diffuseColor.rgb = mix(uShallow, uDeep, deepness);
          diffuseColor.a = mix(0.2, 0.42, deepness);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
          float ring = ripples(vXZ).x;
          float shore = 1.0 - smoothstep(0.0, 0.006, vDepth);
          shore *= 0.55 + 0.45 * sin(uTime * 1.3 + vXZ.x * 41.0 + vXZ.y * 29.0);
          totalEmissiveRadiance += uSky * fres * 0.35 + uFoam * (ring * 0.5 + shore * 0.3);
          diffuseColor.a = clamp(diffuseColor.a + fres * 0.25 + ring * 0.45 + shore * 0.4, 0.0, 1.0);`,
        );
    };
    material.customProgramCacheKey = () => 'pond-water';

    this.surface = new THREE.Mesh(geometry, material);
    this.surface.position.y = WATER;
    this.surface.receiveShadow = true;
    this.group.add(this.surface);

    this.fall = new Waterfall(source, lip, impact);
    this.group.add(this.fall.group);
  }

  get now() {
    return this.time.value;
  }

  /** Start a ring at (x, z); strength about 0.3 (a drip) to 1.2 (a splash). */
  ripple(x: number, z: number, strength = 1) {
    if (pondSdf(x, z) > 0.01) return;
    this.ripplesU[this.nextRipple].set(x, z, this.time.value, strength);
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
  }

  /** The gentle swell under a point, matching the shader's waves closely enough to float on. */
  swell(x: number, z: number) {
    const t = this.time.value;
    const wave = Math.sin(x * 38 + t * 1.1) * 0.6 + Math.sin(z * 31 - t * 0.9 + x * 9) * 0.5 + Math.sin((x + z) * 57 + t * 1.7) * 0.3;
    return wave * 0.0011;
  }

  /** How strongly recent rings are passing a point right now (for bobbing pads). */
  disturbance(x: number, z: number) {
    let sum = 0;
    const t = this.time.value;
    for (const r of this.ripplesU) {
      const age = t - r.z;
      if (age < 0 || age > RIPPLE_LIFE) continue;
      const d = Math.hypot(x - r.x, z - r.y) - age * RIPPLE_SPEED;
      sum += Math.exp((-d * d) / 0.0004) * (1 - age / RIPPLE_LIFE) * r.w;
    }
    return sum;
  }

  update(dt: number, daylight: number) {
    this.time.value += dt;
    this.uniforms.uSky.value.lerpColors(NIGHT_SKY, DAY_SKY, daylight);
    this.uniforms.uFoam.value.setScalar(0.3 + 0.6 * daylight);
    this.fall.update(dt, this.time.value, daylight);
    if ((this.fallRipple -= dt) <= 0) {
      this.fallRipple = 0.5;
      this.ripple(this.impact.x + (Math.random() - 0.5) * 0.02, this.impact.z + (Math.random() - 0.5) * 0.02, 0.45);
    }
  }
}

// ---------- waterfall ----------

const fallVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fallFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLight;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    // vUv.y is metres along the flow; streaks race down it.
    float s = noise(vec2(vUv.x * 7.0, vUv.y * 18.0 - uTime * 4.2)) * 0.6
            + noise(vec2(vUv.x * 19.0, vUv.y * 40.0 - uTime * 6.0)) * 0.4;
    float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    float white = smoothstep(0.45, 0.8, s);
    vec3 color = mix(vec3(0.6, 0.86, 0.9), vec3(1.0), white);
    float alpha = (0.5 + 0.45 * s) * edge;
    gl_FragColor = vec4(color * uLight, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class Waterfall {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly foam: { m: THREE.Mesh; phase: number; base: number }[] = [];
  private readonly drops: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
  private readonly dropGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly foamMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5, flatShading: true, transparent: true, opacity: 0.9 });
  private dropIn = 0;

  constructor(source: THREE.Vector3, lip: THREE.Vector3, private readonly impact: THREE.Vector3) {
    // It wells up from inside the cleft, spills over its lip, and falls in a
    // parabola to the pond, a narrow jet that spreads as it drops.
    const flow = new THREE.Vector3(impact.x - lip.x, 0, impact.z - lip.z).normalize();
    const across = new THREE.Vector3(-flow.z, 0, flow.x);
    const path: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) path.push(new THREE.Vector3().lerpVectors(source, lip, i / 3));
    path.push(lip.clone());
    const reach = Math.hypot(impact.x - lip.x, impact.z - lip.z);
    for (let i = 1; i <= 14; i++) {
      const t = i / 14;
      path.push(lip.clone().addScaledVector(flow, reach * t).setY(lip.y - (lip.y - impact.y - 0.002) * t * t));
    }
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let along = 0;
    path.forEach((p, i) => {
      if (i > 0) along += p.distanceTo(path[i - 1]);
      const w = 0.005 + 0.019 * Math.max(0, (lip.y - p.y) / (lip.y - impact.y));
      for (const side of [-1, 1]) {
        const v = p.clone().addScaledVector(across, side * w);
        positions.push(v.x, v.y + 0.001, v.z);
        uvs.push(side < 0 ? 0 : 1, along);
      }
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      vertexShader: fallVertex,
      fragmentShader: fallFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } },
    });
    const sheet = new THREE.Mesh(geometry, this.material);
    sheet.renderOrder = 2;
    this.group.add(sheet);

    // Froth where it lands.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.016 + (i % 2) * 0.008;
      const m = new THREE.Mesh(this.dropGeo, this.foamMat);
      m.position.set(impact.x + Math.cos(a) * r, impact.y + 0.002, impact.z + Math.sin(a) * r);
      const base = i === 0 ? 0.014 : 0.008 + (i % 3) * 0.002;
      m.scale.set(base, base * 0.5, base);
      this.foam.push({ m, phase: i * 1.7, base });
      this.group.add(m);
    }
  }

  update(dt: number, t: number, daylight: number) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uLight.value.setScalar(0.5 + 0.5 * daylight);
    for (const f of this.foam) {
      const s = f.base * (1 + 0.3 * Math.sin(t * 5 + f.phase));
      f.m.scale.set(s, s * 0.5, s);
      f.m.rotation.y += dt * 0.5;
    }
    // Fine spray, tossed up and falling back.
    if ((this.dropIn -= dt) <= 0) {
      this.dropIn = 0.12;
      const m = new THREE.Mesh(this.dropGeo, this.foamMat);
      m.position.copy(this.impact);
      m.scale.setScalar(0.0025);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 0.05, 0.12 + Math.random() * 0.06, Math.sin(a) * 0.05);
      this.drops.push({ m, v, age: 0 });
      this.group.add(m);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.v.y -= 1.4 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < this.impact.y) {
        this.group.remove(d.m);
        this.drops.splice(i, 1);
      }
    }
  }
}
