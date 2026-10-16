import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GlassCube } from './cube';
import { Lighting } from './lighting';
import type { World, WorldPointerKind } from '../worlds/world';

// Everything that draws: renderer, camera, orbit controls, the shared light
// and the glass. A world's content sits in `worldRoot`, inside the cube.

const FOV = 28;
const FIT_RADIUS = 0.98; // cube corners plus a little room for its shadow
const IDLE_BEFORE_DRIFT = 10; // seconds without input before the slow orbit
const HOME_POLAR = 1.08;
const HOME_AZIMUTH = Math.PI / 4;
/** The still on a world's card: turned a little off the corner, a touch closer, at midday. */
const SNAP = { azimuth: HOME_AZIMUTH + 0.32, polar: 1.02, zoom: 0.86, hours: 13 };
/** Where the glass cuts off anything that grows past it. */
const WALL = 0.497;
/**
 * Along each edge: the glass rounds off with a radius of 0.03, so on the
 * diagonal its edge is 0.47 + 0.03 / sqrt(2) out on both axes. A cut there,
 * across the corner, keeps things inside the curve (|a| + |b| <= 0.983);
 * like the walls, each plane keeps the side its normal faces away from.
 */
const EDGE_CUT = 0.983 / Math.SQRT2;
/**
 * And at each corner, where the glass rounds off as a little sphere about
 * (0.47, 0.47, 0.47): its farthest reach along the diagonal is
 * 0.47 * sqrt(3) + 0.03, so a cut just inside that keeps things inside the
 * curve (|x| + |y| + |z| <= 1.455).
 */
