import { bridge } from '../bridge';
import type { ClockSave } from './clock';

// One small JSON file holds everything worth remembering. Saves are cheap,
// so we save often rather than cleverly.

export interface SaveFile {
  version: 1;
  worldId?: string;
  clock?: ClockSave;
  settings?: { drift?: boolean };
  worlds?: Record<string, unknown>;
  /** Small JPEG data URLs for the worlds panel. */
  thumbs?: Record<string, string>;
}

export async function loadSave(): Promise<SaveFile> {
  const raw = await bridge.loadState().catch(() => null);
  if (raw && typeof raw === 'object' && (raw as SaveFile).version === 1) return raw as SaveFile;
  return { version: 1 };
}

export class Saver {
  private timer?: number;

  constructor(private readonly snapshot: () => SaveFile) {
    window.setInterval(() => this.now(), 10_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.now();
    });
    window.addEventListener('pagehide', () => this.now());
  }

  /** Save shortly, coalescing bursts of changes (dragging a slider, say). */
  soon() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.now(), 600);
  }

  now() {
    window.clearTimeout(this.timer);
    bridge.saveState(this.snapshot()).catch(() => {});
  }
}
