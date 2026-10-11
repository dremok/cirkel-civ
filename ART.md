# Art direction

**The bar:** sophisticated, clean and exquisite. A high-end indie game, not AAA: artistic, crafted,
calm and confident. It must look *much* better than our previous hex prototype (Otherwhen: small flat
hexes, muddy desaturated colours, grey haze, generic dark UI panels). Crisp, luminous and
beautifully coloured.

Think: a hand-crafted miniature world in late-afternoon light. References for mood and quality:
Bad North, Townscaper, Dorfromantik, Islanders, Oskar Stålberg's work, Monument Valley's palette
discipline, Alto's Odyssey's atmosphere. Every screenshot should look like a key art frame.

## Direction update (2026-10-12): dreamier, richer, more detailed

The first renders are clean but too plain and too evenly coloured. Push further:

- **Dreamy.** Soft, glowing late-afternoon light that feels slightly enchanted: gentle bloom on
  highlights and water glints, airy haze layering into the distance, light mist pooling in low
  valleys and over the sea, drifting pollen or dust motes catching the sun, a sky with soft peach,
  apricot and lilac gradients and a few painterly clouds. Colour-graded like a picture book: shadows
  lifted toward blue-violet, highlights warm and golden. A very gentle tilt-shift depth of field
  at close zoom if it helps the miniature dream. Never murky, never foggy-grey.
- **More flavours in the colours.** Variation in *hue*, not just lightness. Meadows mixing sage,
  spring green and chartreuse with drifts of wildflowers (poppy red, lavender, buttercup, white);
  forests mixing deep teal pines, olive and emerald broadleaf, with gold and rust autumn accents;
  plains in honey, wheat and apricot; beaches from cream to rose-tinted sand; rocks in warm grey,
  plum and slate with moss and lichen; water from luminous aquamarine shallows through turquoise to
  deep ultramarine-teal. Strata sides as warm painted earth bands (ochre, rust, umber, plum rock).
- **More detail, still clean.** Tiles get gentle relief and texture-like variation in their tops
  (soft colour mottling, tiny stones, clover, moss patches), crisp bevels and painted edges. Trees
  get several species with layered canopies, visible trunks, soft translucency in the sun, and
  variety in size. Objects: rocks with facets and moss, flower clusters, mushrooms and ferns in
  forests, fallen logs, reeds at the shore, wheat that sways. Units become finely crafted
  miniatures: helmets, faces, capes, shield emblems in the player colour, a detailed horse and
  saddle, a settler's cart with wheels and bundles, banners that flutter, tiny idle motions.
- **Detail serves the dream, not noise.** Every addition must read as lovely at the default zoom
  and stay calm. Clarity of gameplay still wins over decoration.

## Principles

1. **Clarity first.** Art never hides gameplay. One glance tells you: terrain, height, whose unit,
   what type, how hurt, where it is going.
2. **Restraint.** Few elements, each one lovely. Quiet surfaces, crisp edges, generous space. No
   clutter, no noise textures, no bloom soup, no lens dirt.
3. **Light does the work.** Warm low sun, cool sky fill, soft long shadows, ambient occlusion in the
   seams. Warm/cool contrast is what makes colours sing.
4. **Height is the hero.** Every hex is its own column at its own height. Stepped
   terraces, cliffs, bevelled edges that catch the light.
5. **Crisp.** Device pixel ratio up to 2, proper anti-aliasing (MSAA or SMAA), sharp silhouettes,
   no blur except a very gentle tilt-shift if it helps the miniature feel.
6. **Alive but calm.** Water moves, trees sway, cloud shadows drift, smoke rises. Slowly.

## Palette (sRGB)

Terrain, tuned to sit together under warm light:

| Element | Base | Light | Shadow / dark |
|---|---|---|---|
| Deep water | `#1F4E5F` | `#2E6A78` | `#163A48` |
| Shallow water | `#4FB3AE` | `#7ED3C6` | `#3A8F8E` |
| Foam | `#F4F1E8` | | |
| Beach sand | `#E9D7AE` | `#F3E6C6` | `#CDB98C` (wet) |
| Meadow (grass) | `#9DBF6B` | `#B9D47F` | `#6E9A4F` |
| Plains (dry, wheat) | `#D7C27A` | `#E8D691` | `#B59F5E` |
| Forest floor | `#5E8A4A` | | `#46703A` |
| Pine | `#2F5D46` | `#3F7656` | |
| Broadleaf | `#4F7F3A` | `#6C9A45` | rare amber/rust accents `#C8873A` `#B5642F` (about 5 %) |
| Hills | `#A8A06B` | `#BDB57F` | rock `#8F8B78` |
| Mountain rock | `#8C8597` | `#A49EAE` | `#5F5A6B` |
| Snow | `#F6F3EE` | | blue shadow `#C9D6E6` |
| Column sides (strata) | top band = darkened biome, then earth `#8A6E52`, rock `#6E6259`, base `#4B4440` | | |
| Sky | zenith `#8FB8D8` | horizon `#F3E3CC` (warm haze) | |
| Sun / fill | sun `#FFE2B8` | sky fill `#9BB8D6` | ground bounce `#C9B08A` |

Players: jewel tones that pop against greens and teals. Each has base, light, dark.

