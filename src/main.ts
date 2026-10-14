import * as THREE from 'three';
import { bridge, inElectron } from './bridge';
import { Chrome } from './shell/chrome';
import { WorldClock } from './shell/clock';
import { INNER_BOUNDS } from './shell/cube';
import { loadSave, Saver, type SaveFile } from './shell/persist';
import { Stage } from './shell/stage';
import { WORLDS } from './worlds';
import type { World } from './worlds/world';

// Wires the shell together and runs the loop: a fixed simulation step for
// the world, one render per animation frame.

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // after a long pause, don't try to catch up
const THUMB_AFTER = 3; // seconds into a world before its card picture is taken
const THUMB_EVERY = 120; // then refreshed now and then, so it follows the sky

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of [o.material].flat()) m.dispose();
    }
  });
  root.clear();
}

async function start() {
  if (!inElectron) {
    // In a browser tab the window can't be dragged or closed; see styles.css.
    document.body.classList.add('browser');
    document.getElementById('topbar')?.removeAttribute('title');
  }
  const save = await loadSave();
  save.worlds ??= {};
  save.thumbs ??= {};
  const clock = new WorldClock(save.clock);
  const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement);
  stage.drift = save.settings?.drift ?? true;

  let world!: World;
  let thumbIn = THUMB_AFTER; // seconds until the next card picture
  const mount = (id: string | undefined) => {
    const entry = WORLDS.find((w) => w.id === id) ?? WORLDS[0];
    world = entry.create();
    world.mount(
      { root: stage.worldRoot, bounds: INNER_BOUNDS, clock, light: stage.lighting.state },
      save.worlds![world.id],
    );
    stage.setWorld(world);
    thumbIn = THUMB_AFTER;
  };
  const unmount = () => {
    save.worlds![world.id] = world.serialize?.();
    world.dispose?.();
    stage.setWorld(undefined);
    disposeTree(stage.worldRoot);
  };
  mount(save.worldId);
  // In a plain browser preview, leave a handle for poking at things.
  if (!inElectron) Object.assign(window, { __box: { stage, clock, world: () => world } });

  const snapshot = (): SaveFile => ({
    version: 1,
    worldId: world.id,
    clock: clock.save(),
    settings: { drift: stage.drift },
    worlds: { ...save.worlds, [world.id]: world.serialize?.() },
    thumbs: save.thumbs,
  });
  const saver = new Saver(snapshot);

  const chrome = new Chrome({
    clock,
    daylight: () => stage.lighting.state.daylight,
    worlds: WORLDS,
    activeWorld: () => world.id,
    thumbnail: (id) => save.thumbs![id],
    selectWorld: (id) => {
      unmount();
      mount(id);
      saver.soon();
    },
    resetView: () => stage.resetView(),
    screenshot: async () => {
      const canvas = stage.capture();
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) return null;
      return bridge.screenshots.save(new Uint8Array(await blob.arrayBuffer()));
    },
    drift: {
      get: () => stage.drift,
      set: (on) => { stage.drift = on; },
    },
    changed: () => saver.soon(),
  });
  window.setInterval(() => chrome.refresh(), 250);

  // Fullscreen backdrop follows the sky.
  const rootStyle = document.documentElement.style;
  let backdropTick = 0;

  let last = performance.now();
  let acc = 0;
  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, MAX_FRAME);
    last = t;
    if (!clock.paused) {
      acc += dt;
      while (acc >= STEP) {
        world.step(STEP);
        acc -= STEP;
      }
    }
    world.render?.(acc / STEP);
    stage.render(dt, clock.hours);

    // Take the world's card picture once it has settled in, then refresh it.
    if ((thumbIn -= dt) <= 0) {
      thumbIn = THUMB_EVERY;
      const backdrop = `#${stage.lighting.backdrop.bottom.getHexString()}`;
      save.thumbs![world.id] = stage
        .capture({ width: 224, height: 160, scale: 0.92, background: backdrop })
        .toDataURL('image/jpeg', 0.82);
      chrome.renderWorlds();
      saver.soon();
    }

    if ((backdropTick += dt) > 1) {
      backdropTick = 0;
      rootStyle.setProperty('--backdrop-top', `#${stage.lighting.backdrop.top.getHexString()}`);
      rootStyle.setProperty('--backdrop-bottom', `#${stage.lighting.backdrop.bottom.getHexString()}`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
