import * as THREE from 'three';
import { glassHit } from '../kit';
import type { World, WorldContext, WorldPointerEvent } from '../world';
import { HOLD, Hamster, type Cage, type HamsterSave, type Treat } from './brain';
import { Effects } from './effects';
import { NavGrid } from '../nav';
import { C, cheerio, Look, rand } from './look';
import {
  Bottle, Bowl, buildBedding, buildTray, Cheese, Furniture, GROUND, HAMSTER_R, House, Log, ROAM, TRAY, Wheel,
  type Capsule, type FurnitureId,
} from './scenery';

// The hamster cage: scenery, a hamster with a mind of its own, and the ways
// you can play with it. Click the bedding to drop a cheerio, tap the
// glass to startle it, rest the pointer on it to pet it, drag it to
// pick it up (a quick click is a boop), drag furniture to rearrange, and
// tap the house to knock (which wakes a sleeping hamster).
// Clicks that see through to the bedding drop cheerios; clicks on empty glass
// (where you would see out through a far wall) tap it.

interface CageSave {
  /** Bumped when the layout or scale changes enough that old saves no longer fit. */
  v?: number;
  furniture?: Partial<Record<FurnitureId, [number, number, number]>>;
  hamster?: HamsterSave;
}

const LAYOUT: Record<FurnitureId, [number, number, number]> = {
  wheel: [-0.27, 0.1, -0.2],
  house: [0, -0.27, 0],
  bowl: [0.3, 0.22, 0],
  log: [-0.04, 0.37, 0],
  cheese: [0.38, 0.38, 0.4],
};

const MAX_TREATS = 8;
const SAVE_VERSION = 3;

function pointToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = abx * abx + aby * aby;
  const t = len === 0 ? 0 : THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function capsuleGap(c: Capsule, d: Capsule) {
  // Short segments, so sampling one against the other is plenty.
  let min = Infinity;
  const p = new THREE.Vector2();
  for (let i = 0; i <= 4; i++) {
    min = Math.min(min, pointToSegment(p.lerpVectors(c.a, c.b, i / 4), d.a, d.b));
    min = Math.min(min, pointToSegment(p.lerpVectors(d.a, d.b, i / 4), c.a, c.b));
  }
  return min - c.r - d.r;
}

type Drag =
  | { kind: 'hamster'; start: THREE.Vector3; lifted: boolean }
  | { kind: 'furniture'; f: Furniture; offset: THREE.Vector2; start: THREE.Vector3; moved: boolean };

export class HamsterCage implements World {
  readonly id = 'hamster-cage';
  readonly name = 'Hamster Cage';
  cursor = '';

