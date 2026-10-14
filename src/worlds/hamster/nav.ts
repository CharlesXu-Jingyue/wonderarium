import * as THREE from 'three';
import { HAMSTER_R, ROAM } from './scenery';

// Where the hamster's body fits, as a coarse grid over the bedding, and the
// routes between places. Rebuilt whenever furniture moves.

const STEP = 0.02;
const N = Math.floor((2 * ROAM) / STEP) + 1;

export class NavGrid {
  /** Bumped on every rebuild, so routes know when to refresh. */
  version = 0;
  private readonly open = new Uint8Array(N * N);

  constructor(private readonly isFree: (p: THREE.Vector2, margin: number) => boolean) {}

  rebuild() {
    const p = new THREE.Vector2();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) this.open[i * N + j] = this.isFree(this.center(i, j, p), HAMSTER_R) ? 1 : 0;
    }
    this.version++;
  }

  private center(i: number, j: number, out = new THREE.Vector2()) {
    return out.set(-ROAM + i * STEP, -ROAM + j * STEP);
  }

  private cell(p: THREE.Vector2): number {
    const i = THREE.MathUtils.clamp(Math.round((p.x + ROAM) / STEP), 0, N - 1);
    const j = THREE.MathUtils.clamp(Math.round((p.y + ROAM) / STEP), 0, N - 1);
    return i * N + j;
  }

  /** The open cell nearest to p, searching outward a little. */
  private openNear(p: THREE.Vector2): number {
    const c = this.cell(p);
    if (this.open[c]) return c;
    const ci = Math.floor(c / N);
    const cj = c % N;
    for (let r = 1; r <= 8; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N || !this.open[i * N + j]) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = i * N + j;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Breadth-first search; returns the parent array (-1 unvisited, self for start). */
  private search(start: number, goal = -1) {
    const parent = new Int32Array(N * N).fill(-1);
    const queue = new Int32Array(N * N);
    let head = 0;
    let tail = 0;
    parent[start] = start;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      if (c === goal) break;
      const i = Math.floor(c / N);
      const j = c % N;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = ni * N + nj;
          if (!this.open[n] || parent[n] !== -1) continue;
          // No cutting corners between two blocked cells.
          if (di && dj && (!this.open[ni * N + j] || !this.open[i * N + nj])) continue;
          parent[n] = c;
          queue[tail++] = n;
        }
      }
    }
    return parent;
  }

  /** Can all these points reach each other? */
  connected(points: THREE.Vector2[]) {
    const cells = points.map((p) => this.openNear(p));
    if (cells.some((c) => c < 0)) return false;
    const parent = this.search(cells[0]);
    return cells.every((c) => parent[c] !== -1);
  }

  /** Is the straight line between a and b clear for the hamster? */
  private clear(a: THREE.Vector2, b: THREE.Vector2) {
    const d = a.distanceTo(b);
    const steps = Math.ceil(d / (STEP * 0.75));
    const p = new THREE.Vector2();
    for (let k = 1; k < steps; k++) {
      if (!this.open[this.cell(p.lerpVectors(a, b, k / steps))]) return false;
    }
    return true;
  }

  /** A route of waypoints from `from` to `to`, or null if there is none. */
  route(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] | null {
    const start = this.openNear(from);
    const goal = this.openNear(to);
    if (start < 0 || goal < 0) return null;
    const parent = this.search(start, goal);
    if (parent[goal] === -1) return null;
    const cells: number[] = [];
    for (let c = goal; c !== start; c = parent[c]) cells.push(c);
    const raw = cells.reverse().map((c) => this.center(Math.floor(c / N), c % N));
    // End exactly at the target when the hamster fits there, otherwise at
    // the nearest place it does.
    if (this.open[this.cell(to)]) raw.push(to.clone());
    if (raw.length === 0) raw.push(this.center(Math.floor(goal / N), goal % N));
    // Pull the route taut: from each point, jump to the furthest one in sight.
    const out: THREE.Vector2[] = [];
    let at = from.clone();
    let k = 0;
    while (k < raw.length) {
      let far = k;
      for (let m = raw.length - 1; m > k; m--) {
        if (this.clear(at, raw[m])) {
          far = m;
          break;
        }
      }
      out.push(raw[far]);
      at = raw[far];
      k = far + 1;
    }
    return out;
  }
}
