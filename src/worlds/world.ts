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

export type WorldPointerKind = 'down' | 'move' | 'up' | 'hover' | 'leave';

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
  /** Advance the simulation by a fixed step of real seconds. */
  step(dt: number): void;
  /** Optional visual interpolation between steps (0..1). */
  render?(alpha: number): void;
  /** Return true when the world used the event, so the camera leaves it alone. */
  pointer?(event: WorldPointerEvent): boolean;
  serialize?(): unknown;
  dispose?(): void;
}
