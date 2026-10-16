// Colours for the jellyfish tank: an underwater fantasy in blues and
// lavenders, pale sand, slate rocks, soft coral, and jellies that glow
// pink and peach from inside.

export const A = {
  sand: ['#ADA2C4', '#A498BC', '#B6ACCB', '#9D92B6', '#B1A7C7', '#BCB2CF'],
  sandSide: ['#9A8EB2', '#9286AB', '#A296B9'],
  sandDeep: '#6F658C',
  rock: ['#4A5282', '#535C8E', '#444B78', '#5C6597', '#3F466F'],
  rockTop: ['#6A73A6', '#727BAE', '#636C9E'],
  coral: ['#F08FB0', '#F4A3BE', '#E97FA2'],
  coralWarm: ['#F5A27E', '#F7B48E', '#EE9370'],
  coralLilac: ['#C59BEA', '#B48BE0', '#D2ABF0'],
  weed: ['#3E8F72', '#4A9E7C', '#357F66', '#56AA84'],
  weedTip: ['#7CC48F', '#8ED09A'],
  pot: ['#8C7A86', '#7E6D7B', '#978593'],
  potInner: '#4F4358',
  /** The water, from its surface down to the sand, by day and by night. */
  waterTop: { day: '#2A4E8F', night: '#1A2A60' },
  waterDeep: { day: '#122452', night: '#0B1434' },
  surface: { day: '#6E9FD2', night: '#33467F' },
  /** What the far side of the tank fades into. */
  haze: { day: '#18306A', night: '#0F1B46' },
  bell: '#EADCFF',
  jellyGlow: ['#F2A8FF', '#FFB3D1', '#B6A8FF', '#FFC2A8'],
  jellyCore: ['#FFB58F', '#FF9FC0', '#FFC9A0'],
  tentacle: [1.0, 0.82, 0.95] as [number, number, number],
  bubble: '#D8F2FF',
  snow: [0.55, 0.68, 0.9] as [number, number, number],
  caustic: [0.55, 0.82, 1.0] as [number, number, number],
} as const;