const CORNER_CUT = 1.455 / Math.sqrt(3);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  readonly controls: OrbitControls;
  readonly lighting: Lighting;
  readonly cube = new GlassCube();
  readonly worldRoot = new THREE.Group();

  /** Slowly orbit when nobody has touched the cube for a while. */
  drift = true;

  private world?: World;
  private fitDistance = 4;
  private homing = 0; // seconds left in a reset-view glide
  private idle = 0;
  private pressStart = 0;
  private pressAt = { x: 0, y: 0 };
  private worldHasPress = false;
  private readonly snapCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  /** The light as last drawn, to put back after a snapshot. */
  private lastLight = { hours: 12, turn: 0 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  // Six planes facing inward: the cube is the edge of every world, so a tree
  // too tall or a rock too wide is simply cut off at the glass. The glass
  // has rounded edges and corners, so twelve more planes, one along each
  // edge, and eight across the corners, trim what would otherwise poke out
  // past the curve.
  private readonly walls = [
    ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(
      ([x, y, z]) => new THREE.Plane(new THREE.Vector3(x, y, z), WALL),
    ),
    ...[[0, 1], [0, 2], [1, 2]].flatMap(([a, b]) =>
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sa, sb]) => {
        const n = new THREE.Vector3();
        n.setComponent(a, sa).setComponent(b, sb).normalize();
        return new THREE.Plane(n, EDGE_CUT);
      }),
    ),
    ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) =>
      new THREE.Plane(new THREE.Vector3(sx, sy, sz).normalize(), CORNER_CUT),
    ))),
  ];
  private readonly walled = new WeakSet<THREE.Material>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Worlds may clip their own materials (a hamster walking into a house).
    this.renderer.localClippingEnabled = true;

    this.lighting = new Lighting(this.scene);
    this.scene.add(this.worldRoot, this.cube.group);

    // A three-quarter view from slightly above.
    this.camera.position.setFromSphericalCoords(this.fitDistance, HOME_POLAR, HOME_AZIMUTH);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, -0.03, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.6;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06; // never from below
    this.controls.autoRotateSpeed = 0.25;
    this.controls.addEventListener('start', () => this.wake());

    this.scene.onBeforeRender = (_r, _s, camera) => {
      const haze = this.world?.haze;
      const fog = this.scene.fog;
      if (!haze || !(fog instanceof THREE.Fog)) return;
      const d = camera.position.distanceTo(this.controls.target);
      fog.color.copy(haze.color);
      fog.near = d + haze.near;
      fog.far = d + haze.far;
    };

    this.listenForPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setWorld(world: World | undefined) {
    this.world = world;
    // A world seen through a haze gets fog, measured from whichever camera
    // is drawing (the view, or the one that takes a card's picture).
    this.scene.fog = world?.haze ? new THREE.Fog(world.haze.color) : null;
  }

  /** Glide the camera back to the starting three-quarter view. */
  resetView() {
    this.wake();
    this.homing = 0.9;
  }

  /**
   * A still of the world for its card, always from the same angle and in
   * the same midday light, whatever the view and the hour are right now.
   */
  snapshot(width: number, height: number): HTMLCanvasElement {
    const cam = this.snapCamera;
    cam.aspect = this.camera.aspect;
    cam.updateProjectionMatrix();
    cam.position.setFromSphericalCoords(this.fitDistance * SNAP.zoom, SNAP.polar, SNAP.azimuth).add(this.controls.target);
    cam.lookAt(this.controls.target);
    this.lighting.update(SNAP.hours, SNAP.azimuth - HOME_AZIMUTH);
    this.cube.update(this.lighting.state);
    // A still step, so the world's own colours (its water, its glow) follow
    // the midday light too; no time passes.
    this.world?.step(0);
    this.wallIn();
    const background = `#${this.lighting.backdrop.bottom.getHexString()}`;
    const out = this.capture({ width, height, scale: 0.92, background }, cam);
    // Back to the room as it is, and draw it so the snapshot never shows.
    this.lighting.update(this.lastLight.hours, this.lastLight.turn);
    this.cube.update(this.lighting.state);
    this.world?.step(0);
    this.renderer.render(this.scene, this.camera);
    return out;
  }

  /** Render once and copy the frame, optionally cropped to a centred box. */
  capture(crop?: { width: number; height: number; scale: number; background?: string }, view: THREE.Camera = this.camera): HTMLCanvasElement {
    // Render onto an opaque background when asked: copies of a transparent
    // WebGL canvas come out black where nothing was drawn.
    if (crop?.background) this.renderer.setClearColor(crop.background, 1);
    this.renderer.render(this.scene, view);
    this.renderer.setClearColor(0x000000, 0);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    if (!crop) {
      out.width = src.width;
      out.height = src.height;
      out.getContext('2d')!.drawImage(src, 0, 0);
      return out;
    }
    // Crop around the cube, which is centred and fills the shorter side
    // (the height in a landscape window, the width on a phone).
    const aspect = crop.width / crop.height;
    let sh = src.height * crop.scale;
    let sw = sh * aspect;
    if (sw > src.width * crop.scale) {
      sw = src.width * crop.scale;
      sh = sw / aspect;
    }
    out.width = crop.width;
    out.height = crop.height;
    out.getContext('2d')!.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, crop.width, crop.height);
    // Draw the frame again as usual, or the opaque one would be shown.
    if (crop.background) this.renderer.render(this.scene, this.camera);
    return out;
  }

  /** Give every material in the world the cube's walls (once each, new ones as they appear). */
  private wallIn() {
    this.worldRoot.traverse((o) => {
      const material = (o as THREE.Mesh).material;
      if (!material) return;
      for (const m of [material].flat()) {
        if (this.walled.has(m) || m instanceof THREE.ShaderMaterial) continue;
        this.walled.add(m);
        m.clippingPlanes = [...(m.clippingPlanes ?? []), ...this.walls];
        m.clipShadows = true;
      }
    });
  }

  wake() {
    this.idle = 0;
    this.controls.autoRotate = false;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    const zoom = this.camera.position.distanceTo(this.controls.target) / this.fitDistance;

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const halfV = THREE.MathUtils.degToRad(FOV / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    this.fitDistance = FIT_RADIUS / Math.sin(Math.min(halfV, halfH));
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = this.fitDistance * 0.55;
    this.controls.maxDistance = this.fitDistance * 1.6;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(this.fitDistance * THREE.MathUtils.clamp(zoom, 0.55, 1.6));
    this.camera.position.copy(this.controls.target).add(offset);
  }

  // Clicks go to the world first; if it wants the press, the camera stays put.
  private listenForPointer() {
    const send = (kind: WorldPointerKind, e: PointerEvent) => {
      if (!this.world?.pointer) return false;
      const rect = this.canvas.getBoundingClientRect();
      this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const held = kind === 'down' || kind === 'hover' ? 0 : (performance.now() - this.pressStart) / 1000;
      const used = this.world.pointer({ kind, ray: this.raycaster.ray, held });
      this.canvas.style.cursor = this.world.cursor ?? '';
      return used;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.wake();
      this.pressStart = performance.now();
      this.pressAt = { x: e.clientX, y: e.clientY };
      this.worldHasPress = send('down', e);
      this.controls.enabled = !this.worldHasPress;
      if (this.worldHasPress) this.canvas.setPointerCapture(e.pointerId);
    }, { capture: true });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.worldHasPress) send('move', e);
      else if (e.buttons === 0) send('hover', e);
    });

    const release = (e: PointerEvent) => {
      if (this.worldHasPress) send('up', e);
      else if (e.type === 'pointerup') {
        // A short press that barely moved is a click, not a turn of the cube.
        const moved = Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y);
        if (moved < 5 && performance.now() - this.pressStart < 400) send('click', e);
      }
      this.worldHasPress = false;
      this.controls.enabled = true;
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('pointerleave', (e) => {
      if (!this.worldHasPress) send('leave', e);
    });
    this.canvas.addEventListener('wheel', () => this.wake(), { passive: true });
  }

  private glideHome(dt: number) {
    this.homing = Math.max(0, this.homing - dt);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const current = new THREE.Spherical().setFromVector3(offset);
    const k = 1 - Math.exp(-dt * 6);
    // Take the short way round.
    let dTheta = HOME_AZIMUTH - current.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    current.theta += dTheta * k;
    current.phi += (HOME_POLAR - current.phi) * k;
    current.radius += (this.fitDistance - current.radius) * k;
    this.camera.position.setFromSpherical(current).add(this.controls.target);
  }

  render(dt: number, hours: number) {
    this.idle += dt;
    this.controls.autoRotate = this.drift && this.idle > IDLE_BEFORE_DRIFT;
    if (this.homing > 0) this.glideHome(dt);
    this.controls.update(dt);
    // How far the view has turned from home, which the room light follows.
    const offset = this.camera.position.clone().sub(this.controls.target);
    const turn = Math.atan2(offset.x, offset.z) - HOME_AZIMUTH;
    this.lighting.update(hours, turn);
    this.lastLight = { hours, turn };
    this.cube.update(this.lighting.state);
    this.wallIn();
    this.renderer.render(this.scene, this.camera);
  }
}
