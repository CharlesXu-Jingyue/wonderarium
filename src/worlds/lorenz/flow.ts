// The Lorenz system: Edward Lorenz's 1963 sketch of air rolling in a heated
// layer, three equations so simple and so unpredictable that they gave
// chaos its butterfly. Every point follows the same rule, and any two that
// start a hair apart end up on different wings.

const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;

type Vec = [number, number, number];
const k1: Vec = [0, 0, 0];
const k2: Vec = [0, 0, 0];
const k3: Vec = [0, 0, 0];
const k4: Vec = [0, 0, 0];

function slope(x: number, y: number, z: number, out: Vec) {
  out[0] = SIGMA * (y - x);
  out[1] = x * (RHO - z) - y;
  out[2] = x * y - BETA * z;
}

/** Advance the point at `i` in `s` (x, y, z in a row) by `h`, fourth-order Runge-Kutta. */
export function advance(s: Float64Array, i: number, h: number) {
  const x = s[i];
  const y = s[i + 1];
  const z = s[i + 2];
  slope(x, y, z, k1);
  slope(x + (h / 2) * k1[0], y + (h / 2) * k1[1], z + (h / 2) * k1[2], k2);
  slope(x + (h / 2) * k2[0], y + (h / 2) * k2[1], z + (h / 2) * k2[2], k3);
  slope(x + h * k3[0], y + h * k3[1], z + h * k3[2], k4);
  s[i] = x + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  s[i + 1] = y + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  s[i + 2] = z + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
}

/**
 * Points spread over the attractor the way a long trajectory visits it:
 * settle onto it from anywhere, then sample along the way.
 */
export function onAttractor(count: number, h = 0.005): Float64Array {
  const p = new Float64Array([1, 1, 1]);
  for (let i = 0; i < 4000; i++) advance(p, 0, h);
  const out = new Float64Array(count * 3);
  for (let n = 0; n < count; n++) {
    const skip = 3 + Math.floor(Math.random() * 12);
    for (let i = 0; i < skip; i++) advance(p, 0, h);
    out.set(p, n * 3);
  }
  return out;
}

/** The glow of a point, by where it is: amber on one wing, violet on the other. */
export function hue(x: number, y: number, z: number, out: Vec) {
  const t = smooth(-12, 12, x);
  let r = 1.0 + (0.62 - 1.0) * t;
  let g = 0.7 + (0.5 - 0.7) * t;
  let b = 0.3 + (1.0 - 0.3) * t;
  // A whiter heat where the wings cross over.
  const cross = 1 - Math.abs(2 * t - 1);
  const w = 0.45 * cross * cross;
  r += (1.0 - r) * w;
  g += (0.93 - g) * w;
  b += (0.82 - b) * w;
  // A cooler blue near the eye of each wing, where the turns are tight.
  const eye = 1 - Math.min(1, Math.hypot(Math.abs(x) - 8.5, Math.abs(y) - 8.5, z - 27) / 11);
  const c = 0.4 * eye * eye;
  r += (0.55 - r) * c;
  g += (0.72 - g) * c;
  b += (1.0 - b) * c;
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
