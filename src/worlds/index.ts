import { palette } from '../palette';
import type { Backdrop } from '../shell/lighting';
import { JellyfishTank } from './aquarium';
import { HamsterCage } from './hamster';
import { Loft } from './loft';
import { LorenzAttractor } from './lorenz';
import { ForestPond } from './pond';
import type { World } from './world';

// Every world the box can hold. Adding one is a new folder and a line here.

export interface WorldEntry {
  id: string;
  name: string;
  /** Colour for the placeholder card before a thumbnail exists. */
  accent: string;
  /** Behind the box in fullscreen and in a browser, by day and by night. */
  backdrop: Backdrop;
  create(): World;
}

export const WORLDS: WorldEntry[] = [
  {
    id: 'hamster-cage',
    name: 'Hamster Cage',
    accent: palette.peach,
    // Warm wood and cream, a lamp-lit room at night.
    backdrop: { day: ['#E2CBB3', '#C5A68A'], night: ['#3E3A5A', '#5F5675'] },
    create: () => new HamsterCage(),
  },
  {
    id: 'forest-pond',
    name: 'Forest Pond',
    accent: palette.sage,
    // Soft green shade by day, deep blue-green water at night.
    backdrop: { day: ['#BCCBB2', '#8FA58E'], night: ['#1F3238', '#36504D'] },
    create: () => new ForestPond(),
  },
  {
    id: 'lorenz-attractor',
    name: 'Lorenz Attractor',
    accent: palette.night,
    // Slate dusk by day, nearly black space at night, so the glow carries.
    backdrop: { day: ['#6A6F9E', '#4D5280'], night: ['#14152A', '#262947'] },
    create: () => new LorenzAttractor(),
  },
  {
    id: 'jellyfish-tank',
    name: 'Jellyfish Tank',
    accent: palette.dustyBlue,
    // Deep ocean blue by day, nearly black at night, so the glow carries.
    backdrop: { day: ['#26335F', '#18214A'], night: ['#090D22', '#111733'] },
    create: () => new JellyfishTank(),
  },
  {
    id: 'loft',
    name: 'Loft',
    accent: palette.wood,
    // Warm taupe by day, a deep brown dusk at night, like a room lit by lamps.
    backdrop: { day: ['#DCC6AD', '#BFA388'], night: ['#2E2420', '#4A3A31'] },
    create: () => new Loft(),
  },
];
