import * as THREE from 'three';
import { dotMaterial, glowUniforms, trackPixels } from '../glow';
import { Look, rand } from '../kit';
import type { World, WorldContext, WorldPointerEvent } from '../world';
import { Floor } from './floor';
import { Jelly } from './jelly';
import { A } from './look';
import { Water } from './water';

// An underwater fantasy: a tank of blue water over pale sand, with slate
// rocks, coral and swaying weed, an old pot on its side, and jellyfish that
// drift and pulse through it, glowing softly from within. Light falls in
// shafts from the surface and wanders over the sand; bubbles rise; specks
// drift down. Nothing hurries.
//
// Click a jelly and it glows a little brighter and beats its way upward for
// a few pulses. Click the sand and a string of bubbles rises from it.

/** The jellies, by size: one large, a few middling, a couple of small ones. */
const SIZES = [0.12, 0.095, 0.085, 0.072, 0.062, 0.052];

export class JellyfishTank implements World {
  readonly id = 'jellyfish-tank';
  readonly name = 'Jellyfish Tank';
  cursor = '';
  /** The far side of the tank fades into the blue. */
  readonly haze = { color: new THREE.Color(A.haze.day), near: -1.15, far: 1.45 };

  private readonly look = new Look();
  private readonly uniforms = glowUniforms();
  private ctx!: WorldContext;
  private floor!: Floor;
  private water!: Water;
  private jellies: Jelly[] = [];
  private halos!: THREE.Points;
  private readonly raycaster = new THREE.Raycaster();
  private readonly night = new THREE.Color(A.haze.night);
  private readonly day = new THREE.Color(A.haze.day);
  private ventIn = rand(1, 3);
  private t = 0;

  mount(ctx: WorldContext) {
    this.ctx = ctx;
    this.floor = new Floor(this.look);
    this.water = new Water();
    ctx.root.add(this.floor.group, this.water.group);

    // Spread out to begin with, at different heights.
    SIZES.forEach((r, i) => {
      const a = (i / SIZES.length) * Math.PI * 2 + 0.5;
      const at = new THREE.Vector3(Math.cos(a) * rand(0.12, 0.26), rand(-0.1, 0.24), Math.sin(a) * rand(0.12, 0.26));
      const jelly = new Jelly(r, at, this.uniforms);
      this.jellies.push(jelly);
      ctx.root.add(...jelly.parts);
    });

    // A soft halo of light round each bell.
    const n = this.jellies.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.jellies.map((j) => j.radius * 6.5)), 1));
    geometry.setAttribute('aWander', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    this.halos = new THREE.Points(geometry, dotMaterial(this.uniforms));
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 23;
    trackPixels(this.halos, this.uniforms);
    ctx.root.add(this.halos);

    this.step(0);
  }

  step(dt: number) {
    this.t += dt;
    const daylight = this.ctx.light.daylight;
    this.uniforms.uTime.value = this.t;
    this.uniforms.uIntensity.value = 0.8 + 0.4 * (1 - daylight);
    this.haze.color.copy(this.night).lerp(this.day, daylight);
    // At night the blue closes in, so the sand and rocks sink into it and
    // only what glows stands out.
    this.haze.near = -1.15 - 0.3 * (1 - daylight);
    this.haze.far = 1.45 - 0.1 * (1 - daylight);

    this.floor.update(this.t, daylight);
    this.water.update(this.t, dt, daylight);
    for (const j of this.jellies) j.step(dt, this.t, this.jellies, daylight, this.floor.boulder);

    const pos = this.halos.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.halos.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.jellies.forEach((j, i) => {
      pos.setXYZ(i, j.pos.x, j.pos.y + j.radius * 0.25, j.pos.z);
      const k = (0.4 + 0.35 * (1 - daylight)) * (1 + 0.5 * j.squeeze) + 0.25 * j.excite;
      col.setXYZ(i, j.glow.r * k, j.glow.g * k, j.glow.b * k);
    });
    pos.needsUpdate = col.needsUpdate = true;

    // Now and then a little string of bubbles from the pot or the rocks.
    if (dt > 0 && (this.ventIn -= dt) <= 0) {
      this.ventIn = rand(3, 8);
      const vent = this.floor.vents[Math.random() < 0.65 ? 0 : 1];
      this.water.bubble(vent, Math.floor(rand(3, 8)));
    }
  }

  pointer(e: WorldPointerEvent) {
    this.raycaster.ray.copy(e.ray);
    const hit = this.raycaster.intersectObjects(this.jellies.map((j) => j.bell), false)[0];
    const jelly = hit && this.jellies.find((j) => j.bell === hit.object);
    // Hovering changes nothing but the cursor; only a click wakes a jelly.
    if (e.kind === 'hover' || e.kind === 'leave') {
      this.cursor = jelly && e.kind === 'hover' ? 'pointer' : '';
      return false;
    }
    if (e.kind !== 'click') return false;
    if (jelly) {
      jelly.rouse();
      return true;
    }
    const sand = this.raycaster.intersectObject(this.floor.sand, false)[0];
    if (sand) {
      this.water.bubble(sand.point, 9, 0.01);
      return true;
    }
    return false;
  }

  dispose() {
    this.floor.dispose();
    this.water.dispose();
    for (const j of this.jellies) j.dispose();
    this.halos.geometry.dispose();
    (this.halos.material as THREE.Material).dispose();
  }
}
