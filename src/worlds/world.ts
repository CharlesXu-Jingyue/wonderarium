import type * as THREE from 'three';
import type { WorldClock } from '../shell/clock';
import type { LightState } from '../shell/lighting';

// The contract between the shell and a world. A world gets its own group in
// cube space (-0.5..0.5 on every axis) and read-only views of time and light.
// It cannot reach the window, the save file or any other world.

export interface WorldContext {
  root: THREE.Group;
  bounds: THREE.Box3;
  clock: Readonly<Pick<WorldClock, 'now' | 'hours' | 'rate' | 'paused'>>;
  light: Readonly<LightState>;
}

/**
 * down/move/up: a press the world claimed (it returned true on 'down').
 * click: a quick press-and-release the world did not claim, so the camera
 * would otherwise ignore it. hover/leave: the pointer moving with no button.
 */
export type WorldPointerKind = 'down' | 'move' | 'up' | 'click' | 'hover' | 'leave';

export interface WorldPointerEvent {
  kind: WorldPointerKind;
  /** Ray from the camera through the pointer, in cube space. */
  ray: THREE.Ray;
  /** Seconds since this press began (0 for hover and down). */
  held: number;
}

export interface World {
  readonly id: string;
  readonly name: string;
  mount(ctx: WorldContext, saved?: unknown): void;
  /**
   * Advance the simulation by a fixed step of real seconds. A step of 0
   * moves nothing but should bring light-dependent looks up to date (the
   * shell does this around a card's picture, which is taken at midday).
   */
  step(dt: number): void;
  /** Optional visual interpolation between steps (0..1). */
  render?(alpha: number): void;
  /** Return true when the world used the event, so the camera leaves it alone. */
  pointer?(event: WorldPointerEvent): boolean;
  /** CSS cursor the world would like over the cube right now ('' for default). */
  readonly cursor?: string;
  /**
   * A haze the world is seen through, like water: things fade toward
   * `color` with distance, from `near` to `far` units past the cube's
   * middle as seen from the camera (negative is nearer). The world may
   * change the colour as it goes.
   */
  readonly haze?: { color: THREE.Color; near: number; far: number };
  serialize?(): unknown;
  dispose?(): void;
}
