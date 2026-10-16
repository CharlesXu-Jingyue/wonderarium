import * as THREE from 'three';

// Light without a lamp: soft round sprites and thin lines that give off
// their own colour. Each writes premultiplied colour with less alpha than
// colour, so it adds light like a glow on a dark backdrop yet still shows as
// a tint over a bright desktop, where pure additive light would vanish.

/** Shared by everything that glows, so one change brightens them all. */
export interface GlowUniforms {
  [name: string]: THREE.IUniform;
  uTime: { value: number };
  uIntensity: { value: number };
  uPx: { value: number };
}

export function glowUniforms(): GlowUniforms {
  return { uTime: { value: 0 }, uIntensity: { value: 1 }, uPx: { value: 400 } };
}

function glowing(material: THREE.ShaderMaterial) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return material;
}

/**
 * Round glowing dots: a bright core in a wide, faint halo. Each has a size
 * in world units and may wander and twinkle (aWander: three phases, then
 * how far it strays; nothing for points that only go where they are put).
 */
export function dotMaterial(uniforms: GlowUniforms) {
  return glowing(
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 color;
        attribute vec4 aWander;
        uniform float uTime;
        uniform float uPx;
        uniform float uIntensity;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec3 p = position + aWander.w * vec3(
            sin(uTime * 0.21 + aWander.x),
            sin(uTime * 0.17 + aWander.y),
            sin(uTime * 0.19 + aWander.z));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPx * projectionMatrix[1][1] / -mv.z;
          float twinkle = aWander.w > 0.0 ? 0.6 + 0.4 * sin(uTime * 1.3 + aWander.x * 3.0) : 1.0;
          vColor = color;
          vAlpha = uIntensity * twinkle;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float core = exp(-d * d * 22.0);
          float halo = exp(-d * d * 4.0) * 0.6 * (1.0 - d);
          gl_FragColor = vec4(vColor * (core * 1.5 + halo) * vAlpha, (core * 0.85 + halo * 0.3) * vAlpha);
        }
      `,
    }),
  );
}

/** Thin glowing lines that fade along aFade (1 bright, 0 gone), times `opacity`. */
export function lineMaterial(uniforms: GlowUniforms, opacity: number) {
  return glowing(
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uOpacity: { value: opacity } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aFade;
        uniform float uIntensity;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vColor = color;
          vAlpha = aFade * uOpacity * uIntensity;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(vColor * vAlpha, vAlpha * 0.45);
        }
      `,
    }),
  );
}

/** Keep a dot material's sizes in step with the canvas it is drawn on. */
export function trackPixels(object: THREE.Object3D, uniforms: GlowUniforms) {
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer) => {
    uniforms.uPx.value = renderer.getDrawingBufferSize(size).y / 2;
  };
}
