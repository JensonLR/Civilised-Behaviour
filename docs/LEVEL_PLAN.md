# Level plan: the binding standard for every region and interior (D-038)

Status: binding from 2026-10-01. Author: the architect of polish pass 2 (`docs/_notes/polish2.md`). Owner of the plans and views: package L.
If a region, a building or a prop breaks a rule here, the rule wins and the content is fixed; if a rule is wrong, change it HERE, in `AUDIT` (`packages/shared/src/levelAudit.ts`) and in D-038 together, then fix the content.
Why this exists: the maps read beautifully from a distance and fall apart up close. The baseline (section 9) found every authored building drawing a door on a solid box (nothing behind it), props inside walls, a flagpole through the Customs House, doors narrower than a comfortable body, and no rule about any of it. A final build has five regions and a hub; they must be planned once, to one grid, and checked by a machine.

How to use it: section 1 is the numbers; 2 and 3 are how a region is shaped; 4 is the door and interior law; 5 and 6 are props and paths; 7 is the per-region site plan (what must exist, where, with which door); 8 is the checklist a new region passes before it is reachable; 9 is the audit and its ratchet.

## 1. Scale grid and module sizes

Everything is metres on a 0.5 m grid (authored coordinates may be finer for curves, but footprints, door widths, wall thicknesses and prop clearances are multiples of 0.1 and the module sizes below are multiples of 0.5). The body is the contract: `CHARACTER` radius 0.4 (0.8 across), height 1.8 (1.2 crouched), step 0.5, snap 0.35, max slope 1.2 rise/run; a jump clears about 1.0 m; run 4.4 m/s, sprint 6.6; a hat adds up to 0.4.

| Thing | Minimum | Standard | Notes |
| --- | --- | --- | --- |
| Person's door, clear width | 1.3 | 1.5 | the 0.8 body plus a hand each side; hall and double doors 2.4 |
| Gate or arch a wagon or a rider passes | 2.6 | 3.0-4.0 | `AUDIT.gateMinWidth`; the Highmark gate (8.4) and Hollowmere's clock arch (3.2) already pass |
| Door clear height (lintel underside) | 2.2 | 2.4 | halls and arches 3.2; a body plus a hat is 2.2 |
| Threshold step | 0 | 0.2-0.3 | a plinth is walked onto; two steps of 0.25-0.4 up to a porch are fine; NEVER above 0.5 in one riser (the step limit) |
| Wall thickness (building) | 0.3 | 0.3 | `WALL_T`; curtain and revetment walls 0.6-1.2 |
| Wall height, floor to eave | 2.6 | 2.8-3.2 | storey 3.0; the eave is the view's, collision walls run to it |
| Eave overhang beyond the wall | 0.4 | 0.6 | VISUAL ONLY: it must not reach over a door apron below 2.6 m, and it is never collision |
| Interior room module | S 3.6 x 3.0 | M 4.8 x 4.0 | L 7.2 x 5.6, hall 9+ x 6+; walkable floor at least 3.0 m2 (`AUDIT.interiorMinArea`) after furniture |
| Path width, clear between solids | track 1.6 | street 2.4, road 3.6 | a wagon road is 4.0+; a gangway or a stair may squeeze to 1.2 with `minWidth` and a comment |
| Gap between two buildings | 3.0 | 4.0+ | a street (2.4) plus a hand each side; an alley of 1.6 is allowed ONCE per region and must lead somewhere |
| Building to cliff, water's edge or fence | 1.6 | 2.4 | so the camera and a stumbling body do not wedge |
| Fence / parapet height | 0.95 | 1.1 | steppable props stay under 0.5 (crates, curbs); anything 0.5-1.0 is a vault-less wall: do not leave a 0.6 m knee wall as a "step" |
| Stair or ramp | rise 0.25-0.4 per tread | tread 0.5 | a ramp's slope at most 0.45 rise/run on a walked route (the step allows 1.2: that is a cliff, not a path) |
| Prop footprint clearance | 0.15 from a wall | 0.6 from a door apron | see section 5 |

Terrain under a building is a flat PAD (`VILLAGE_PADS` pattern): a floor never sits on a slope; the pad blends out over 3.4 m.

## 2. Zoning: hub, approach, set-piece, reward, return

Every region is the same five-beat walk, so a player always knows where they are in it:
1. **Hub** (the landing): a plaza of radius 8-12 m, flat, open, with the boat, one lamp, one sign and room for four. The first landmark is visible from here (section 3). Nothing hostile within 40 m unless the contract says so.
2. **Approach**: 130-260 m of readable route (a road, a boardwalk, a processional) from the hub to the set-piece: 30-60 s at a run. At least three changes of view (a bend, a rise, a crossing) and one small payoff on the way (a prop cluster with a story, a lookout, a vendor, a sign that is a joke). A region whose approach is under 20 s must say why in its table.
3. **Set-piece**: the contract's stage. 25-45 m across, with a clear 6 m ring round every speaking position (a parley is a circle, not a corridor), two ways in (so enemies and followers can flank: nav routes, section 6), cover every 6-10 m where a fight is possible, and a landmark behind it that tells you where you are.
4. **Reward**: one place worth the detour within 25 m of the set-piece: a hero interior (section 4), a vista, or a lore prop cluster. A player who skips it loses colour, never progress.
5. **Return**: the way back is the same route, or a shortcut at least 40% shorter that the set-piece opens (a gate, a bridge, a ford). The dock prompt is within 4 m of the landing; nothing blocks the walk home after a fight (a dead end the player can fall into must have a way out: a ramp, steps, a ledge of 0.5).

Zone per region (the per-region tables in section 7 name every piece):