| Seat | Name | Base | Light | Dark |
|---|---|---|---|---|
| 0 | Vermilion | `#E2543A` | `#F28A6F` | `#A8341F` |
| 1 | Cobalt | `#3460D9` | `#6F92F0` | `#213E99` |
| 2 | Saffron | `#F0A92E` | `#F7C96E` | `#B57914` |
| 3 | Plum | `#A8458F` | `#CC7BB7` | `#72285F` |

The palette lives in code at `src/client/render/palette.ts` (owned by the world agent; everyone
imports from it). Tune values if they look wrong under the final lighting, but keep the spirit.

## The world (world agent)

- **A diorama.** The map is a finite board of hex columns. Preferred: it floats like a crafted
  object, its rim columns running down to show earth and rock strata, set against a soft warm
  gradient backdrop with atmospheric depth. The sea fills the low columns as a body of translucent
  teal with real depth colour (turquoise shallows, deep teal further out), a fresnel sheen, sun
  glints, and soft animated foam where it meets land. A calm sea running to a hazy horizon is an
  acceptable alternative if it looks better. Judge by screenshots.
- **Columns.** Hex prisms with a small bevel/chamfer on the top edge and hairline seams between
  tiles. Tops get a gentle per-tile tint jitter (a few percent lightness) and, at most, very subtle
  low-contrast detail. Sides show strata bands.
- **Peaks and props.** Mountains get irregular low-poly rock spires on top of their column; snow
  tiles get snow caps. Forests: 3 to 5 instanced trees per tile, varied scale, rotation and species
  (pines on high ground, broadleaf low, rare amber accents). Meadows: sparse tufts and tiny flowers.
  Plains: a few wheat clumps. Hills: small rocks. Less is more.
- **Light.** Warm directional sun at about 35° elevation with soft, high-resolution shadows fitted to
  the board, hemisphere fill, an environment map from the sky (PMREM) for subtle reflections.
  Tone mapping AgX or ACES with exposure tuned by eye. Ambient occlusion (N8AO via `postprocessing`,
  or similar) that darkens seams and the feet of cliffs without looking dirty.
- **Atmosphere.** Gentle distance fog toward the horizon colour, slowly drifting cloud shadows across
  the board, a few birds, trees swaying, water moving.
- **Performance.** 60 fps on a MacBook, at least 30 fps on a mid-range phone. Quality tiers: drop AO,
  shadow resolution and DPR on weak devices.

## Pieces (pieces agent)

- **Units are painted miniatures.** A small figurine on a round base ringed in the player colour,
  about 45 % of a hex across. Clear silhouettes: *Spearman* (long spear and round shield),
  *Archer* (bow and quiver), *Rider* (horse and rider with a pennant), *Settler* (a figure
  with a handcart or bundle and a little banner). Low-poly, smooth, player colour on tunic, shield and
  banner, neutral skin, wood and steel. Built procedurally from primitives (or GLB if worth it).
- **Health** as a thin elegant arc around the base, hidden at full health. **Stance** as a tiny glyph
  on the base rim (eye = cautious, chevron = aggressive, shield = hold).
- **Cities**: a cluster of small houses with pitched roofs in the player colour and ivory or stone
  walls, growing with population. The capital has a tower. Walls are a low crenellated stone ring.
  Chimney smoke. The name on a small, elegant plaque in the display serif. Houses rise from the
  ground when a city is founded.
- **Territory**: a soft ink-like line in the player colour along the outer edges of each player's
  territory (tiles within reach of their cities), with a very light tint inside.
- **Orders**: a smooth curved ribbon through the hex centres lying on the terrain, dashed, in the
  player colour, with small dots at each step showing *when* (tick 1 to 6) the unit arrives there.
  End markers: a ring (move), crossed swords in warm red (attack), a little flag (found a city).
  Steps beyond this turn fade. A ghost preview follows the pointer while choosing a destination.
- **Selection**: a soft glowing ring under the unit; reachable tiles as luminous hex outlines.
- **Replay** (the payoff of simultaneous turns, make it feel great): units glide with a small hop per
  step on their tick; meetings lunge to the shared edge with a dust puff and spark; floating damage
  numbers ("−3") in the serif; arrows fly in arcs; the dead tip over and sink; captured cities sweep
  to the new colour; new units pop up with a soft ring. About 0.5 s per tick, skippable.

## Interface (UI agent)

- Warm ivory paper `#F7F2E8`, ink `#2A2622`, muted `#7A6F62`, hairline rules `#D9CFBF`. Accent =
  the player's own colour.
- Type: a refined display serif (e.g. Fraunces or Cormorant Garamond) for titles, city names,
  numbers that matter; a clean sans (Inter) for UI text. Letter-spaced small caps for labels.
  Tabular numbers.
- Panels: frosted ivory glass (backdrop blur), 1 px hairline border, soft long shadow, 14 px radius.
  Thin-line SVG icons (1.5 px stroke), drawn for this game.
- Motion: gentle easing `cubic-bezier(.2,.7,.2,1)`, 180 to 320 ms. Nothing bounces.
- Mobile first. Thumb-reachable controls at the bottom, 44 px touch targets, no hover-only
  information, safe-area insets.
- The UI is in English: natural, concise, tasteful game English.
