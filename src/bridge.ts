// The shape of window.bits (exposed by electron/preload.cjs), plus a stand-in
// for when the page runs in an ordinary browser, which is handy for previews.

export interface WindowFlags {
  fullscreen: boolean;
  pinned: boolean;
}

export interface Bridge {
  loadState(): Promise<unknown>;
  saveState(state: unknown): Promise<void>;
  window: {
    flags(): Promise<WindowFlags>;
    onFlags(callback: (flags: WindowFlags) => void): () => void;
    setWidth(width: number): void;
    toggleFullscreen(): void;
    setPinned(pinned: boolean): void;
    minimize(): void;
    close(): void;
  };
  screenshots: {
    /** Saves PNG bytes; resolves to the file name, or null. */
    save(bytes: Uint8Array): Promise<string | null>;
    openFolder(): void;
  };
}

declare global {
  interface Window {
    bits?: Bridge;
  }
}

const STORAGE_KEY = 'world-in-a-box/state';

function browserBridge(): Bridge {
  let flags: WindowFlags = { fullscreen: false, pinned: false };
  const listeners = new Set<(f: WindowFlags) => void>();
  const emit = () => listeners.forEach((l) => l(flags));
  document.addEventListener('fullscreenchange', () => {
    flags = { ...flags, fullscreen: !!document.fullscreenElement };
    emit();
  });
  return {
    async loadState() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      } catch {
        return null;
      }
    },
    async saveState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage unavailable; the world simply starts fresh next time
      }
    },
    window: {
      flags: async () => flags,
      onFlags(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      setWidth() {},
      toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      },
      setPinned(pinned) {
        flags = { ...flags, pinned };
        emit();
      },
      minimize() {},
      close() {},
    },
    screenshots: {
      async save(bytes) {
        // In a browser, hand the picture over as a download instead.
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: 'world.png' });
        a.click();
        URL.revokeObjectURL(url);
        return 'world.png';
      },
      openFolder() {},
    },
  };
}

export const bridge: Bridge = window.bits ?? browserBridge();
export const inElectron = !!window.bits;
