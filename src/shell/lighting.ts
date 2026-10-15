import * as THREE from 'three';

// One sky for every world. The key light is the sun by day and the moon by
// night; it dims to almost nothing at twilight, which is when it swaps
// sides, so the hand-over is never visible.

interface Keyframe {
  elevation: number; // sine of the sun's angle above the horizon
  sky: string;
  ground: string;
  hemi: number;
  key: string;
  backdropTop: string;
  backdropBottom: string;
}

const KEYS: Keyframe[] = [
  { elevation: -1, sky: '#6E78B0', ground: '#3A3F66', hemi: 1.7, key: '#C9D4FF',
    backdropTop: '#3E4670', backdropBottom: '#5E6A9E' },
  { elevation: -0.15, sky: '#9A90C4', ground: '#5A5074', hemi: 1.6, key: '#D9C9FF',
    backdropTop: '#6A6C98', backdropBottom: '#B49AB0' },
  { elevation: 0.05, sky: '#F7C2AE', ground: '#8E7290', hemi: 1.35, key: '#FFB07E',
    backdropTop: '#C9A3A0', backdropBottom: '#E3BBA0' },
  { elevation: 0.4, sky: '#FFF1DF', ground: '#D8BC9C', hemi: 1.05, key: '#FFE6C8',
    backdropTop: '#CDBBA9', backdropBottom: '#B19D8B' },
  { elevation: 1, sky: '#FFF5E8', ground: '#DCC4A6', hemi: 1.1, key: '#FFEFD8',
    backdropTop: '#D2C1AF', backdropBottom: '#B5A190' },
];

/**
 * A world's own backdrop for fullscreen and the browser: a top and bottom
 * colour by day and by night. The sky still shows through a little, so
 * dawn and dusk warm every world.
 */
export interface Backdrop {
  day: [top: string, bottom: string];
  night: [top: string, bottom: string];
}

/** How much of the backdrop is the world's own colour rather than the sky's. */
const THEME = 0.72;

export interface LightState {
  /** 0 at night, 1 in full daylight. */
  daylight: number;
  /** Local time of day in the box, 0 to 24. */
  hours: number;
  /** Unit vector pointing toward the key light (sun or moon). */
  keyDirection: THREE.Vector3;
  keyColor: THREE.Color;
}

const UP = new THREE.Vector3(0, 1, 0);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export class Lighting {
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly state: LightState = {
    daylight: 1,
    hours: 12,
    keyDirection: new THREE.Vector3(0, 1, 0),
    keyColor: new THREE.Color(),
  };
  readonly backdrop = { top: new THREE.Color(), bottom: new THREE.Color() };
  /** The current world's backdrop colours, if it has its own. */
  theme?: Backdrop;

  private readonly tmp = { a: new THREE.Color(), b: new THREE.Color() };

  constructor(scene: THREE.Scene) {
    const k = this.key;
    k.castShadow = true;
    k.shadow.mapSize.set(1024, 1024);
    k.shadow.camera.left = -0.9;
    k.shadow.camera.right = 0.9;
    k.shadow.camera.top = 0.9;
    k.shadow.camera.bottom = -0.9;
    k.shadow.camera.near = 0.1;
    k.shadow.camera.far = 6;
    k.shadow.bias = -0.0008;
    k.shadow.normalBias = 0.01;
    k.shadow.radius = 3;
    scene.add(this.hemi, k, k.target);
  }

  private blend(elevation: number, pick: (f: Keyframe) => string, out: THREE.Color) {
    const i = Math.max(0, KEYS.findIndex((f) => f.elevation >= elevation) - 1);
    const lo = KEYS[i];
    const hi = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = hi === lo ? 0 : smoothstep(lo.elevation, hi.elevation, elevation);
    return out.lerpColors(this.tmp.a.set(pick(lo)), this.tmp.b.set(pick(hi)), t);
  }

  private blendNumber(elevation: number, pick: (f: Keyframe) => number) {
    const i = Math.max(0, KEYS.findIndex((f) => f.elevation >= elevation) - 1);
    const lo = KEYS[i];
    const hi = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = hi === lo ? 0 : smoothstep(lo.elevation, hi.elevation, elevation);
    return pick(lo) + (pick(hi) - pick(lo)) * t;
  }

  /**
   * @param hours local time of day in the box
   * @param turn how far the view has been turned around the cube (radians).
   *   The light belongs to the room, not the cube, so it turns with the view
   *   and the shadows sweep across the contents as the cube is spun.
   */
  update(hours: number, turn = 0) {
    // 06:00 sunrise, 12:00 noon, 18:00 sunset; the moon takes the other half.
    const angle = ((hours - 6) / 12) * Math.PI;
    const elevation = Math.sin(angle);
    const isDay = elevation >= 0;
    const arc = isDay ? angle : angle - Math.PI;

    // The light sweeps east to west, tilted toward the viewer's default side,
    // and never drops below a shallow angle so shading stays readable.
    const dir = this.state.keyDirection.set(
      Math.cos(arc) * 0.9,
      Math.max(Math.abs(Math.sin(arc)), 0.28),
      0.55,
    ).normalize().applyAxisAngle(UP, turn);
    this.key.position.copy(dir).multiplyScalar(3);
    this.key.target.position.set(0, 0, 0);

    const fade = smoothstep(0.0, 0.22, Math.abs(elevation));
    this.key.intensity = isDay ? 1.8 * fade : 0.8 * fade;
    this.blend(elevation, (f) => f.key, this.key.color);
    this.blend(elevation, (f) => f.sky, this.hemi.color);
    this.blend(elevation, (f) => f.ground, this.hemi.groundColor);
    this.hemi.intensity = this.blendNumber(elevation, (f) => f.hemi);
    this.state.hours = hours;
    this.state.daylight = smoothstep(-0.12, 0.25, elevation);
    this.state.keyColor.copy(this.key.color);

    this.blend(elevation, (f) => f.backdropTop, this.backdrop.top);
    this.blend(elevation, (f) => f.backdropBottom, this.backdrop.bottom);
    if (this.theme) {
      const { day, night } = this.theme;
      const d = this.state.daylight;
      const { a, b } = this.tmp;
      this.backdrop.top.lerp(a.set(night[0]).lerp(b.set(day[0]), d), THEME);
      this.backdrop.bottom.lerp(a.set(night[1]).lerp(b.set(day[1]), d), THEME);
    }
  }
}