  private readonly look = new Look();
  private ctx!: WorldContext;
  private furniture: Furniture[] = [];
  private wheel!: Wheel;
  private house!: House;
  private bowl!: Bowl;
  private bottle!: Bottle;
  private hamster!: Hamster;
  private fx!: Effects;
  private readonly treats: Treat[] = [];
  private drag: Drag | null = null;
  private readonly viewer = new THREE.Vector2(2, 2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly nav = new NavGrid(ROAM, 0.02, (p) => this.isFree(p, HAMSTER_R));

  mount(ctx: WorldContext, raw?: unknown) {
    this.ctx = ctx;
    const loaded = (raw && typeof raw === 'object' ? raw : {}) as CageSave;
    const saved = loaded.v === SAVE_VERSION ? loaded : {};
    const root = ctx.root;
    buildTray(root, this.look);
    buildBedding(root, this.look);

    this.wheel = new Wheel(this.look);
    this.house = new House(this.look);
    this.bowl = new Bowl(this.look);
    this.furniture = [this.wheel, this.house, this.bowl, new Log(this.look), new Cheese(this.look)];
    for (const f of this.furniture) {
      f.place(...LAYOUT[f.id]);
      f.group.userData.pick = f.id;
      root.add(f.group);
    }
    // Restore the saved layout piece by piece, keeping only what still fits.
    for (const f of this.furniture) {
      const at = saved.furniture?.[f.id];
      if (!at || at.some((n) => !Number.isFinite(n))) continue;
      const before: [number, number, number] = [f.x, f.z, f.yaw];
      f.place(...at);
      if (!this.valid()) f.place(...before);
    }

    this.bottle = new Bottle(this.look);
    this.fx = new Effects(this.look);
    root.add(this.bottle.group, this.fx.group);
    if (!this.valid()) console.warn('Hamster cage: the layout breaks its own rules.');

    const cage: Cage = {
      bowl: this.bowl,
      wheel: this.wheel,
      house: this.house,
      bottle: this.bottle,
      fx: this.fx,
      treats: this.treats,
      obstacles: () => this.furniture.map((f) => f.capsule()),
      route: (from, to) => this.nav.route(from, to),
      navVersion: () => this.nav.version,
      isFree: (p, margin) => this.isFree(p, margin),
      eatTreat: (t) => this.removeTreat(t),
      daylight: () => this.ctx.light.daylight,
      viewer: () => this.viewer,
    };
    this.hamster = new Hamster(cage, this.look, saved.hamster);
    this.hamster.model.root.userData.pick = 'hamster';
    root.add(this.hamster.model.root);
  }

  step(dt: number) {
    const night = 1 - this.ctx.light.daylight;
    for (const f of this.furniture) f.update(dt, night);
    this.updateTreats(dt);
    this.hamster.step(dt);
    this.fx.update(dt);
  }

  serialize(): CageSave {
    const furniture: CageSave['furniture'] = {};
    for (const f of this.furniture) furniture[f.id] = [f.x, f.z, f.yaw];
    return { v: SAVE_VERSION, furniture, hamster: this.hamster.save() };
  }

  dispose() {
    this.fx.dispose();
  }

  // ---------- layout rules ----------

  private isFree(p: THREE.Vector2, margin: number) {
    return this.furniture.every((f) => {
      const c = f.capsule();
      return pointToSegment(p, c.a, c.b) > c.r + margin;
    });
  }

  /**
   * Everything inside the tray, nothing overlapping, and every place the
   * hamster needs (doorway, wheel, bowl, bottle, where it stands now) free
   * and reachable from every other. Leaves the nav grid matching the layout.
   */
  private valid() {
    const caps = this.furniture.map((f) => f.capsule());
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      for (const end of [c.a, c.b]) {
        if (Math.abs(end.x) + c.r > TRAY - 0.004 || Math.abs(end.y) + c.r > TRAY - 0.004) return false;
      }
      for (let j = i + 1; j < caps.length; j++) if (capsuleGap(c, caps[j]) < 0.006) return false;
    }
    const usable = (p: THREE.Vector2) => Math.abs(p.x) <= ROAM && Math.abs(p.y) <= ROAM && this.isFree(p, HAMSTER_R - 0.005);
    const spots = this.furniture.flatMap((f) => f.access.map((a) => f.toWorld(a.x, a.y)));
    if (this.bottle) spots.push(this.bottle.stand);
    if (!spots.every(usable)) return false;
    this.nav.rebuild();
    const h = this.hamster;
    if (h?.grounded) spots.push(h.pos.clone());
    if (!this.nav.connected(spots)) return false;
    // The bowl can be eaten from any side, so one open, reachable side will do.
    const reach = this.bowl.r + HAMSTER_R + 0.01;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const side = new THREE.Vector2(this.bowl.x + Math.cos(a) * reach, this.bowl.z + Math.sin(a) * reach);
      if (usable(side) && this.nav.connected([...spots, side])) return true;
    }
    return false;
  }

  private tryMove(f: Furniture, x: number, z: number) {
    const ox = f.x;
    const oz = f.z;
    for (const [nx, nz] of [[x, z], [x, oz], [ox, z]]) {
      f.place(nx, nz);
      if (this.valid()) return;
    }
    f.place(ox, oz);
    this.nav.rebuild();
  }

  // ---------- treats ----------

  private dropTreat(at: THREE.Vector2) {
    if (this.treats.length >= MAX_TREATS) return;
    // Nudge it off any furniture so it lands on open bedding.
    for (let i = 0; i < 20 && !this.isFree(at, 0.02); i++) {
      at.set(at.x + rand(-0.06, 0.06), at.y + rand(-0.06, 0.06));
    }
    at.clampScalar(-TRAY + 0.03, TRAY - 0.03);
    const oat = new THREE.Mesh(cheerio(), this.look.mat(C.cheerio));
    oat.scale.setScalar(0.009);
    oat.position.set(at.x, 0.4, at.y);
    oat.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    oat.castShadow = true;
    this.ctx.root.add(oat);
    this.treats.push({ mesh: oat, vy: 0, landed: false });
  }

  private removeTreat(t: Treat) {
    const i = this.treats.indexOf(t);
    if (i >= 0) this.treats.splice(i, 1);
    this.ctx.root.remove(t.mesh);
    t.mesh.geometry.dispose();
  }

  private updateTreats(dt: number) {
    const floor = GROUND + 0.006;
    for (const t of this.treats) {
      if (t.landed) continue;
      t.vy -= 1.8 * dt;
      t.mesh.position.y += t.vy * dt;
      t.mesh.rotation.x += dt * 6;
      t.mesh.rotation.z += dt * 4;
      if (t.mesh.position.y <= floor) {
        t.mesh.position.y = floor;
        if (t.vy < -0.4) {
          t.vy = -t.vy * 0.25;
        } else {
          t.landed = true;
          // Settle flat on the bedding, a little askew.
          t.mesh.rotation.set(Math.PI / 2 + rand(-0.15, 0.15), 0, rand(0, Math.PI * 2));
          this.hamster.noticeTreat();
        }
      }
    }
  }

  // ---------- pointer ----------

  private pick(ray: THREE.Ray): 'hamster' | Furniture | null {
    this.raycaster.set(ray.origin, ray.direction);
    const targets: THREE.Object3D[] = this.furniture.map((f) => f.group);
    if (this.hamster.reachable) targets.push(this.hamster.model.root);
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.pick) o = o.parent;
      if (!o) continue;
      if (o.userData.pick === 'hamster') return 'hamster';
      return this.furniture.find((f) => f.id === o!.userData.pick) ?? null;
    }
    return null;
  }

  private onPlane(ray: THREE.Ray, y: number) {
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit;
  }

  pointer(e: WorldPointerEvent): boolean {
    this.viewer.set(e.ray.origin.x, e.ray.origin.z);
    switch (e.kind) {
      case 'hover': {
        const hit = this.pick(e.ray);
        this.hamster.petting = hit === 'hamster';
        this.cursor = hit ? 'grab' : '';
        return false;
      }
      case 'leave':
        this.hamster.petting = false;
        this.cursor = '';
        return false;

      case 'down': {
        const hit = this.pick(e.ray);
        if (!hit) return false;
        this.hamster.petting = false;
        this.cursor = 'grabbing';
        if (hit === 'hamster') {
          const start = this.onPlane(e.ray, GROUND + HOLD) ?? new THREE.Vector3();
          this.drag = { kind: 'hamster', start, lifted: false };
        } else {
          const p = this.onPlane(e.ray, GROUND) ?? new THREE.Vector3(hit.x, 0, hit.z);
          this.drag = { kind: 'furniture', f: hit, offset: new THREE.Vector2(hit.x - p.x, hit.z - p.z), start: p, moved: false };
        }
        return true;
      }

      case 'move': {
        const d = this.drag;
        if (!d) return false;
        if (d.kind === 'hamster') {
          const p = this.onPlane(e.ray, GROUND + HOLD);
          if (!p) return true;
          if (!d.lifted && (p.distanceTo(d.start) > 0.012 || e.held > 0.25)) {
            d.lifted = true;
            this.hamster.pickUp();
          }
          if (this.hamster.holding) this.hamster.holdAt.set(p.x, p.z);
        } else {
          const p = this.onPlane(e.ray, GROUND);
          // A press that barely moves is a tap, not a drag.
          if (p && (d.moved || p.distanceTo(d.start) > 0.012)) {
            d.moved = true;
            this.tryMove(d.f, p.x + d.offset.x, p.z + d.offset.y);
          }
        }
        return true;
      }

      case 'up': {
        const d = this.drag;
        this.drag = null;
        this.cursor = 'grab';
        if (d?.kind === 'hamster') {
          if (d.lifted) this.hamster.drop();
          else this.hamster.boop();
        } else if (d && !d.moved && e.held < 0.4 && d.f === this.house) {
          // A tap on the house is a knock at the door.
          this.house.knock();
          this.hamster.knock();
        }
        return true;
      }

      case 'click': {
        // If the line of sight reaches the bedding inside the cube, the click
        // was on the floor: drop a cheerio there. If it would leave through a
        // far wall first, it was on empty glass: tap.
        const floor = this.onPlane(e.ray, GROUND);
        if (floor && Math.abs(floor.x) < TRAY && Math.abs(floor.z) < TRAY) {
          this.dropTreat(new THREE.Vector2(floor.x, floor.z));
          return true;
        }
        const glass = glassHit(e.ray);
        if (!glass) return false;
        this.fx.ripple(glass.at, glass.normal);
        this.hamster.startle();
        return true;
      }
    }
    return false;
  }
}
