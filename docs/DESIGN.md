# Wonderarium: design notes

A tiny, relaxing desktop toy: a glass cube floating on the desktop with a small,
self-sustaining world inside. You watch it more than you play it.

## Core idea

- **The cube is the frame; worlds are cartridges.** A shared shell (window, cube,
  camera, clock, lighting, persistence) hosts interchangeable worlds.
- **Mostly closed system.** Nothing enters or leaves the box except what the user
  gently adds. Every world keeps itself going with no input.
- **Ambient first.** It runs fine untouched. Interactions are gentle nudges,
  never chores, and nothing can be lost.
- **For watching and playing, not upkeep.** No resource depletes and nothing
  needs to be maintained.
- **The cube is only a boundary.** It is the glass walls of the sandbox and
  nothing more. Everything inside it, including floors, trays and terrain,
  belongs to the world.

## Decisions

| Area | Decision |
|---|---|
| Platform | Electron + Three.js (macOS first) |
| Window | Frameless, transparent, 11:8, just wide enough for the worlds panel to stand beside the centred cube, with the time bar above it and the tools below. Only the cube and its soft shadow are visible until you hover. Movable, resizable, fullscreen (adds a backdrop that follows the sky). Optional always-on-top. |
| View | 3D glass cube you can orbit. Damped drag-to-rotate, scroll to zoom, limited tilt (never from below), slow idle drift. |
| Aesthetic | Soft low-poly, warm and toasty: flat-shaded facets, wood and cream tones with pastel accents, soft shadows. Visual reference: the hamster-cage mock-up shared on 2026-10-14. |
| First world | Hamster cage |
| Clock | Follows real local time by default. Adjustable: shift the time of day, change the speed, and "sync to real time" to snap back. |
| Interactions | Drop food, tap the glass, pet / pick up the hamster, rearrange furniture |
| Persistence | Yes. The hamster, its layout and the time settings are saved. On relaunch the hamster wakes or sleeps to match the clock and carries on. |
| Sound | None in v1 (ambient audio later) |

## Shell

- **Chrome.** Hidden until you hover. Then four things fade in: a Worlds panel on the left with a picture card per world; a pill at the top right with the sky icon, the box's time (click it for shift, speed and sync) and minimize, fullscreen and close (drag the pill to move the window); round tools along the bottom (reset view, pause, screenshot, settings); and a resize corner. Settings holds keep-on-top, drift-when-idle and the screenshots folder.
- **Cube.** Only the boundary: faintly blue glass that looks thick at the edges (a soft bluish rim and a crisp highlight line), brighter at grazing angles (Fresnel), and it mirrors two sparse room lights (a tall window and a small warm lamp, fixed relative to the viewer), so reflections slide across the panes as the cube turns. It has no base or contents of its own, but it is the edge of every world: whatever grows past the glass (a tall pine, a wide rock) is cut off there, shadow and all, like a diorama. A soft contact shadow under it makes it seem to rest on the desktop.
- **Lighting.** A sun or moon light whose angle and colour follow the world clock: warm and low at dawn and dusk, lavender at night, never black. The light belongs to the room, not the cube: turning the cube turns it under a fixed light, so shadows sweep across the contents (only turning around the vertical axis counts; the cube never tips). A tiny warm glow from the hamster house at night is planned.
- **Runtime.** Fixed-step simulation, decoupled from rendering. It keeps running
  when the window is unfocused and throttles or pauses when the window is hidden.

### World interface (sketch)

```ts
interface World {
  id: string; name: string;
  init(scene: THREE.Group, saved?: unknown): void;
  step(dt: number, clock: WorldClock): void;   // fixed-step sim
  render(alpha: number): void;                 // interpolate visuals
  onPointer(e: WorldPointerEvent): void;       // click / drag / hover in cube space
  serialize(): unknown;
  controls?: ControlSpec[];                    // world-specific knobs
}
```

## Palette (starting point)

| Role | Colour |
|---|---|
| Bedding / cream | `#F6EFE6` |
| Hamster fur (peach) | `#F2C29B`, belly `#FFF8F0` |
| Sage (plants, house roof) | `#B7CDB0` |
| Dusty blue (glass tint, bottle) | `#A9C1D9` |
| Butter (wheel, cheerios) | `#F3DFA2` |
| Blush accent (ears, nose, feet) | `#E8A598` |
| Wood (tray, house) | `#D9B99B` |
| Night ambient | `#5E6A9E` |

## Hamster cage (world #1)

Code: `src/worlds/hamster/` (scenery, model, brain, nav, effects, index).

**Contents:** a wooden tray of bedding shavings; a deep wooden wheel on an
A-frame stand; a plank house with an arched door and a round side window; a
water bottle hung on the back wall; a food bowl; a chew log; a cheese block.
Furniture is modelled once and shown 1.08 times its modelled size; the
hamster has its own scale (0.84), so it fits its wheel and its door. Both
were once a fifth larger, which filled the tray; smaller, the cage breathes.

**Hamster:** a low-poly Syrian hamster made of parts that each move: it
sits up, nibbles, stuffs its cheeks, grooms, digs, runs, and blinks. Each
step the brain sets a handful of pose dials and the model follows smoothly.

**Brain:** five needs (hunger, thirst, fatigue, restlessness, grooming)
rise over time. Whenever it finishes something it scores what it could do
next: the needs with a little randomness, and idle pastimes (wandering,
sniffing, digging) with a lot, so they take turns. It leans nocturnal:
sleepier by day, keener on the wheel at night. Each activity is a short
run of stages (walk there, turn, do it, leave). It sleeps and hoards inside
the house, disappearing behind the doorway as it walks in (the renderer cuts
away whatever part of it is behind the front wall).

