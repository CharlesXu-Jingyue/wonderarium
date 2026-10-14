import * as THREE from 'three';

// Colours for the hamster cage, after the visual reference: warm wood,
// cream bedding and a peach hamster. The shared kit is passed through here.

export const C = {
  trayWood: '#D9A46C',
  trayWoodLight: '#E3B47E',
  trayDark: '#B98250',
  bedding: '#EBD3A8',
  chips: ['#F6E6C8', '#EED7AE', '#E7CB98', '#F9EEDA', '#E2BF8A', '#F1DDB6'],
  wheel: '#D69B5E',
  wheelLight: '#E2AE73',
  wheelDark: '#B47A43',
  house: '#E6B880',
  houseGroove: '#C8955E',
  roof: '#C98D55',
  roofLight: '#D59C62',
  doorway: '#4A3226',
  glow: '#FFB866',
  fur: '#E9A465',
  cream: '#FFF3E2',
  pink: '#EFA7A0',
  eye: '#2A201C',
  bowl: '#F2EBDF',
  water: '#8FC1E0',
  glass: '#EEF6FB',
  cap: '#E9DCC8',
  metal: '#B9BCC2',
  cheerio: '#DC9A3A',
  kibble: ['#8E6A45', '#C98B4E', '#7FA25A', '#E3B15F', '#A7744A', '#D9C49A'],
  bark: '#A4703F',
  logInner: '#E7C08C',
  logHole: '#5A3E28',
  cheese: '#F2D27A',
  cheeseHole: '#D9B45A',
} as const;

export { Look, mesh, pick, rand } from '../kit';

/** A little oat ring, the treat you drop: a chunky low-poly torus, radius 1. */
export function cheerio() {
  return new THREE.TorusGeometry(1, 0.48, 5, 9);
}
