import { palette } from '../palette';
import { HamsterCage } from './hamster';
import type { World } from './world';

// Every world the box can hold. Adding one is a new folder and a line here.

export interface WorldEntry {
  id: string;
  name: string;
  /** Colour for the placeholder card before a thumbnail exists. */
  accent: string;
  create(): World;
}

export const WORLDS: WorldEntry[] = [
  { id: 'hamster-cage', name: 'Hamster Cage', accent: palette.peach, create: () => new HamsterCage() },
];
