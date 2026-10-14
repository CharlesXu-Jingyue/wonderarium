import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { LightState } from './lighting';

// The cube is only a boundary: glass walls and nothing else. Its inside
// spans -0.5..0.5 on every axis and belongs entirely to the world.

export const CUBE_SIZE = 1;
export const INNER_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.49, -0.49, -0.49),
  new THREE.Vector3(0.49, 0.49, 0.49),
);

const glassVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosL;
  void main() {
    vPosL = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Faint tint face-on and brighter at grazing angles (Fresnel). Along the
// edges the glass looks thick: a soft bluish rim with a crisp highlight
// line. The panes also mirror two light sources that belong to the room
// (fixed relative to the viewer): a tall window to the left and a small
// warm lamp to the right. A flat pane reflects nearly one direction across
// its face, so each reflection is a patch that slides across a pane as the
// cube turns, fades, and turns up on the next one. Kept sparse on purpose.
const glassFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uRim;
  uniform vec3 uEdgeColor;
  uniform vec3 uLampColor;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uBase;
  uniform float uRimStrength;
  uniform float uEdge;
  uniform float uLamps;
  uniform float uAmbient;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosL;

  // How much the view-space direction r hits a soft rectangular light
  // centred on direction c, measured on the plane tangent to c.
  float roomLight(vec3 r, vec3 c, vec2 halfSize) {
    float facing = dot(r, c);
    if (facing <= 0.0) return 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), c));
    vec3 up = cross(c, right);
    vec2 p = vec2(dot(r, right), dot(r, up)) / facing;
    vec2 d = abs(p) - halfSize;
    return 1.0 - smoothstep(0.0, 0.08, max(d.x, d.y));
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float fresnel = pow(1.0 - abs(dot(n, v)), 4.0);

    // Near an edge, two of the three coordinates sit at the surface.
    vec3 q = abs(vPosL) / 0.5;
    float second = max(min(q.x, q.y), max(min(q.y, q.z), min(q.x, q.z)));
    float rim = smoothstep(0.9, 0.985, second);
    float line = smoothstep(0.972, 0.993, second);

    // Mirror the view off the side of the pane that faces the camera, then
    // look the reflected direction up among the room's lights, in view space.
    vec3 facingN = dot(n, v) < 0.0 ? -n : n;
    vec3 r = normalize(mat3(viewMatrix) * reflect(-v, facingN));
    float lamps = (roomLight(r, normalize(vec3(-0.95, 0.3, 0.25)), vec2(0.16, 0.3))
                 + roomLight(r, normalize(vec3(0.9, 0.45, 0.1)), vec2(0.06, 0.09)) * 0.8) * uLamps;

    vec3 h = normalize(uLightDir + v);
    float glint = pow(max(dot(n, h), 0.0), 120.0) * 0.8;

    vec3 color = mix(uTint, uRim, fresnel);
    color = mix(color, uEdgeColor, rim * uEdge);
    color = mix(color, vec3(1.0), line * uEdge * 0.8);
    color = color * uAmbient + uLampColor * lamps + uLightColor * glint;
    float alpha = uBase + fresnel * uRimStrength + (rim * 0.28 + line * 0.5) * uEdge + lamps * 0.3 + glint;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.9));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A soft rounded-square shadow just under the cube, so it seems to rest on
// whatever is behind the window.
const shadowFragment = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * 1.9;
    float d = sdRoundBox(p, vec2(0.5), 0.08);
    float a = (1.0 - smoothstep(-0.12, 0.38, d)) * uStrength;
    gl_FragColor = vec4(vec3(0.2, 0.14, 0.12) * a, a);
  }
`;

interface WallLook {
  side: THREE.Side;
  base: number;
  rim: number;
  edge: number;
  lamps: number;
  order: number;
}

export class GlassCube {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly shadow: THREE.ShaderMaterial;

  constructor() {
    const geometry = new RoundedBoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 4, 0.03);

    // Back walls first, then everything inside, then the front walls.
    const walls: WallLook[] = [
      { side: THREE.BackSide, base: 0.025, rim: 0.18, edge: 0.6, lamps: 0.55, order: -1 },
      { side: THREE.FrontSide, base: 0.03, rim: 0.4, edge: 1, lamps: 1, order: 100 },
    ];
    for (const w of walls) {
      const material = new THREE.ShaderMaterial({
        vertexShader: glassVertex,
        fragmentShader: glassFragment,
        transparent: true,
        depthWrite: false,
        side: w.side,
        uniforms: {
          uTint: { value: new THREE.Color('#DDEAF3') },
          uRim: { value: new THREE.Color('#F4F9FF') },
          uEdgeColor: { value: new THREE.Color('#C9DDEB') },
          uLampColor: { value: new THREE.Color('#FFF0DA') },
          uLightDir: { value: new THREE.Vector3(0, 1, 0) },
          uLightColor: { value: new THREE.Color('#FFFFFF') },
          uBase: { value: w.base },
          uRimStrength: { value: w.rim },
          uEdge: { value: w.edge },
          uLamps: { value: w.lamps },
          uAmbient: { value: 1 },
        },
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = w.order;
      this.materials.push(material);
      this.group.add(mesh);
    }

    this.shadow = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: shadowFragment,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: { uStrength: { value: 0.3 } },
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), this.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -CUBE_SIZE / 2 - 0.004;
    shadow.renderOrder = -2;
    this.group.add(shadow);
  }

  update(light: LightState) {
    for (const m of this.materials) {
      m.uniforms.uLightDir.value.copy(light.keyDirection);
      m.uniforms.uLightColor.value.copy(light.keyColor);
      m.uniforms.uAmbient.value = 0.5 + 0.5 * light.daylight;
    }
    this.shadow.uniforms.uStrength.value = 0.18 + 0.16 * light.daylight;
  }
}