**Getting around:** a 2 cm grid over the bedding records where the hamster
fits; it follows routes found on that grid, pulled taut into straight
segments, and is pushed out of furniture if it ever overlaps.

**Interactions:**
- *Drop food.* Click where you can see the bedding: a cheerio falls
  there. The hamster notices, fetches it, sits up on its hind legs and eats
  it from its paws (or, if full, tucks it into a cheek for later).
- *Tap the glass.* Click on empty glass, where your line of sight would leave
  through a far wall: a ripple, and the hamster stands up and looks at you.
- *Pet.* Rest the pointer on it: it turns to you, eyes half closed, hearts.
- *Pick up / boop.* Drag it to lift it and set it down elsewhere; a quick
  click is a boop (a little hop and a heart).
- *Knock.* Tap the house (a press that does not drag it): it rocks a little,
  and a hamster asleep inside wakes, comes out still drowsy, stretches, and
  stays up a few minutes before it is ready for bed again.
- *Rearrange.* Drag furniture over the bedding. A move is refused if pieces
  would overlap or leave the tray, or if any doorway, the wheel's opening,
  the bottle, a side of the bowl, or the hamster itself would be cut off.

**No upkeep:** the bowl and bottle never run out. Hunger and thirst still
drive it to eat and drink, which is part of the fun to watch, but they can
never become a problem. Food you drop is an extra treat, not a necessity.

## Forest pond (world #2)

Code: `src/worlds/pond/` (terrain, water, plants, koi, frog, dragonfly,
drift, effects, index). Shared helpers for every world live in
`src/worlds/kit.ts`.

**The idea:** a place to rest your eyes on, rather than a creature to look
after. Nothing in it needs you; every motion is slow, and most of them loop
without ever quite repeating.

**Ground:** a slab of earth fills the floor of the cube and is cut away at the
glass like a diorama, turf over banded soil. A ridge rises along the two back
walls. The pond is three overlapping circles blended into one rounded shape,
described by a signed distance, so anything can ask how far it is from the
water's edge and which way is deeper. Its bed is pale and pebbly in the
shallows and greener in the middle; steep banks turn from earth to stone.
Rocks near a wall are cut where the soil ends rather than at the glass, so
their buried bases never hang past the slab, and each cut is closed with a
flat face of stone, so they read as solid all the way through.

**Water:** a faceted surface that breathes with small waves and knows how deep
the water is beneath each point: clear over the shallows, teal over the deep,
with a soft line of foam where it meets the bank. Anything that touches it
(a koi, the frog, a leaf, the waterfall, fish food) starts a ring that
spreads and fades. The waterfall springs from the cleft between two big mossy
rocks at the back (a third closes the gap behind), runs out between them,
and drops in a streaked ribbon that spreads as it falls, with froth and spray
at its foot.

**Life:** three koi wander, rest, kiss the surface now and then, and gather
for food. A frog sits for a long time (which is most of what frogs do),
breathes, croaks (more after dark, with a little note drifting up), blinks,
looks about, and moves house now and then: one hop if the next perch is
close, otherwise a plop, a lazy swim and a hop back out. Its perches are the
log, a stepping stone, two banks and the larger lily pads. A dragonfly hangs
in the air, darts, rests on the cattails, dips to touch the water, and sleeps
on a stalk at night; if it hovers too near the frog, the frog snaps at it
and misses. Lily pads drift on a faint current, and their flowers fold shut
toward evening. Leaves let go of the big tree and spin down onto the grass
or float for a while. Fireflies come out at dusk; motes of dust turn in the
daylight. Grass, ferns, reeds and trees all lean in one unhurried breeze.

**The fawn:** a small spotted deer visits now and then, more often around
dawn and dusk, stepping in through one of the glass walls (the box cuts it
off until it is inside) and leaving through another. There is no routine:
each time it finishes something it draws its next move by lot, weighted
loosely (a drink if it has not had one, a nibble of grass, a stroll, a
moment standing still to look about, a lie-down, or home, likelier the
longer it has stayed), and it sometimes stops mid-walk to look around. It
finds its way on a grid of dry ground clear of rocks, trunks and the log,
the same kind the hamster uses, and only enters where it can reach the
water. It drinks only from the low bank, where the meadow slopes gently
down to the pond, never from up on the ridge craning over the drop. To
drink it lowers its head just until its muzzle meets the surface, found by
trying the pose rather than chasing it.

**Interactions:**
- *Feed the koi.* Click the water: a pinch of food scatters on the surface
  and the koi come up for it.
- *Shake a tree.* Click one: it sways, and the leafy one drops a few leaves.
- *The frog.* Rest the pointer on it and it turns to look at you; click it
  and it croaks, or decides it is time to move.
- *The fawn.* Rest the pointer on it, or click it, and it lifts its head
  and looks your way, ears and tail flicking.
- *Tap the glass.* Click anywhere else (grass, stone, air): a ripple on the
  pane, the koi scatter, the frog dives, the dragonfly darts away, and the fawn
  bounds out of the box. The floor
  fills the cube here, so a line of sight almost always ends on the ground;
  only the water, the trees and the frog answer a click themselves.

**Remembered:** where the lily pads have drifted, and where the frog sat.

## Later worlds (backlog)

Aquarium · tiny island · tree house · solar system · Lorenz attractor