| Region | Hub (landing) | Approach | Set-piece(s) | Reward | Return |
| --- | --- | --- | --- | --- | --- |
| Hollowmere | camp + HQ marquee at the origin; jetty is the dock | the street north to the clock gate (z -30..-45) | the plaza before the hall (-21,-57) | the hall interior, the mill | the street back; the jetty |
| Kessar | the beach and pier (0,88) | the beach road north to the customs yard (0,5): about 80 m, short, so it needs the palms, the signs and the Syndicate camp's smoke as three landmarks | the bridge and toll (0,8..20); the camp (-34,52); the ford (46,20) | the toll booth interior; the gate terminus (0,-30) | the road; the ford is the shortcut once held |
| Highmark | the quay (0,118) | the grass road north 120+ m through the herds past the Waiting Stones (-4,62), the milestones | the court before the palace (0,-92) | the Assembly Hall interior (30,-63), the throne vista | the processional down |
| Vesper | the wharf (0,118) | the ore road (0,112) to (0,16): about 100 m of rising gorge | the adit and fall (0,-92); the pegging ground (-38,-30); the cloister (-40,44) | the Long Cloister gallery and its Records Room | the ore road; the trestle is the high way once crossed |
| Saltmarket | the quay (0,118) | the main boardwalk (0,112) to (0,12) over the customs bridge | the Exchange (0,-44); the customs (-34,70); the cove (58,-6) | the Customs counting-house; the rostrum's view | the boardwalk |

## 3. Sightlines and landmarks

