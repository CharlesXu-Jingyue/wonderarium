import { bridge, type WindowFlags } from '../bridge';
import type { WorldEntry } from '../worlds';
import type { WorldClock } from './clock';

// The controls that appear when you hover: worlds on the left, time and
// window buttons at the top right (drag that pill to move the window),
// round tools along the bottom, and a corner to resize.

const stroke = (d: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const icons = {
  sun: stroke('<circle cx="10" cy="10" r="3.4"/><path d="M10 2.2v1.9M10 15.9v1.9M2.2 10h1.9M15.9 10h1.9M4.5 4.5l1.3 1.3M14.2 14.2l1.3 1.3M4.5 15.5l1.3-1.3M14.2 5.8l1.3-1.3"/>'),
  moon: stroke('<path d="M15.8 12.6A6.4 6.4 0 0 1 7.4 4.2a6.4 6.4 0 1 0 8.4 8.4Z"/>'),
  minimize: stroke('<path d="M4.5 10h11"/>'),
  expand: stroke('<rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/>'),
  shrink: stroke('<path d="M8 4.5V8H4.5M12 4.5V8h3.5M8 15.5V12H4.5M12 15.5V12h3.5"/>'),
  close: stroke('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
  view: stroke('<path d="M4.2 8.4A6.2 6.2 0 0 1 15.6 7"/><path d="M15.9 3.8V7.2h-3.4"/><path d="M15.8 11.6A6.2 6.2 0 0 1 4.4 13"/><path d="M4.1 16.2v-3.4h3.4"/>'),
  pause: stroke('<path d="M7.3 5v10M12.7 5v10"/>'),
  play: stroke('<path d="M7 4.8v10.4l8.2-5.2Z"/>'),
  camera: stroke('<path d="M3.5 7.2c0-.9.7-1.6 1.6-1.6h1.8l1.3-1.8h3.6l1.3 1.8h1.8c.9 0 1.6.7 1.6 1.6v7c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6Z"/><circle cx="10" cy="10.6" r="2.7"/>'),
  gear: stroke('<path d="M8.6 2.8h2.8l.4 2 1.4.8 1.9-.7 1.4 2.4-1.5 1.3v1.6l1.5 1.3-1.4 2.4-1.9-.7-1.4.8-.4 2H8.6l-.4-2-1.4-.8-1.9.7-1.4-2.4 1.5-1.3V9.2L3.5 7.9l1.4-2.4 1.9.7 1.4-.8Z"/><circle cx="10" cy="10" r="2.4"/>'),
};

export interface ChromeHooks {
  clock: WorldClock;
  daylight(): number;
  worlds: WorldEntry[];
  activeWorld(): string;
  thumbnail(id: string): string | undefined;
  selectWorld(id: string): void;
  resetView(): void;
  screenshot(): Promise<string | null>;
  drift: { get(): boolean; set(on: boolean): void };
  changed(): void;
}

const HIDE_AFTER_MS = 2200;
/** How long an open panel waits once the pointer has wandered off it. */
const PANEL_LINGER_MS = 2500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const fmtOffset = (hours: number) => {
  if (Math.abs(hours) < 1 / 60) return '0h';
  const sign = hours > 0 ? '+' : '−';
  const h = Math.floor(Math.abs(hours));
  const m = Math.round((Math.abs(hours) - h) * 60);
  return m ? `${sign}${h}:${String(m).padStart(2, '0')}` : `${sign}${h}h`;
};

export class Chrome {
  private flags: WindowFlags = { fullscreen: false, pinned: false };
  private hideTimer?: number;
  private toastTimer?: number;
  private busy = false; // resizing; keep the chrome up
  private readonly app = $('app');
  private readonly popovers = [$('time-panel'), $('settings-panel')];

  constructor(private readonly hooks: ChromeHooks) {
    $('min-btn').innerHTML = icons.minimize;
    $('close-btn').innerHTML = icons.close;
    $('view-btn').innerHTML = icons.view;
    $('shot-btn').innerHTML = icons.camera;
    $('settings-btn').innerHTML = icons.gear;

    this.wireVisibility();
    this.wireWindow();
    this.wireTools();
    this.wireTimePanel();
    this.wireSettings();
    this.wireResize();
    this.renderWorlds();

    bridge.window.flags().then((f) => this.applyFlags(f));
    bridge.window.onFlags((f) => this.applyFlags(f));
    this.refresh();
  }

  // ---------- show on hover, fade when idle ----------

  private wireVisibility() {
    let leaving = 0;
    const wake = () => {
      window.clearTimeout(leaving);
      this.app.classList.add('awake');
      window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => this.sleep(), HIDE_AFTER_MS);
    };
    // The page also hears the pointer "leave" when it moves onto a drag
    // region (a bare part of a panel), where it hears nothing more. So ask
    // the window: still inside, keep the controls up and ask again shortly;
    // really gone, put them away.
    const left = async () => {
      window.clearTimeout(leaving);
      if (await bridge.window.cursorInside()) {
        window.clearTimeout(this.hideTimer);
        leaving = window.setTimeout(left, 400);
      } else {
        this.sleep(true);
      }
    };
    document.addEventListener('pointermove', wake);
    document.addEventListener('pointerdown', wake);
    // A finger scrolling the worlds sends no pointer moves once the scroll
    // takes over, so scrolling itself keeps the controls up.
    document.addEventListener('scroll', wake, { capture: true, passive: true });
    document.documentElement.addEventListener('mouseleave', () => void left());

    // An open panel stays while the pointer is on it or on the button that
    // opened it, and closes by itself once the pointer has been elsewhere a
    // little while (or is busy with something it is dragging).
    let nearPanel = 0;
    const near = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.popover, #time-btn, #settings-btn')) nearPanel = performance.now();
    };
    document.addEventListener('pointermove', near);
    document.addEventListener('pointerdown', near);
    window.setInterval(() => {
      if (this.busy) nearPanel = performance.now();
      if (this.anyPopoverOpen() && performance.now() - nearPanel > PANEL_LINGER_MS) this.closePopovers();
    }, 300);
  }

  private anyPopoverOpen() {
    return this.popovers.some((p) => !p.hidden);
  }

  private sleep(force = false) {
    const hovering = !!document.querySelector('#chrome > *:hover');
    if (this.busy || (!force && (hovering || this.anyPopoverOpen()))) {
      this.hideTimer = window.setTimeout(() => this.sleep(), HIDE_AFTER_MS);
      return;
    }
    this.closePopovers();
    this.app.classList.remove('awake');
  }

  private closePopovers() {
    for (const p of this.popovers) p.hidden = true;
    $('settings-btn').classList.remove('on');
    $('time-btn').classList.remove('on');
  }

  private toggle(panel: HTMLElement, button: HTMLElement) {
    const open = panel.hidden === true;
    this.closePopovers();
    panel.hidden = !open;
    button.classList.toggle('on', open);
    this.refresh();
  }

  // ---------- window ----------

  private wireWindow() {
    $('min-btn').addEventListener('click', () => bridge.window.minimize());
    $('fs-btn').addEventListener('click', () => bridge.window.toggleFullscreen());
    $('close-btn').addEventListener('click', () => bridge.window.close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.anyPopoverOpen()) this.closePopovers();
      else if (this.flags.fullscreen) bridge.window.toggleFullscreen();
    });
    // Clicking into the cube closes any open panel.
    $('stage').addEventListener('pointerdown', () => this.closePopovers());
  }

  private applyFlags(flags: WindowFlags) {
    this.flags = flags;
    document.body.classList.toggle('fullscreen', flags.fullscreen);
    const fs = $('fs-btn');
    fs.innerHTML = flags.fullscreen ? icons.shrink : icons.expand;
    fs.title = flags.fullscreen ? 'Exit fullscreen' : 'Fullscreen';
    $<HTMLInputElement>('pin-toggle').checked = flags.pinned;
  }

  // ---------- worlds ----------

  renderWorlds() {
    const list = $('world-list');
    list.replaceChildren();
    for (const w of this.hooks.worlds) {
      const card = document.createElement('button');
      card.className = 'world-card';
      card.classList.toggle('active', w.id === this.hooks.activeWorld());
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      const src = this.hooks.thumbnail(w.id);
      thumb.style.backgroundImage = src
        ? `url(${src})`
        : `radial-gradient(circle at 50% 60%, ${w.accent}, #e9ddd0 75%)`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = w.name;
      card.append(thumb, name);
      card.addEventListener('click', () => {
        if (w.id === this.hooks.activeWorld()) return;
        this.hooks.selectWorld(w.id);
        this.renderWorlds();
      });
      list.append(card);
    }
    const soon = document.createElement('div');
    soon.className = 'world-card soon';
    soon.title = 'More worlds to come';
    soon.textContent = '•••';
    list.append(soon);
  }

  // ---------- tools ----------

  private wireTools() {
    $('view-btn').addEventListener('click', () => this.hooks.resetView());
    $('pause-btn').addEventListener('click', () => {
      this.hooks.clock.setPaused(!this.hooks.clock.paused);
      this.changed();
    });
    $('shot-btn').addEventListener('click', async () => {
      const name = await this.hooks.screenshot();
      this.toast(name ? 'Screenshot saved' : 'Could not save the screenshot');
    });
    $('settings-btn').addEventListener('click', () => this.toggle($('settings-panel'), $('settings-btn')));
  }

  private toast(text: string) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- settings ----------

  private wireSettings() {
    const pin = $<HTMLInputElement>('pin-toggle');
    pin.addEventListener('change', () => bridge.window.setPinned(pin.checked));
    const drift = $<HTMLInputElement>('drift-toggle');
    drift.checked = this.hooks.drift.get();
    drift.addEventListener('change', () => {
      this.hooks.drift.set(drift.checked);
      this.changed();
    });
    $('shots-folder').addEventListener('click', () => bridge.screenshots.openFolder());
  }

  // ---------- time ----------

  private wireTimePanel() {
    $('time-btn').addEventListener('click', () => this.toggle($('time-panel'), $('time-btn')));
    const shift = $<HTMLInputElement>('shift');
    shift.addEventListener('input', () => {
      this.hooks.clock.setOffsetHours(Number(shift.value));
      this.changed();
    });
    document.querySelectorAll<HTMLButtonElement>('.speeds button').forEach((b) =>
      b.addEventListener('click', () => {
        this.hooks.clock.setRate(Number(b.dataset.rate));
        this.changed();
      }),
    );
    $('sync-btn').addEventListener('click', () => {
      this.hooks.clock.syncToReal();
      this.changed();
    });
  }

  private changed() {
    this.refresh();
    this.hooks.changed();
  }

  /** Called a few times a second to keep the readouts current. */
  refresh() {
    const c = this.hooks.clock;
    const time = fmtTime(c.now);
    $('time-label').textContent = time;
    $('time-btn').classList.toggle('shifted', !c.isReal);
    const sky = this.hooks.daylight() > 0.5 ? icons.sun : icons.moon;
    const skyIcon = $('sky-icon');
    if (skyIcon.innerHTML !== sky) skyIcon.innerHTML = sky;

    const pause = $('pause-btn');
    const pauseIcon = c.paused ? icons.play : icons.pause;
    if (pause.innerHTML !== pauseIcon) pause.innerHTML = pauseIcon;
    pause.title = c.paused ? 'Resume' : 'Pause';
    pause.classList.toggle('on', c.paused);

    if ($('time-panel').hidden) return;
    const offsetHours = c.offsetMs / 3_600_000;
    $('panel-time').textContent = time;
    const parts = [];
    if (c.paused) parts.push('paused');
    if (Math.abs(offsetHours) >= 1 / 60) parts.push(fmtOffset(offsetHours));
    if (c.rate !== 1) parts.push(`${c.rate}×`);
    $('panel-status').textContent = parts.length ? parts.join(' · ') : 'real time';
    const shift = $<HTMLInputElement>('shift');
    if (document.activeElement !== shift) shift.value = String(Math.round(offsetHours * 4) / 4);
    $('shift-out').textContent = fmtOffset(Number(shift.value));
    document.querySelectorAll<HTMLButtonElement>('.speeds button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.rate) === c.rate),
    );
  }

  // ---------- resize corner ----------

  private wireResize() {
    const corner = $('resize');
    let start: { width: number; aspect: number; x: number; y: number } | null = null;
    let pending = 0;
    corner.addEventListener('pointerdown', (e) => {
      corner.setPointerCapture(e.pointerId);
      start = { width: window.innerWidth, aspect: window.innerWidth / window.innerHeight, x: e.screenX, y: e.screenY };
      this.busy = true;
    });
    corner.addEventListener('pointermove', (e) => {
      if (!start) return;
      // Follow whichever direction the pointer moved further, keeping the shape.
      const d = Math.max(e.screenX - start.x, (e.screenY - start.y) * start.aspect);
      const width = start.width + d;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => bridge.window.setWidth(width));
    });
    const end = () => {
      start = null;
      this.busy = false;
    };
    corner.addEventListener('pointerup', end);
    corner.addEventListener('pointercancel', end);
  }
}
