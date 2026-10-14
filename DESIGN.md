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
| Window | Frameless, transparent. Only the cube and its soft shadow are visible. Movable, resizable (1:1 aspect), native fullscreen (adds a pastel backdrop). Optional always-on-top. |
| View | 3D glass cube you can orbit. Damped drag-to-rotate, scroll to zoom, limited tilt (never from below), slow idle drift. |
| Aesthetic | Soft low-poly pastel: flat-shaded facets, muted palette, soft shadows, light fog |
| First world | Hamster cage |
| Clock | Follows real local time by default. Adjustable: shift the time of day, change the speed, and "sync to real time" to snap back. |
| Interactions | Drop food, tap the glass, pet / pick up the hamster, rearrange furniture |
| Persistence | Yes. The hamster, its layout and the time settings are saved. On relaunch the hamster wakes or sleeps to match the clock and carries on. |
| Sound | None in v1 (ambient audio later) |

## Shell

- **Chrome.** It is hidden until you hover. Then a grip appears for moving the
  window, a resize corner appears, and a small control pill shows: time
  (real / shifted / speed), pause, pin on top, fullscreen, and a world picker
  (only the hamster for now).
- **Cube.** Only the boundary: thin, faintly blue glass walls with brighter
  edges at grazing angles (Fresnel) and rounded edges. It has no base or
  contents of its own. Worlds fill it and collide against its walls. A soft
  contact shadow is drawn inside the canvas so the cube appears to rest on the
  desktop.
- **Lighting.** A sun or moon light whose angle and colour follow the world
  clock. Warm and low at dawn and dusk, lavender-indigo at night. A tiny warm
  glow comes from the hamster house at night.
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

**Contents:** a shallow wooden tray holding a bedding floor of wood shavings,
an exercise wheel, a little wooden house (the nest), a food bowl, a water
bottle and a chew stick.

**Hamster:** a Syrian hamster built as a rounded low-poly egg. It has small ears,
bead eyes and pink feet. It uses squash-and-stretch, and its cheeks puff up
when they are full.

**Brain:** needs-based (utility AI).
- Needs: hunger, thirst, energy, restlessness.
- Actions: wander, sniff, eat, stuff cheeks, hoard food in the house, drink, run
  on the wheel, burrow, groom, sleep in the nest.
- Nocturnal bias: drowsy in daylight, lively at dusk and night.

**Interactions:**
- *Drop food.* Click the floor and seeds fall in. The hamster notices, waddles
  over and stuffs its cheeks.
- *Tap the glass.* The hamster freezes, turns toward you, then goes back to
  what it was doing.
- *Pet / pick up.* Hover over the hamster to pet it, and it leans in. Drag to
  lift it and set it down somewhere else.
- *Rearrange.* Drag furniture across the floor. It snaps gently and avoids
  overlapping.

**No upkeep:** the bowl and bottle never run out. Hunger and thirst still
drive the hamster to eat and drink, which is part of the fun to watch, but
they can never become a problem. Food you drop is an extra treat, not a
necessity.

## Later worlds (backlog)

Aquarium · tiny island · tree house · solar system · Lorenz attractor
