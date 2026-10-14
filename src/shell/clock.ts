// The world clock follows your local time unless you ask otherwise. You can
// shift it (so it is evening in the box during your afternoon), speed it up,
// pause it, or snap it back to real time.

export interface ClockSave {
  offsetMs: number;
  rate: number;
  paused: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class WorldClock {
  rate = 1;
  paused = false;
  private anchorReal = Date.now();
  private anchorSim = Date.now();

  constructor(saved?: Partial<ClockSave>) {
    if (saved) {
      this.anchorSim = this.anchorReal + (saved.offsetMs ?? 0);
      this.rate = saved.rate ?? 1;
      this.paused = saved.paused ?? false;
    }
  }

  /** Simulated wall-clock time, in epoch milliseconds. */
  get now(): number {
    if (this.paused) return this.anchorSim;
    return this.anchorSim + (Date.now() - this.anchorReal) * this.rate;
  }

  /** Local time of day in the box, 0 to 24. */
  get hours(): number {
    const d = new Date(this.now);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  /** How far the box is from real time, wrapped to (-12h, 12h]. */
  get offsetMs(): number {
    const r = (((this.now - Date.now()) % DAY) + DAY) % DAY;
    return r > DAY / 2 ? r - DAY : r;
  }

  get isReal(): boolean {
    return !this.paused && this.rate === 1 && Math.abs(this.offsetMs) < 60_000;
  }

  private reanchor(sim = this.now) {
    this.anchorSim = sim;
    this.anchorReal = Date.now();
  }

  setRate(rate: number) {
    this.reanchor();
    this.rate = rate;
  }

  setPaused(paused: boolean) {
    this.reanchor();
    this.paused = paused;
  }

  /** Place the box at real time plus the given number of hours. */
  setOffsetHours(hours: number) {
    this.reanchor(Date.now() + hours * HOUR);
  }

  syncToReal() {
    this.rate = 1;
    this.paused = false;
    this.reanchor(Date.now());
  }

  save(): ClockSave {
    return { offsetMs: this.now - Date.now(), rate: this.rate, paused: this.paused };
  }
}
