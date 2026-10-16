// Colours for the loft: cream walls, honey-coloured floorboards, stairs and
// bed frame, pale oak shelves and tables, a dark kitchen, soft white linen
// and sage greens, and lamplight in amber.

/** One metre, in cube units: the loft is about five metres on a side. */
export const M = 0.185;

export const L = {
  wall: '#EADFCF',
  wallShade: '#E1D3BF',
  skirting: '#D8C8B2',
  plank: ['#C89A6A', '#BE8F5F', '#D1A574', '#B98A5C', '#C49464'],
  slabSide: '#8E7058',
  slabDeep: '#6E5544',
  beam: '#D2B08A',
  underside: '#DCCDB9',
  tread: '#C9955F',
  railGlass: '#DCEBEF',
  metal: '#3A3431',
  sofa: '#EFE6D8',
  sofaShade: '#E2D7C6',
  cushion: ['#8C9C66', '#7E8F5E', '#D9A066'],
  table: '#D9B88F',
  rug: '#EEE4D4',
  cabinet: '#4E4A46',
  counter: '#DCD3C7',
  steel: '#5C5A58',
  shelf: '#DCBD95',
  bedFrame: '#A57650',
  linen: '#F4EFE7',
  throw: '#7F9463',
  pillow: '#FAF6EF',
  books: ['#8E5B4A', '#5F7A6E', '#C6A15B', '#6B6390', '#B76E5A', '#D8C8A8', '#4E6B83'],
  leaf: ['#4E8A4C', '#5E9E52', '#6DAE5C', '#3F7A45', '#79B865'],
  pot: '#E8DED0',
  potDark: '#6B5B4E',
  frame: '#3A302A',
  sky: ['#E9C9A8', '#D7B49A', '#B7A3B6'],
  hills: ['#7D8C77', '#68796A', '#566656'],
  screen: '#9DBBE6',
  mug: '#F2EDE6',
  beanBag: '#E2D2B6',
  beanPillow: '#E9C44C',
  coffee: '#5A3A28',
  /** Lamplight and the hidden LED strips: one warm amber. */
  glow: '#FFB46B',
  shade: '#FFE3BC',
} as const;
