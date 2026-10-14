# World in a Box — design notes

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
| Window | Frameless, transparent, 3:2 landscape so the controls sit beside the cube rather than over it. Only the cube and its soft shadow are visible until you hover. Movable, resizable, fullscreen (adds a backdrop that follows the sky). Optional always-on-top. |
| View | 3D glass cube you can orbit. Damped drag-to-rotate, scroll to zoom, limited tilt (never from below), slow idle drift. |
| Aesthetic | Soft low-poly, warm and toasty: flat-shaded facets, wood and cream tones with pastel accents, soft shadows. Visual reference: the hamster-cage mock-up shared on 2026-10-14. |
| First world | Hamster cage |
| Clock | Follows real local time by default. Adjustable: shift the time of day, change the speed, and "sync to real time" to snap back. |
| Interactions | Drop food, tap the glass, pet / pick up the hamster, rearrange furniture |
| Persistence | Yes. The hamster, its layout and the time settings are saved. On relaunch the hamster wakes or sleeps to match the clock and carries on. |
| Sound | None in v1 (ambient audio later) |

## Shell

- **Chrome.** Hidden until you hover. Then four things fade in: a Worlds panel on the left with a picture card per world; a pill at the top right with the sky icon, the box's time (click it for shift, speed and sync) and minimize, fullscreen and close (drag the pill to move the window); round tools along the bottom (reset view, pause, screenshot, settings); and a resize corner. Settings holds keep-on-top, drift-when-idle and the screenshots folder.
- **Cube.** Only the boundary: faintly blue glass that looks thick at the edges (a soft bluish rim and a crisp highlight line), brighter at grazing angles (Fresnel), and it mirrors two sparse room lights (a tall window and a small warm lamp, fixed relative to the viewer), so reflections slide across the panes as the cube turns. It has no base or contents of its own. A soft contact shadow under it makes it seem to rest on the desktop.
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
| Butter (wheel, seeds) | `#F3DFA2` |
| Blush accent (ears, nose, feet) | `#E8A598` |
| Wood (tray, house) | `#D9B99B` |
| Night ambient | `#5E6A9E` |

## Hamster cage (world #1)

Code: `src/worlds/hamster/` (scenery, model, brain, nav, effects, index).

**Contents:** a wooden tray of bedding shavings; a deep wooden wheel on an
A-frame stand; a plank house with an arched door and a round side window; a
water bottle hung on the back wall; a food bowl; a chew log; a cheese block.
Furniture is modelled once and shown 1.35 times larger; the hamster has its
own scale (1.05), so it fits its wheel and its door.

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
- *Drop food.* Click where you can see the bedding: a sunflower seed falls
  there. The hamster notices, fetches it, and eats it (or pouches it if full).
- *Tap the glass.* Click on empty glass, where your line of sight would leave
  through a far wall: a ripple, and the hamster stands up and looks at you.
- *Pet.* Rest the pointer on it: it turns to you, eyes half closed, hearts.
- *Pick up / boop.* Drag it to lift it and set it down elsewhere; a quick
  click is a boop (a little hop and a heart).
- *Rearrange.* Drag furniture over the bedding. A move is refused if pieces
  would overlap or leave the tray, or if any doorway, the wheel's opening,
  the bottle, a side of the bowl, or the hamster itself would be cut off.

**No upkeep:** the bowl and bottle never run out. Hunger and thirst still
drive it to eat and drink, which is part of the fun to watch, but they can
never become a problem. Food you drop is an extra treat, not a necessity.

## Later worlds (backlog)

Aquarium · tiny island · tree house · solar system · Lorenz attractor
