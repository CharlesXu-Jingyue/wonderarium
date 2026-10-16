import * as THREE from 'three';
import { dotMaterial, glowUniforms, trackPixels } from '../glow';
import { Look, rand } from '../kit';
import type { World, WorldContext, WorldPointerEvent } from '../world';
import { buildFurniture, MUG } from './furniture';
import { buildLights, type Fixture } from './lights';
import { L } from './look';
import { Plants } from './plants';
import { buildRoom, FLOOR } from './room';

// A loft, warm and lived in: a double-height room with a bedroom on a
// mezzanine, after a reference whose light is mostly hidden. By day the sun
// falls in through the open top; as evening comes the loft's own lights
// come on one by one, LED strips under the stairs, the mezzanine, the sofa
// and the bed, the kitchen shelf, a desk lamp and a globe by the bed, and
// most of what you see of them is the glow they throw. Steam rises from a
// mug on the table, dust drifts in the lamplight, the pothos sways.
//
// Click a lamp, the stairs, the sofa, the bed, the kitchen shelf or the
// mezzanine's edge to switch its light, until its own hours next change.

const MOTES = 70;

export class Loft implements World {
  readonly id = 'loft';
  readonly name = 'Loft';
  cursor = '';

  private readonly look = new Look();
  private ctx!: WorldContext;
  private fixtures: Fixture[] = [];
  private plants!: Plants;
  /**
   * The room's own night light is never dark, which suits a pond but not a
   * home after dark: this takes most of it back at night, so the loft's
   * lamps do the lighting.
   */
  private readonly dusk = new THREE.HemisphereLight('#6E78B0', '#3A3F66', 0);
  /** Lamplight bounced off every wall and floor: warm, and stronger the more lights are on. */
  private readonly bounce = new THREE.AmbientLight(L.glow, 0);
  private readonly uniforms = glowUniforms();
  private readonly steamUniforms = glowUniforms();
  private motes!: THREE.Points;
  private steam!: THREE.Points;
  private readonly steamAge = new Float32Array(8);
  private readonly raycaster = new THREE.Raycaster();
  private t = 0;

  mount(ctx: WorldContext) {
    this.ctx = ctx;
    const look = this.look;
    const lights = buildLights(look);
    this.fixtures = lights.fixtures;
    this.plants = new Plants(look);
    ctx.root.add(buildRoom(look), buildFurniture(look), lights.group, this.plants.group, this.dusk, this.bounce);
    this.motes = this.buildMotes();
    this.steam = this.buildSteam();
    ctx.root.add(this.motes, this.steam);
    this.step(0);
  }

  /** Dust in the air, only really seen where the lamplight catches it. */
  private buildMotes() {
    const pos = new Float32Array(MOTES * 3);
    const col = new Float32Array(MOTES * 3);
    const size = new Float32Array(MOTES);
    const wander = new Float32Array(MOTES * 4);
    const warm = new THREE.Color(L.glow);
    for (let i = 0; i < MOTES; i++) {
      pos.set([rand(-0.4, 0.42), rand(FLOOR + 0.05, 0.4), rand(-0.4, 0.42)], i * 3);
      warm.toArray(col, i * 3);
      size[i] = rand(0.006, 0.012);
      wander.set([rand(0, 6.3), rand(0, 6.3), rand(0, 6.3), rand(0.01, 0.03)], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aWander', new THREE.BufferAttribute(wander, 4));
    const p = new THREE.Points(g, dotMaterial(this.uniforms));
    p.frustumCulled = false;
    p.renderOrder = 20;
    trackPixels(p, this.uniforms);
    return p;
  }

  /** A few soft puffs that rise from the mug, swell and fade, and start again. */
  private buildSteam() {
    const n = this.steamAge.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWander', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    for (let i = 0; i < n; i++) this.steamAge[i] = (i / n) * 4;
    const p = new THREE.Points(g, dotMaterial(this.steamUniforms));
    p.frustumCulled = false;
    p.renderOrder = 21;
    trackPixels(p, this.steamUniforms);
    return p;
  }

  step(dt: number) {
    this.t += dt;
    const { daylight, hours } = this.ctx.light;
    this.dusk.intensity = -1.35 * (1 - daylight);
    for (const f of this.fixtures) f.update(dt, hours, daylight);
    this.plants.update(this.t);
    const lit = this.fixtures.reduce((a, f) => a + f.level, 0) / this.fixtures.length;
    this.bounce.intensity = 0.55 * lit * (1 - daylight);

    // Dust shows most when the lamps are on and the room is dim.
    this.uniforms.uTime.value = this.t;
    this.uniforms.uIntensity.value = 0.12 + 0.45 * lit * (1 - daylight);

    // Steam: each puff rises about four centimetres over four seconds, swelling and fading.
    const pos = this.steam.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.steam.geometry.getAttribute('color') as THREE.BufferAttribute;
    const size = this.steam.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    this.steamUniforms.uIntensity.value = 0.5;
    for (let i = 0; i < this.steamAge.length; i++) {
      const age = (this.steamAge[i] = (this.steamAge[i] + dt) % 4);
      const u = age / 4;
      pos.setXYZ(i, MUG[0] + 0.004 * Math.sin(age * 2.1 + i), MUG[1] + 0.005 + u * 0.045, MUG[2] + 0.004 * Math.cos(age * 1.7 + i * 2));
      const fade = Math.sin(Math.PI * u) * 0.35;
      col.setXYZ(i, fade, fade, fade * 0.98);
      size.setX(i, 0.012 + u * 0.03);
    }
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }

  pointer(e: WorldPointerEvent) {
    this.raycaster.ray.copy(e.ray);
    const handles = this.fixtures.flatMap((f) => f.handles);
    const hit = this.raycaster.intersectObjects(handles, false)[0];
    const fixture = hit && this.fixtures.find((f) => f.handles.includes(hit.object));
    if (e.kind === 'hover' || e.kind === 'leave') {
      this.cursor = fixture && e.kind === 'hover' ? 'pointer' : '';
      return false;
    }
    if (e.kind !== 'click' || !fixture) return false;
    fixture.toggle();
    return true;
  }

  dispose() {
    for (const p of [this.motes, this.steam]) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.plants.dispose();
  }
}