- From the landing the player sees ONE tall landmark (at least 14 m) within 60 degrees of the direction of travel, and a second, different one from the first bend. Kessar: the fort's keep and lamps; Highmark: the palace pyramid and lantern tower; Vesper: the headframe (24 m); Saltmarket: the campanile (14 m) and the Exchange's roof; Hollowmere: the clock gate and the windmill.
- From every set-piece the region's landmark stays visible or its silhouette is hinted (a banner mast, a smoke column): you can always find north.
- No stretch of more than 120 m of path without a change in what is on the horizon.
- Silhouette first (ART_DIRECTION): a building is recognised by its roof line at 60 m; two buildings of the same type are never the same distance apart twice in a row (the 5.0-pitch pillar row is the one exception: a colonnade).
- Fights: no sightline across the set-piece longer than 40 m (the rifle's falloff starts there); put a wall, a cart or a rock at 25 m; leave one long lane on purpose for the sniper, and put cover at its far end.
- Dead ends are allowed ONLY if they pay: a prop cluster, a lore sign, a vista, a locked-looking door with a joke (a sealed door is a destination: "Pending"), a seat. An unlabelled cul-de-sac with nothing in it is a finding (`detour`/review).
- At least one LOOP of two routes between hub and set-piece (the nav grid's flank routes need it); the shorter is 3.0+ m wide, the longer 2.4+.
- Camera: the third-person camera needs 2.0 m behind and 0.95 m beside the head to be clear of the wall in the lane (so streets are 2.4 minimum; a 1.6 track is a path in the open, never between walls taller than 2.5 m).

## 4. Interior rules and the door law

THE LAW: **every door the view draws is one of the five kinds below, declared in the plan, and the collision world agrees with it.** There is no sixth kind, and in particular no door painted on a solid wall that looks as if it opens.

| Kind | What it is | Collision | What the view draws |
| --- | --- | --- | --- |
| `interior` | a walkable room | wall boxes with a doorway gap of the declared width (`ringWalls` in village.ts is the pattern); a floor slab at threshold height | an open door (leaf swung back, or a dark opening) and a lit room |
| `passage` | an arch or gate you walk THROUGH | the lintel is a high box above 3.2 m, no wall in the opening | the arch; whatever is beyond |
| `open-front` | a porch, colonnade, stall or pavilion with no door | the back and sides only; the front is open | roof on posts; furniture inside |
| `sealed` | a facade that is shut | a solid wall (nothing walks through it) | the door SHUT: boards or a bar across it, a padlock, a paper seal, a painted-on frame; NO handle you could imagine turning, no lit window, no worn path to it, and a small sign or prop that says why ("PENDING", "CLOSED FOR AUDIT") |
| `solid` | a mass with no door at all | solid | windows or nothing; never a door shape |
| `tent` | canvas | solid box (small) | the flap TIED SHUT; a bedroll or a boot outside |

Rules:
1. Every `interior` door has a `RoomRect` (`levelAudit.ts`): the audit walks a body from 1 m outside the door to the room's centre with the real step, then flood-fills the floor at 0.4 m and requires `AUDIT.interiorMinArea` of standing space.
2. Every door is IN a wall of its own building (the audit's `door-floating` check): a door is never placed by eye on a face that is not the building's.
3. Door clear width and height meet section 1 (`door-too-narrow`, `door-too-low`). The doorway gap in the collision is the declared width, not a hair more or less.
4. The apron (1.6 m deep, door width plus 0.3 each side) is open ground: no prop, no tree, no other building's solid, no parked cart. A door that faces a wall, a cliff or a river within 1.6 m is moved or sealed.
5. `sealed` doors really are sealed (`sealed-door-passable` fails otherwise), and the facade LOOKS sealed (above). A `sealed` door is a designed joke or a lock, never a lazy block.
6. `interior` rooms are LIT: a lamp, a window with a warm glow at dusk, or a skylight; the audit requires `room.lit` and the view must make it true (a baked emissive on the floor plane or a point-free glow quad, never a real light per room). The roof's underside is a warm wood or plaster colour, never `INTERIOR` black.
7. The camera: while the local player is inside `roomAt(rooms, x, z, 0.3)` the view hides that building's roof and front-wall cap (a cutaway), so the third-person camera never sits under a ceiling; first person is unaffected. The view builds a `roof:<building id>` group per interior and toggles it from the same `RoomRect` the audit used.
8. Interior furniture keeps a 1.0 m clear strip from the threshold to the room's centre, and nothing in a room is higher than 1.2 m except posts and shelves against walls.
9. Budget: one hero interior per region, the hub's village rooms and the rooms a template needs (Saltmarket's two sheds and the drop); every other building is `sealed`, `solid` or `open-front`. (The satire of a colonial map where every door is a "Pending" is a feature; the budget keeps one developer alive.)
10. Interiors are never routes the contract needs: a mission never requires entering a room unless it is `interior` and in the region's table.

## 5. Prop placement rules

- A prop's footprint (`propRadius(kind)`, plus `AUDIT.propMargin`) never intersects a wall, a building, a tree, a rock or another prop beyond 0.06 m of contact (`footprint-overlap`, `prop-in-wall`).
- 0.6 m clear of any wall, 1.6 m (the apron) clear of any door, and 0.15 m off the edge of a path (`prop-on-door-apron`, `prop-on-path`). Clusters (a crate stack, a barrel row) leave 0.15 m between their parts unless they are one stacked structure.
- Props sit on a pad or a level: slope under the footprint at most 0.3 rise/run; stacked props are one footprint with a height.
- A prop cluster tells a story in three pieces (what, who, what happened): barrels and a cart with a broken wheel; a table, two stools and a spilled bottle. A cluster is 3-7 pieces in a 3 m circle with a 2.4 m street kept past it.
- Spawned props (`regionProps`) are carried and thrown: they are placed in the open, never on a deck's edge, in water, on a roof or a plinth the player cannot step on.
- Seeded scatter (trees, rocks, scrub) keeps clear of every door apron, every route (route half-width + 1.2 m), every station and every story point (`sitePoints`), and never lets two natural solids intersect by more than 0.2 m (warn level).
- Signs, lamps and banner poles stand 0.3 m off the walk, never in the centre of a lane, and never within 1.0 m of a door.

## 6. Paths, routes and navigation

- Every region declares its routes (`AuditRoute`): the main road, each branch to a set-piece, each bridge and ramp. The audit walks each end to end with the real step and measures width every metre (`route-blocked`, `path-too-narrow`).
- Route classes: `track` (1.6), `street` (2.4), `road` (3.6). A choke (bridge deck, gangway, stair) may be narrower with a `minWidth` of at least 1.2 and a comment; there are at most two per region.
- The nav grid (`regionNavOptions`, cell 2 m, clearance 0.55) must agree: every route is open at the nav's resolution, and every set-piece has two entries.
- A drop of more than 1.0 m is not a route (`AUDIT.maxDrop`): a plank over a gorge is a bridge with a rail, a ledge you can fall from has a railing or is meant to be a fall.
- Water: wading is 0.0-0.8 m of depth and slows nobody; deep water is closed by the nav and fenced or cliffed for the player; a shore is a ramp, not a lip.
- The spawn ring (radius 2.6 m, four) is open ground, flat, with a clear exit in at least three directions, and joins the region's main walkable component (`stuck-spawn`).

## 7. Per-region site plans (intended footprints, doors and interiors)

These tables are the plan of record. "now" is what the baseline found; "intended" is what package L builds; a row marked `sealed`, `solid` or `tent` is complete when its view obeys section 4; a row marked `interior` also gets a `RoomRect`, a door of the stated width, a lamp, a roof cutaway and furniture. Coordinates are world x,z (x east, z south); footprints are full width x depth in the building's own frame (door on the local +x face); `h` is the height of the highest point above the ground. L may nudge a position by up to 3 m to satisfy the rules (record it in the row), and may change a footprint only upward (never smaller than "now") unless the row says so.

Hero interiors (one per region, the reward zone): Hollowmere the hall; Kessar the toll booth; Highmark the Grange Assembly Hall; Vesper the Long Cloister gallery; Saltmarket the Customs counting-house. Every other enterable building is a village room (Hollowmere only) or a room a contract template needs (Saltmarket's two quayside sheds and the drop house: the smuggling run delivers into them).

### H. Hollowmere (hub village)

| id | kind | at x,z | yaw | footprint W x D (m) | now: door | intended | door (clear w, face) -> room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gate | clock | 3,-45.2 | -2.7 | 3.8 x 2.8 | 3.2 wide | passage (arch 3.2) | 3.2, +x front (1,-46) |
| cot-a | cottage | 5.6,-38.2 | -1.5 | 4.8 x 4.1 | 1.15 wide | interior S | 1.5, +x front (6,-41) |
| mill | mill | -1.4,-37 | -1.2 | 4.7 x 5.8 | 1.35 wide | interior M | 1.5, +x front (-1,-39) |
| shop | workshop | -6,-55.6 | 1.7 | 5.4 x 6.4 | open front | open-front | - |
| gran-a | granary | -9.2,-45.9 | -1.7 | 4 x 4 | none | sealed (hatch up a ladder; no ground door) | - |
| stilt-w | stilt | -28.4,-46.4 | 0 | 3.9 x 3.9 | 0.95 wide | interior S | 1.4, +x front (-26,-46) |
| stilt-e | stilt | -14.6,-46.2 | 3.1 | 3.9 x 3.9 | 0.95 wide | interior S | 1.4, +x front (-17,-46) |
| hall | hall | -21,-65.6 | 1.6 | 8.2 x 10.6 | 2.3 wide | interior L (hero) | 2.4, +x front (-21,-61) |
| gran-b | granary | -33.6,-56 | 1.3 | 4 x 4 | none | sealed (hatch up a ladder; no ground door) | - |
| cot-b | cottage | -39.8,-51.8 | 0.9 | 4.8 x 4.1 | 1.15 wide | interior S | 1.5, +x front (-38,-50) |
| cot-c | cottage | -34.8,-31.6 | -2.9 | 4.8 x 4.1 | 1.15 wide | interior S | 1.5, +x front (-37,-32) |
| stall-1 | stall | -28.2,-57 | 0 | 2.2 x 3.2 | none | open stall | - |
| stall-2 | stall | -28.2,-61.3 | 0 | 2.2 x 3.2 | none | open stall | - |
| stall-3 | stall | -13.8,-57 | 3.1 | 2.2 x 3.2 | none | open stall | - |
| stall-4 | stall | -13.8,-61.3 | 3.1 | 2.2 x 3.2 | none | open stall | - |
| hq.marquee | camp | -3.35,-8.4 | 0 | 6.9 x 5.2 | open pavilion: back and north canvas, front and south rolled up | open-front (keep): the planning table, chairs and the chest stay inside; 1.6 m clear from the mouth to the table | - |
| camp.bell tents x2 | camp | -8,3 / -8.4,-4 | 0.28 / -0.2 | 4.0 x 3.2 | solid, flap drawn facing the fire | tent: flap tied shut (sealed) | - |
| jetty (dock) | river | JETTY | - | deck | walkable | keep; the boat prompt's apron 4 m radius stays open | - |

### K. Kessar Reach

| id | at x,z | footprint W x D (m) | h | now | intended | door -> room |
| --- | --- | --- | --- | --- | --- | --- |
| fort.gate (door box) | 0,-38 | 6 x 1.2 | 5 | solid wall box; drawn: barred door, portcullis, nine lamps | sealed gate (portcullis down, chained, paper seal); apron is a terminus with a bench and the notice | sealed; apron 6 x 4 open ground at (0,-30) |
| fort.curtain | ring r=22 about 0,-60 | 21 segments, 2.4 thick | 10 | true wall | wall (unchanged) | - |
| fort.tower0 | -16,-44 | r 3.2 | 12 | solid, conical roof | solid (backdrop) | - |
| fort.tower1 | -16,-76 | r 3.2 | 12 | solid, conical roof | solid (backdrop) | - |
| fort.tower2 | 16,-76 | r 3.2 | 12 | solid, conical roof | solid (backdrop) | - |
| fort.tower3 | 16,-44 | r 3.2 | 12 | solid, conical roof | solid (backdrop) | - |
| fort.bastion0 | -6,-39 | 5.2 x 5.2 | 10 | solid | solid | - |
| fort.bastion1 | 6,-39 | 5.2 x 5.2 | 10 | solid | solid | - |
| fort.keep + halls[3] | 0,-66 | 13 x 12 (keep) | 16 | drawn inside the sealed wall, no collision | backdrop, drawn only (flagged unreachable: not in the audit's must-reach list) | - |
| toll.booth | -6.6,6.4 | 2.8 x 2.4 | 2.6 | solid box, drawn with a door and a window | interior S -> M: grow to 4.8 x 4.0, desk and ledger inside, lamp (the one reward interior); re-check the sentry posts (-4,8.5) and (-2,3) and the parley spot (-6,12) against the new footprint | 1.5, facing the customs yard (E) at -4,6 |
| toll.desk | 5.4,5 | 1.6 x 1 | 0.9 | solid | solid (prop) | - |
| syndicate.tent0 | -38,49 | 4.0 x 3.2 | 2.4 | solid box, drawn with a door flap | tent: flap tied shut (sealed), no walkable door | - |
| syndicate.tent1 | -29,47 | 4.0 x 3.2 | 2.4 | solid box, drawn with a door flap | tent: flap tied shut (sealed), no walkable door | - |
| syndicate.tent2 | -36,56 | 4.0 x 3.2 | 2.4 | solid box, drawn with a door flap | tent: flap tied shut (sealed), no walkable door | - |
| orchard.tent0 | 63,-20 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |
| orchard.tent1 | 81,-22 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |
| orchard.tent2 | 72,-31 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |
| pier | 0,102 | 3.2 x 20 | deck | walkable deck | keep; 3.2 m wide is a street (min 2.4) | - |
| bridge | 0,20 | 5.5 x 22 | deck | walkable deck, parapets | keep (road, 5.5 wide) | - |

### M. Highmark

| id | at x,z | yaw | footprint W x D (m) | h | now | intended | door -> room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gate.towerW | -6.8,-58 | 0 | 5.2 x 6.4 | 9 | solid | solid (tower) | - |
| gate.towerE | 6.8,-58 | 0 | 5.2 x 6.4 | 9 | solid | solid (tower) | - |
| gate.passage | 0,-58 | 0 | 8.4 clear between towers | 6.2 | walkable (lintel 3.6 m up) | passage (keep; lintel clearance 3.6 >= 3.2) | through (0,-54) |
| palace | 0,-108 | 0 | 20 x 8 | 7.5 | solid, drawn with a great door | sealed: the great door is sealed with the Chamberlain's paper seal ("pending"); the court in front is the stage | sealed at (0,-104) |
| hall0 | 30,-63 | -0.7 | 13 x 6.8 | 6.5 | solid, drawn with a door and slits | interior L (hero): the Grange Assembly Hall, 13 x 6.8, double door 2.4, benches, the harvest bell on a beam | 2.4, +x front (34,-68) |
| hall1 | -41,-79 | 1.2 | 11 x 6 | 5.5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| hall2 | -12,-70 | 0.4 | 9 x 5.2 | 5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| hall3 | -25,-81 | 1 | 9 x 5.2 | 5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| hall4 | 26,-84 | -1.1 | 9 x 5.2 | 5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| hall5 | 27,-106 | -1.9 | 9 x 5.2 | 5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| hall6 | -27,-106 | 1.9 | 9 x 5.2 | 5 | solid, drawn with a door and slits | sealed facade (granary hall: shutters nailed, a door painted shut with the Grange's mark) | sealed |
| granary0 | -46,-50 | - | r 2.6 | 5 | solid, a plank door and a window slit drawn | sealed: a hatch up a ladder; no ground-level door drawn | - |
| granary1 | -55,-62 | - | r 2.6 | 5 | solid, a plank door and a window slit drawn | sealed: a hatch up a ladder; no ground-level door drawn | - |
| granary2 | -61,-75 | - | r 2.6 | 5 | solid, a plank door and a window slit drawn | sealed: a hatch up a ladder; no ground-level door drawn | - |
| stall0 | -22,-48 | 0.4 | 3 x 2 | 2.4 | solid | open stall (counter at the front, poles; keep) | - |
| stall1 | -13,-45 | 0.2 | 3 x 2 | 2.7 | solid | open stall (counter at the front, poles; keep) | - |
| stall2 | -3,-43 | 0.1 | 3 x 2 | 2.4 | solid | open stall (counter at the front, poles; keep) | - |
| stall3 | 7,-44 | -0.1 | 3 x 2 | 2.7 | solid | open stall (counter at the front, poles; keep) | - |
| stall4 | 17,-46 | -0.3 | 3 x 2 | 2.4 | solid | open stall (counter at the front, poles; keep) | - |
| well | 44,-65 | - | r 1.3 | 1.1 | solid | solid prop | - |
| throne | 0,-101 | 0 | 1.1 x 1.1 | 1.7 | solid (the Vacant Chair) | solid prop on its dais; 6 m clear all round for the parley | - |

### V. Vesper Gorge

| id | at x,z | yaw | footprint W x D (m) | h | now | intended | door -> room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cloister | -47.5,44 | 0 | 11 x 36 | 7.2 | solid; 7 arches drawn on a solid mass | open-front gallery (hero): the arches are the openings into a 3.0 m deep lit gallery along the whole 36 m face; the Records Room is a door at its north end | 7 arches, each 2.4 clear; gallery floor at ground |
| assay | 39,16 | 0 | 11 x 10 | 6.4 | solid, a stout door under a hood drawn | sealed: iron grille shut, a counter window beside it (talk through the window) | sealed |
| office | -19,-84 | 0 | 7.2 x 6 | 3.6 | solid, a porch with a bell-pull drawn | sealed: locked, the ledger window open; the porch (1.6 deep) is open ground | sealed |
| magazine | -24,-73 | 0 | 4.8 x 4 | 2.6 | solid, iron door drawn | sealed: iron door padlocked (the keg's source) | sealed |
| winding | 31,-77 | 0 | 6 x 6 | 4.4 | solid | solid (no door drawn) | - |
| tipple | -38,-66 | 0 | 6 x 6.4 | 5.2 | solid | solid (no door drawn) | - |
| headframe | 26,-66 | 0 | 4.8 x 4.8 | 24 | solid tower on the terrace | solid landmark (24 m) | - |
| trestle | -5,-66 | 0 | 57.6 x 3 | deck | walkable deck, rails | keep (3.0 wide is a street) | - |
| fall | 0,-96 | 0 | 32 x 3.8 | 6 | solid plug (the rock fall) | solid until the template clears it; the pocket behind it is `mustReach: false` until then | - |
| syndicate.tent0 | -23,-42 | 0.3 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |
| syndicate.tent1 | -17,-35 | -0.2 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |
| syndicate.tent2 | 20,-84 | 0.2 | 4.0 x 3.2 | 2.4 | solid | tent: flap tied shut (sealed) | - |

### S. Saltmarket Delta

| id | at x,z | yaw | footprint W x D (m) | h | now | intended | door -> room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| warehouse0 | -44,108 | 0 | 13 x 8 | 3.9 | solid box on stilts, shutters and a door drawn | interior M: the Brine Counting-Shed (quayside, west) | 1.5 + a 3-step landing, +x front (-37,108) |
| warehouse1 | 46,110 | 0 | 12 x 8 | 4.3 | solid box on stilts, shutters and a door drawn | interior M: the Society Bonded Shed (quayside, east): the smuggling run's cargo is inside | 1.5 + a 3-step landing, +x front (52,110) |
| warehouse2 | -26,-2 | 0.3 | 5.2 x 4 | 3.1 | solid box on stilts, shutters and a door drawn | sealed (shuttered stilt warehouse, loading door chained) | - |
| warehouse3 | 20,-26 | 0.5 | 5.2 x 4 | 3.2 | solid box on stilts, shutters and a door drawn | sealed | - |
| warehouse4 | 70,-22 | 0.3 | 6.4 x 4.8 | 3.2 | solid box on stilts, shutters and a door drawn | sealed | - |
| warehouse5 | 96,30 | -0.4 | 5.6 x 4.4 | 3.1 | solid box on stilts, shutters and a door drawn | solid (no door drawn; no route) | - |
| warehouse6 | -92,22 | 0.2 | 6 x 4.8 | 3.2 | solid box on stilts, shutters and a door drawn | solid (no door drawn; no route) | - |
| warehouse7 | -80,-92 | -0.3 | 5.2 x 4 | 3 | solid box on stilts, shutters and a door drawn | solid (no door drawn; no route) | - |
| customs | -40,61 | 0 | 8.4 x 6 | 4.2 | solid; a flagpole stands INSIDE its footprint at (-36,60) (found by the baseline audit) | interior M (hero): the Customs counting-house, the Tide-Reeve's parley; move the flagpole clear of the walls to (-34.4,61), the east gable's foot | 1.5, facing the boardwalk (N, toward z+): (-40,64) |
| dropHouse | -69,-58 | 0 | 9 x 6.4 | 3.8 | solid; the template's `dropDoor` station stands at (-63,-58) | interior S: the drop (a bare room, a hatch, a lamp) | 1.5, facing the boardwalk's end (E) at (-64,-58) |
| exchange | 0,-46 | 0 | 30 x 26 | 3.6 | open colonnade (12 pillars r 0.7), back wall, rostrum | open-front hall (keep): 5.0 pillar pitch leaves 3.6 clear; the rostrum 1.6 x 0.7 stays | - |
| boardwalks | main, cove, drop, customs | - | 2.4-3.0 wide | deck | walkable | keep (street class); pinch check every metre | - |
| bridge:customsBridge | 0,92 | 0 | 4.8 x 17.2 | deck | walkable deck, parapets | keep | - |
| bridge:coveBridge | 36,-6 | 1.6 | 4.8 x 15.2 | deck | walkable deck, parapets | keep | - |
| bridge:reedBridge | -54,-24 | 1.6 | 4.8 x 15.2 | deck | walkable deck, parapets | keep | - |


### As built (package L, D-038): every `LevelBuilding` and where it differs from the plan above

The regions declare their buildings in `levelOf(...)` (`village.ts`, `kessar.ts`, `highmark.ts`, `vesper.ts`, `saltmarket.ts`); `levelPlanDoc.test.ts` fails if an id there has no row in this document. Kinds are as built; "moved" is the nudge from the plan above (all within the 3 m allowance); footprints are full W x D.

Deviations that apply to a whole region:
- All regions: every drawn door is a `DoorMark` the view pushes from the same numbers as the collision (`doors.test.ts`); interior roofs are one merged mesh with a cutaway index-rewrite (`RoofSet`), so the view mesh budgets did not loosen.
- Hollowmere: cottages 1.5 and stilt houses 1.4 clear (plan said 1.5 for both; the stilt deck is 1.2 m up, so 1.4 keeps the stair rail), the hall 2.4 with a 3.0 door height. The granaries are `solid` (a hatch and ladder drawn; no ground door). The hall pad blends over 8 m (others 3.4): 12 broke the shop's level ground. Mill sacks moved to 0.7 m spacing right of the door; the villager station `mill-sacks` stands in front of the pile.
- Kessar: toll booth grown to 4.8 x 4.0 at (-8.8,4.6), moved 2.2 m west and 1.8 m north so the sentry posts and the parley spot keep their clearance; the camp wagon moved to (-26,50.4).
- Highmark: the plan's `gate.towerW/E` are `gate.tower0/1` in code; the gate is a `passage` with a 3.6 m lintel clearance. Halls 1-6 are rotated a quarter turn so the sealed door is on the long outward face. The granaries sit at radius 66 and are `solid` with a hatch and ladder.
- Vesper: the cloister is `open-front` with a gallery `rect` and a separate `records` interior (7.2 x 3.1, floor 0.25: a 0.35 floor was unreachable on some seeds). The office moved to (-15,-81) and the tipple to (-38,-63.2) (a hopper, no door-like mouth); tent2 to (22.5,-84.5).
- Saltmarket: warehouses 0 and 1 are 5.1 and 5.3 high, warehouse1 faces west (yaw pi); the Customs House faces east (yaw pi/2, 6.0 x 8.4); three new boardwalk spurs (`customsDoor`, `shedW`, `shedE`) reach the three interiors. Sealed warehouses carry plaques: "CLOSED FOR TIDE", "BONDED. CHAIN BY ORDER.", "LOT WITHDRAWN".

| region | id | kind | at x,z | yaw | W x D | h | floor | door (w / h) | steps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hollowmere | cot-a | interior | 5.6,-38.2 | -1.47 | 4.8x4.1 | 5 | 0.2 | 1.5 / 2.4 | 0 |
| Hollowmere | mill | interior | -1.4,-37.0 | -1.21 | 4.7x5.8 | 6.3 | 0.3 | 1.5 / 2.4 | 0 |
| Hollowmere | shop | open-front | -6.0,-55.6 | 1.71 | 5.4x6.4 | 4.32 | 0.12 | - | 0 |
| Hollowmere | gran-a | solid | -9.2,-45.9 | -1.67 | 4.0x4.0 | 6.7 | 0.6 | - | 0 |
| Hollowmere | stilt-w | interior | -28.4,-46.4 | 0.00 | 3.9x3.9 | 6 | 1.2 | 1.4 / 2.4 | 0 |
| Hollowmere | stilt-e | interior | -14.6,-46.2 | 3.14 | 3.9x3.9 | 6 | 1.2 | 1.4 / 2.4 | 0 |
| Hollowmere | hall | interior | -21.0,-65.6 | 1.57 | 8.2x10.6 | 9.8 | 0.9 | 2.4 / 3 | 0 |
| Hollowmere | gran-b | solid | -33.6,-56.0 | 1.32 | 4.0x4.0 | 6.7 | 0.6 | - | 0 |
| Hollowmere | cot-b | interior | -39.8,-51.8 | 0.93 | 4.8x4.1 | 5 | 0.2 | 1.5 / 2.4 | 0 |
| Hollowmere | cot-c | interior | -34.8,-31.6 | -2.89 | 4.8x4.1 | 5 | 0.2 | 1.5 / 2.4 | 0 |
| Hollowmere | stall-1 | open-front | -28.2,-57.0 | 0.00 | 2.2x3.2 | 3.8 | 0 | - | 0 |
| Hollowmere | stall-2 | open-front | -28.2,-61.3 | 0.00 | 2.2x3.2 | 3.8 | 0 | - | 0 |
| Hollowmere | stall-3 | open-front | -13.8,-57.0 | 3.14 | 2.2x3.2 | 3.8 | 0 | - | 0 |
| Hollowmere | stall-4 | open-front | -13.8,-61.3 | 3.14 | 2.2x3.2 | 3.8 | 0 | - | 0 |
| Kessar | toll.booth | interior | -8.8,4.6 | 0.00 | 4.8x4.0 | 3.6 | 0.2 | 1.5 / 2.4 | 0 |
| Kessar | fort.gate | sealed | 0.0,-38.0 | 1.57 | 1.2x6.0 | 5 | 0 | 3.6 / 3.4 | 0 |
| Kessar | fort.bastion0 | solid | -5.7,-38.7 | 3.40 | 5.2x5.2 | 10 | 0 | - | 0 |
| Kessar | fort.bastion1 | solid | 5.7,-38.7 | 9.16 | 5.2x5.2 | 10 | 0 | - | 0 |
| Kessar | syndicate.tent0 | tent | -38.0,49.0 | 0.30 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Kessar | syndicate.tent1 | tent | -29.0,46.5 | -0.25 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Kessar | syndicate.tent2 | tent | -36.0,55.5 | 0.10 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Kessar | orchard.tent0 | tent | 62.5,-20.5 | 0.35 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Kessar | orchard.tent1 | tent | 81.0,-22.5 | -0.30 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Kessar | orchard.tent2 | tent | 72.0,-31.5 | 0.10 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Highmark | hall0 | interior | 29.6,-63.2 | -0.73 | 13.0x6.8 | 6.5 | 0.3 | 2.4 / 3 | 0 |
| Highmark | hall1 | sealed | -41.0,-79.4 | 2.76 | 6.0x11.0 | 5.5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | hall2 | sealed | -12.3,-69.7 | 2.01 | 5.2x9.0 | 5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | hall3 | sealed | -25.1,-81.5 | 2.62 | 5.2x9.0 | 5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | hall4 | sealed | 26.3,-83.7 | 0.44 | 5.2x9.0 | 5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | hall5 | sealed | 27.3,-105.9 | -0.35 | 5.2x9.0 | 5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | hall6 | sealed | -27.3,-105.9 | 3.49 | 5.2x9.0 | 5 | 0 | 1.5 / 2.4 | 0 |
| Highmark | palace | sealed | 0.0,-108.0 | 1.57 | 8.0x20.0 | 7.5 | 0.8 | 3.2 / 4 | 0 |
| Highmark | gate.tower0 | solid | -6.8,-58.0 | 0.00 | 5.2x6.4 | 9 | 0 | - | 0 |
| Highmark | gate.tower1 | solid | 6.8,-58.0 | 0.00 | 5.2x6.4 | 9 | 0 | - | 0 |
| Vesper | cloister | open-front | -47.5,44.0 | 0.00 | 11.0x36.0 | 7.2 | 0 | - | 0 |
| Vesper | records | interior | -44.5,29.6 | 1.57 | 7.2x3.1 | 7.2 | 0.25 | 1.5 / 2.4 | 0 |
| Vesper | assay | sealed | 39.0,16.0 | 3.14 | 11.0x10.0 | 6.4 | 0 | 1.5 / 2.4 | 0 |
| Vesper | office | sealed | -15.0,-81.0 | 0.00 | 7.2x6.0 | 3.6 | 0 | 1.5 / 2.4 | 0 |
| Vesper | magazine | sealed | -24.0,-73.0 | 0.00 | 4.8x4.0 | 2.6 | 0 | 1.5 / 2.4 | 0 |
| Vesper | winding | solid | 31.0,-77.0 | 0.00 | 6.0x6.0 | 4.4 | 0 | - | 0 |
| Vesper | tipple | solid | -38.0,-63.2 | 0.00 | 6.0x6.4 | 5.2 | 0 | - | 0 |
| Vesper | syndicate.tent0 | tent | -23.0,-42.0 | 0.30 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Vesper | syndicate.tent1 | tent | -17.0,-35.0 | -0.25 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Vesper | syndicate.tent2 | tent | 22.5,-84.5 | 0.20 | 4.0x3.2 | 2.4 | 0 | - | 0 |
| Saltmarket | warehouse0 | interior | -44.0,108.0 | 0.00 | 13.0x8.0 | 5.1 | 0.9 | 1.5 / 2.4 | 3 |
| Saltmarket | warehouse1 | interior | 46.0,110.0 | 3.14 | 12.0x8.0 | 5.3 | 0.9 | 1.5 / 2.4 | 3 |
| Saltmarket | warehouse2 | sealed | -26.0,-2.0 | 1.20 | 5.2x4.0 | 4.4 | 0.9 | 1.5 / 2.4 | 0 |
| Saltmarket | warehouse3 | sealed | 20.0,-26.0 | 0.50 | 5.2x4.0 | 4.5 | 0.9 | 1.5 / 2.4 | 0 |
| Saltmarket | warehouse4 | sealed | 70.0,-22.0 | 0.25 | 6.4x4.8 | 4.5 | 0.9 | 1.5 / 2.4 | 0 |
| Saltmarket | warehouse5 | solid | 96.0,30.0 | -0.40 | 5.6x4.4 | 3.1 | 0.9 | - | 0 |
| Saltmarket | warehouse6 | solid | -92.0,22.0 | 0.20 | 6.0x4.8 | 3.2 | 0.9 | - | 0 |
| Saltmarket | warehouse7 | solid | -80.0,-92.0 | -0.30 | 5.2x4.0 | 3 | 0.9 | - | 0 |
| Saltmarket | customs | interior | -40.0,61.0 | 1.57 | 6.0x8.4 | 5.6 | 0.9 | 1.5 / 2.4 | 3 |
| Saltmarket | dropHouse | interior | -69.0,-58.0 | 0.00 | 9.0x6.4 | 4.3 | 0.6 | 1.5 / 2.4 | 2 |

Audit and generator fixes the plan needed (each has a regression test): `clearWidth` measures at the route's own height (a bridge was measured on the bed beneath it); `walkTo` counts a fall only as height lost while airborne (a long gentle slope is not a drop); `AuditDoor.floorY` lets a raised deck door be reached by its stair; `clearing.ts` `bridgeDeck` is clamped to bank + 0.42 (the footbridge was a wall on about 40% of seeds); props and scatter keep out of door aprons, hq lines and the drovers' track.

Known residue, unowned: the hub fails on roughly 1 random seed in 40 (`trail.village`, `hq.dock.lane` pad slope), and `arena.ts` scatter can still overlap a rock and a ruin on a rare seed (a radius-aware `tooClose` there would end it). The audited contract seeds are clean.

### Routes, spawns and prop clusters per region (the audit's `routes`, `spawns` and `props`)

| Region | Routes (class; endpoints; source of truth) | Spawn ring | Authored prop clusters (story in three pieces) |
| --- | --- | --- | --- |
| Hollowmere | `street.north` (street): camp (0,-14) to the clock arch (3,-45); `street.plaza` (street): arch to the hall's steps (-21,-61); `jetty` (track): the boat's deck. L reads the real footpaths from `villagerNav.ts` (the villagers already walk them) | `spawnPoint(i, n)` ring in the flat spawn clearing, r 14 | the supply pyramid + crates + notice board at the marquee mouth; the gramophone and tea table; the washing line; the smithy's forge corner; the hall's benches and dais |
| Kessar | `road.main` (road): landing (0,88) - (0,40) - bridge south end (0,31) - bridge - (0,9) toll bar - fort gate apron (0,-30); `road.camp` (street): (0,60) to the Syndicate camp (-34,52); `road.ford` (street): (0,60) to the ford (46,20); `bridge` (road, 5.5) | `kessarSpawn`: ring r 2.6 at the landing (0,88), the beach, never the pier | the powder barrels and cart (10,42); the beach stores (9 props, ring 4.5-11 m); the toll booth's ledger and desk; the camp's crates by the wagon; Marker Stone No. 4 in the ford; the Dry Cut (wrecked wagon) |
| Highmark | `road.processional` (road): `highmarkRoad()` polyline from the landing (0,112) to the gate (0,-58), ramps included; `road.grange` (street): (-6.6,-49) to the Grange (-37,-40); `road.envoy` (street): (28.7,-31.6) to the Syndicate envoy (31,-39); `road.drovers` (track): (-4,62) to the drovers' camp (-52,50) | `highmarkSpawn`: quay-side bank, never the planks | the grain barrels (3 at the quay, 3 at the drovers); the Waiting Stones' two chairs (-8.6,57..67); the court's two petitioner chairs; the stalls' sacks and baskets (5 stalls) |
| Vesper | `road.ore` (road): `vesperRoad()` landing (0,114) to the adit (0,-92); `track.assay` (track): to (30,22); `track.cloister` (street): to (-34,40); `track.pegging` (track): to (-38,-30); `trestle` (street 3.0): x -34..23.6 at z -66 | `vesperSpawn`: wharf-side bank, never the planks | ore crates and bottles at the landing; the funeral chairs before the cloister (-33,46); crates at the assay (30,25); the pegging ground's crates and chair; the timber stack by the office |
| Saltmarket | `board.main` (street): `plan.boardwalks.main` landing to the Exchange; `board.cove` (street): (0,12) to the cove pier (58,-6); `board.drop` (street): (0,-14) to the drop house (-62.5,-58); `board.customs` (street): (-14,70) to (-44,76); the three bridges (4.8 wide) | `saltmarketSpawn`: the quay's dry apron, never the planks | barrels and bottles at the quay and the huts; the unmarked crates the smuggling template places at the cove (NEVER spawned by the plan); the auction's rostrum, gavel and ledger |

## 8. The region checklist (every new region, and every region before it is `reachable`)

A region is reachable only when ALL of these are true, in this order:
1. It has a row in section 2 (zones) and section 7 (every building, door, interior, route, prop cluster), written BEFORE the code.
2. The plan is pure data in `shared/<region>.ts`; the collision, the view, the nav options and the audit adapter all read it (one source of truth, D-025).
3. `levelAuditAdapters.ts` has the region's `RegionAuditAdapter`, and `auditRegion` returns zero errors over `AUDIT_SEEDS` (`levelAuditRegions.test.ts`), with an empty allowance in the ratchet.
4. Every door is one of the six kinds and its row says which; every `interior` has a `RoomRect`, a lamp and a roof group (`roof:<id>`) the cutaway toggles; every `sealed` facade has its sign.
5. The approach is 20-60 s at a run; there are two routes into the set-piece; the landmark rule (section 3) holds from the landing and from the set-piece; a human-readable list of the three landmarks is in the row.
6. Four spawns (counts 1..4) are open ground and in the landing's walkable component; the dock prompt is within 4 m of the landing.
7. The nav grid agrees (`regionNavOptions`); the soak (`scripts/soak.mjs`) and the region-tick test pass.
8. A stills pass was LOOKED AT by a human or the integrator: landing, approach bend, set-piece, hero interior from outside and inside (roof cutaway), a sealed facade, a door apron at dusk, the region at night. `scripts/shot.mjs` renders; the list and what was seen go in BUILD_STATE.
9. No colour literal (palette guard), no `Math.random` in shared code, assets registered.

## 9. The audit, the ratchet and the baseline

`packages/shared/src/levelAudit.ts` is the arbiter. Its constants (`AUDIT`) are the numbers in section 1; the two must agree. It exports `auditRegion(input)` and the pieces (`footprintOverlaps`, `checkDoor`, `checkProps`, `checkRoute`, `checkSpawns`, `floodFill`, `walkTo`, `roomAt`). A `RegionAuditAdapter` (`seed -> RegionAuditInput`) is written per region by package L in `levelAuditAdapters.ts`; the permanent test `levelAuditRegions.test.ts` runs every adapter over `AUDIT_SEEDS` (1, 7, 42, 1337, 90210) and fails on any error beyond the region's allowance. The allowance (`AuditAllowance`, finding kind -> count) is a RATCHET: package L starts it at the baseline below and lowers it to `{}`; raising it needs a line in BUILD_STATE and D-038's addendum.

Finding kinds: `footprint-overlap`, `door-floating`, `door-too-narrow`, `door-too-low`, `door-apron-blocked`, `door-unreachable`, `door-into-wall`, `sealed-door-passable`, `door-bad-leads`, `interior-too-small`, `interior-unreachable`, `interior-unlit`, `prop-in-wall`, `prop-on-door-apron`, `prop-on-path`, `stuck-spawn`, `unreachable-point`, `route-blocked`, `path-too-narrow`, `detour`. Warnings (`prop-on-path`, `detour`, natural-natural overlaps) never fail the build and are listed in the test's output.

How reachability is decided: a flood fill over a 1 m grid from the first spawn, every edge decided by the real `stepCharacter` (a body-wide-clear, nearly level edge on bare ground is taken as walkable without stepping, which the step provably allows). Whole regions fill in about half a second. A point is reached if a reached cell lies within 2.2 m of it. Sealed pockets (the fall's far side in Vesper before the template clears it; the Kessar fort's courtyard) are listed with `mustReach: false`, and each says why in the adapter.

Baseline, measured by the architect on 2026-10-01 with GENERIC checks only (no adapters: no door, interior or group information), seed 42:
- Flood fill reaches 23.7k (Hollowmere), 39.6k (Kessar), 66.4k (Highmark), 17.6k (Vesper), 63.2k (Saltmarket) one-metre cells from the first spawn in 0.2-0.6 s each; every spawn of the four-player ring of every region is open and in the main component.
- Unreachable story points: Kessar `A.fort` (0,-60), inside the sealed wall (expected: `mustReach: false`); Vesper `miners0..2` (-3..3,-101), behind the fall (expected until the template clears it); Highmark and Saltmarket: none. (The first draft of the flood wrongly cut every Saltmarket route that crosses a deck over a drop; the fix is in the file and is tested.)
- Spawned props: 0 inside walls in every region (the spawners already test it).
- Footprint overlaps among world obstacles (different tags, more than 0.06 m): Saltmarket `house@-40,61 x pole@-36,60` 0.88 m (a flagpole through the Customs House); Vesper `rock@10,-88 x sign@7,-88` 0.22 m (a sign inside the spoil heap); Kessar 9 natural-on-natural (rocks and one tree, 0.10-0.56 m: warnings); Hollowmere 108 raw pairs, most of them parts of ONE structure (the HQ's pieces, the ruin's wall segments): L's adapter groups them, and the real ones are the two stacked crates (0.15 m), the bell tent into the marquee (0.07 m) and the marquee pieces into each other.
- Doors narrower than the standard: Hollowmere's three cottages (1.15 m) and two stilt houses (0.95 m) and the mill (1.35 m: passes the 1.3 minimum, below the 1.5 standard).
- Doors drawn on solid boxes with nothing behind them: 27 buildings (Kessar 2: the gate and the toll booth; Highmark 11: the palace, 7 halls, 3 granaries; Vesper 4: the cloister, the assay, the office, the magazine; Saltmarket 10: 8 warehouses, the Customs House, the drop house), the cloister's seven arches, and the tents' flaps. This is the "broken doors" the player saw. Each is a row in section 7.

Allowance at the start of package L's work (L lowers it): `door-into-wall` is not an allowance (the adapters declare `sealed` honestly, so these become correct by declaration or by building the room); the starting allowance was `{ "door-too-narrow": 5 }` for the hub only, and `{}` for every other region. As built, the cottages and stilt houses are widened and every allowance is `{}`.
