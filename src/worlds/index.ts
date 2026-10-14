import { palette } from '../palette';
import { StillLife } from './still-life';
import type { World } from './world';

// Every world the box can hold. Adding one is a new file and a line here.

export interface WorldEntry {
  id: string;
  name: string;
  /** Colour for the placeholder card before a thumbnail exists. */
  accent: string;
  create(): World;
}

export const WORLDS: WorldEntry[] = [
  { id: 'still-life', name: 'Still Life', accent: palette.sage, create: () => new StillLife() },
];
