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
| Window | Frameless, transparent, 11:8, just wide enough for the worlds panel to stand beside the centred cube, with the time bar above it and the tools below. Only the cube and its soft shadow are visible until you hover. Movable, resizable, fullscreen (adds a backdrop in the world's own colours that follows the sky). Optional always-on-top. |
| View | 3D glass cube you can orbit. Damped drag-to-rotate, scroll to zoom, limited tilt (never from below), slow idle drift. |
| Aesthetic | Soft low-poly, warm and toasty: flat-shaded facets, wood and cream tones with pastel accents, soft shadows. Visual reference: the hamster-cage mock-up shared on 2026-10-14. |
| First world | Hamster cage |
| Clock | Follows real local time by default. Adjustable: shift the time of day, change the speed, and "sync to real time" to snap back. |
| Interactions | Drop food, tap the glass, pet / pick up the hamster, rearrange furniture |
| Persistence | Yes. The hamster, its layout and the time settings are saved. On relaunch the hamster wakes or sleeps to match the clock and carries on. |
| Sound | None in v1 (ambient audio later) |

## Shell

- **Chrome.** Hidden until you hover. Then four things fade in: a Worlds panel on the left with a card per world, showing a still taken once, the first time the world is opened, from a fixed angle a little off the corner and a touch closer than the usual view, always in midday light; a pill at the top right with the sky icon, the box's time (click it for shift, speed and sync) and minimize, fullscreen and close; round tools along the bottom (reset view, pause, screenshot, settings); and a resize corner. Settings holds keep-on-top, drift-when-idle and the screenshots folder. Any bare part of the pill, the worlds panel or the tools moves the window. The time and settings panels close by themselves once the pointer has been off them (and off the button that opened them) for a couple of seconds.
- **Cube.** Only the boundary: faintly blue glass that looks thick at the edges (a soft bluish rim and a crisp highlight line), brighter at grazing angles (Fresnel), and it mirrors two sparse room lights (a tall window and a small warm lamp, fixed relative to the viewer), so reflections slide across the panes as the cube turns. It has no base or contents of its own, but it is the edge of every world: whatever grows past the glass (a tall pine, a wide rock) is cut off there, shadow and all, like a diorama. Six planes cut at the panes, twelve more across the edges and eight across the corners, so nothing pokes out past the glass's rounded edges and corners either. A soft contact shadow under it makes it seem to rest on the desktop.
- **Lighting.** A sun or moon light whose angle and colour follow the world clock: warm and low at dawn and dusk, lavender at night, never black. The light belongs to the room, not the cube: turning the cube turns it under a fixed light, so shadows sweep across the contents (only turning around the vertical axis counts; the cube never tips). A tiny warm glow from the hamster house at night is planned.
- **Runtime.** Fixed-step simulation, decoupled from rendering. It keeps running
  when the window is unfocused and throttles or pauses when the window is hidden.

### World interface

The full contract lives in `src/worlds/world.ts`; in short:

```ts
interface World {
  id: string; name: string;
  mount(ctx: WorldContext, saved?: unknown): void; // its own group, read-only clock and light
  step(dt: number): void;          // fixed-step sim; a step of 0 only refreshes light-dependent looks
  render?(alpha: number): void;    // interpolate visuals
  pointer?(e: WorldPointerEvent): boolean; // hover, click, drag in cube space; true if used
  cursor?: string;
  haze?: { color; near; far };     // seen through water: fog measured from the camera
  serialize?(): unknown;
  dispose?(): void;
}
```

Each world also brings, in `src/worlds/index.ts`, a placeholder accent for
its card and its own backdrop colours by day and by night.

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

## Lorenz attractor (world #3)

The abstract one: no floor, no creatures, only light in empty space. It is
here for the same reason the pond is, something to rest your eyes on, but
what it rests them on is a piece of mathematics.

**The flow:** the Lorenz equations (σ = 10, ρ = 28, β = 8/3), integrated with
fourth-order Runge-Kutta, slowly: a tenth of a Lorenz time unit per second,
so a loop round a wing takes several seconds. The wings spread along x + y,
so the attractor is turned to lay that direction across the cube's diagonal
facing the usual view, and scaled until its widest reach sits just inside
the glass.

**The light:** 640 sparks, each with a tail of its last few dozen places,
sampled every third step and fading toward the end. They are amber on one
wing and violet on the other, whiter where the wings cross and bluer in the
tight turns near each eye. Under them run two faint threads of one long
trajectory, still, sketching the shape the sparks are drawn into, and about
a hundred motes drift and twinkle in the space around. Everything glows
without a lamp: dots are soft sprites with a bright core in a wide halo, and
both dots and lines write premultiplied colour with less alpha than colour,
so they add light on a dark backdrop yet still show as a tint over a bright
desktop, where purely additive light would vanish. It burns a little
brighter at night.

**Interaction:** click near the sparks and the one nearest the line of sight
gathers a cloud: three dozen others leave wherever they were (the count
never changes) and land within a twentieth of a unit of it, one point on
screen. They travel together, then fray and scatter over both wings, which
is the whole point of the system made visible. Nearby paths part by about a
factor of e per Lorenz time unit, so at this pace the fraying shows after a
few seconds to half a minute, depending on where on the attractor the cloud
began. The cloud keeps its cyan while it holds together and lets it go as
its mean distance from its own middle grows from 4 to 12 units, about as
scattered as sparks on the attractor ever are, never faster than over six
seconds (when a cloud splits between the wings at once) and never longer
than five minutes. A spark taken into a newer cloud leaves its old one.

**Remembered:** nothing; it never needs to be.

## Jellyfish tank (world #4)

An underwater fantasy rather than a faithful aquarium: soft glows and
serenity, after a reference of moon jellies over lavender sand.

**The water:** the tank is filled right up under the lid, with just enough
room for the swell to stay inside the glass, in a deep blue that turns
dark and inky at night, for contrast with the glow. The body of water is the inside of a box drawn from
within, shaded from a lighter blue under the surface to a deep one at the
sand, so the far walls read as water rather than glass. Everything in it is
seen through a haze (the shell's fog, measured from whichever camera is
drawing, so it works for the view and for the card's picture alike): the
far side of the tank fades toward blue, and at night the haze closes in.
The surface heaves in slow overlapping swells, faint enough that from
above you look down through it into the tank; five shafts of light lean
down from it, each breathing brighter and dimmer on its own slow cycle and
always turned to face the viewer; and a net of caustics wanders over the
sand (an old shader trick: warp a point by sines a few times and measure
how tightly the warped lines bunch).

**The floor:** pale lavender sand in low dunes, rising toward the back walls
and running right up to the glass, so big rocks the glass cuts off have no
gap beside the sand to show their buried parts. A great slate-blue boulder,
far bigger than the rest, towers in the back corner to make a landscape of
the tank; the glass cuts it on both back walls, and like every rock there
its cuts are closed with flat faces of stone (the same trick as the pond's,
now shared). Smaller rocks gather round it and along the walls; branching coral (tapered limbs that
fork two or three times, with rounded tips) in pink, peach and lilac; weed
as frilled ribbons that lean more the higher they go, in one slow current;
and an amphora on its side, half in the sand, its dark mouth to the view.
The room's night light is never dark, so the tank dims its own floor at
night to about two thirds of its daytime brightness (enough to read the
shapes, dim enough that what glows stands out).

**The jellies:** six, from large to small, each a translucent faceted bell
with a warm core and a soft halo. They beat: a quick squeeze (the bell
narrows and lengthens and drives itself along its axis), a long relaxing,
and a rest, between which they coast and slowly sink. Each drifts toward
a depth of its own, chosen afresh every half minute or so, beating when
below it and resting when above; their headings wander, they lean over to
swim along at their depth and stand upright to climb, and they keep clear
of the glass, of each other, and of the great boulder, over which their
tentacles drape rather than pass through. Tentacles (fine glowing lines) and four
frilled arms are chains of points that each follow the one above, so they
stream behind on the way up; they also have a little weight (the arms a
touch more), so whenever nothing pulls them they sink slowly to hang
beneath the bell. They glow
brighter at night, and pulse brighter with each squeeze.

**Life in the water:** strings of bubbles rise now and then from the pot
and from a crack between the rocks, wobbling and swelling a little on the
way up; fine specks drift down and start again under the surface.

**Interactions:**
- *Click a jelly:* it glows a little brighter and beats its way upward for
  a few eager pulses, then settles back into its own pace. Hovering does
  nothing but show a pointing hand.
- *Click the sand:* a string of bubbles rises from the spot.

**Remembered:** nothing; the jellies start afresh, spread out, each time.

## Loft (world #5)

An interior, warm and cosy, after a reference of a double-height loft whose
light is mostly hidden behind stairs and furniture.

**The room:** a slab of planked floor, cut away at the glass like the other
worlds, and two cream walls at the back. A mezzanine bedroom sits over the
back-left at about two and a half metres (one metre is 0.185 units, so the
loft is about five metres a side), planked on top, plaster beneath, edged
with a wooden beam and a glass railing, held up at its open corner by a
slim post. The stairs turn in the back-right corner, as in the reference,
floating all the way: open treads rise from the floor beside the right-hand
glass to a landing slab fixed into the corner, and more climb the back wall
to the mezzanine, high enough that a deep, low sofa tucks in
beneath them against the wall, with a round table (a mug, a book) on a rug
before it. Dark handrails on posts follow both flights. Under the mezzanine,
the kitchen, set out from the back corner far enough that the fridge door
swings clear of the desk (a tall plant fills the corner): the fridge, then a
dark counter with sink and cooktop along the left wall under a floating
shelf of jars, low enough to reach, and a wooden bar reaching out into the room with two stools; and a desk against the back wall
(a monitor, a lamp, a chair, a shelf of books). The walls stand
on the floor rather than reaching into the slab, where their faces would
share planes with its sides and flicker. Upstairs (the mezzanine reaches a little out over the sofa's end), a low
bed with linen, a sage throw and pillows, two nightstands, a green rug; a
big beige bean bag, slumped with a raised back and a hollow to sink into, a
yellow pillow in it, on a round sage rug between the bed and a low, deep
bookshelf along the back wall, its hollow turned between the shelf and the
top of the stairs, with a
model ship (three masts, pale sails) on top beside a globe lamp and a plant. Pictures of low hills under a warm sky; potted plants about the room;
pothos trailing from planters over the mezzanine's edges, swaying a little.

**The light:** fixtures, each a bundle of real lights (area lights for the
strips, point lights for lamps), glowing surfaces where a bulb or strip
shows, and soft glows painted where its light falls. The strips under the
stairs show as a bright line under each nosing, a wash down the back wall
beneath the upper treads and the landing, a little light spilling onto each
tread below and a soft pool on the floor beneath the lower flight, with an area light under the upper flight down onto the sofa;
under the mezzanine's edge and the kitchen shelf, as area lights down onto
the bar, the desk and the counter; under the sofa and the
bed, as light escaping round their bases. A desk lamp and the monitor (the
one cool light among the warm) and a globe lamp by the bed, with a second
on the bookshelf. Each fixture keeps its own hours: the strips from dusk to
dawn, the desk from evening until half past eleven, the bedside lamp late
evening until a little after midnight. Each comes on in its own moment and
eases in and out.

**Night:** the room's shared night light is never dark, which suits a pond
but not a home after dark. The loft takes most of it back with a negative
hemisphere light of the same colours, and adds a warm ambient bounce that
rises with how many of its lights are on, so its own lamps do the lighting.

**Life:** steam curls from the mug, dust drifts and shows in the lamplight,
the pothos sways.

**Interaction:** a click on any fixture (lamps, the monitor, the stairs, the
sofa, the bed, the kitchen shelf, the mezzanine's edge; the thin ones have
larger invisible handles) switches it, until its own hours next change.

**Remembered:** nothing.

## Later worlds (backlog)

Tiny island · tree house · solar system
