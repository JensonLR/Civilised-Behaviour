# The Saltmarket Delta (region four, package D4, D-037)

Record of what was built, why it is shaped as it is, how it is tested, and what is still open. Spec: `docs/_notes/regions34.md` section 4. Home power: the Brine Houses (`brine`).

## The place
A HORIZONTAL region: a line with hairs on it. A flat silt plain under a wide sky, low stilted roofs, reed beds, broken only by thin verticals (masts, cranes, lantern poles, a wind pump, the Exchange's campanile). Palette `PALETTE.saltmarket` (`paletteSaltmarket.ts`, ~38 keys): slate-blue water, grey-fawn silt, grey-brown mud, tarred plank and silvered piling, indigo and brick-coral canvas, thatch, brass, salt-white only in small amounts, lantern and window glow.

Plan (`packages/shared/src/saltmarket.ts`, pure, deterministic, allocation-free in the step):
- Terrain: a heightfield with O(1) analytic channels. Three DEEP cuts (customs z~92, west x~-54, long x~36) and seven wadeable creeks; flat-pinned discs for the quay, Exchange, customs, cove and drop-house; a lagoon at the edge. `waterDepth(x, z)` drives the shader and the flood (cosmetic, never collision).
- Deep water is a TRUE barrier. Slope alone is not a wall (`walkable()` only rejects uphill moves and a diagonal climbs any slope), so each deep cut is fenced by "fence"-tagged revetment boxes (`saltmarketRim(seed)`, the only seed-dependent collision besides the swell) and crossed by "bridge"-tagged floors with long walkable ramps beneath. `saltmarketNavOptions.deep(x, z, surf)` closes water but never a deck cell.
- Sites: Saltmarket Quay (landing), boardwalk (`walk`, 7 points), Customs House and cutter berth (z~70-76), reed cove (58,-6) with the barge, drop-house in the west reeds (door -62.5,-58), the Exchange (0,-44).
- Skyline from `walk[3]` (seed 7): open 0.875, max 10.4 deg, spikes 7 (bars: >= 0.85, <= 12, >= 6); from the landing: open 0.889, spikes 4, max 15.7. Kessar and Highmark do not satisfy the Delta's bars.
- View budget tightened to meshes {18,22,30,30}, triangles {60k,140k,350k,500k}; measured 15/19/26/26 and 41k/120k/314k/453k.

## The contracts
1. `smuggling_run` "The Quiet Barge". Endings `landed` (3 of 4 crates at the drop-house door, no won alarm), `impounded` (seen, 8 s unanswered, or sailed away with a crate carried), `scuttled` (the plug), `informed` (tell the Tide-Reeve; finder's fee), plus the forced `abandoned`. Tools: a declaration (free; the Houses take the duty and the profit), a courtesy (priced from the ledger; a stamped passage for 240 s), the signal lantern (draws the patrol off for 70 s). The patrol walks the boardwalk in 70 s legs (the runner's `march` does not loop, so the template re-orders it every leg). A Ward patrolman may be dealt at 90 s (complication `ward_patrol`).
2. `flooded_market` "The Auction at High Water". The Exchange floods; the hammer falls at a seeded `high` (330-450 s; rain earlier, fog later). The price rises 6 pounds every 30 s. Endings `lot_won` (a bid above the loudest paddle), `consortium` (two signatures: Houses and/or the Syndicate's factor), `shorted` (a sell-short bid; commission as loot, a broken promise), `washed_out` (nobody wins, or violence suspends the sale), plus `abandoned`. Tools: buy a House-Head's paddle out, whisper (every ceiling down 15, three at most), the factor's pool, flattery (moves the price).

Eight endings, each with ledger numbers (`saltmarketLedger.ts`), authored copy (`saltmarketText.ts`), a faction favour (`SALTMARKET_FAVOUR = { brine: [scuttled, informed] }`) and a weighted picker that never offers the same contract twice running (`pickSaltmarketContract`). Three parley scripts (`scenarios/saltmarketParleyText.ts`): Tide-Reeve, Auctioneer, House-Head.

Runner semantics that shaped the templates (from `Scenario.ts`, unchanged): a talk event does not say WHICH person, so the template counts; prop events are not emitted, so crate delivery is a `use` at the door with `carry: "crate"` + `consume`; `seen` is edge-triggered; `leave` is a table; generic fuzz forbids an ending inside ~90 s.

## The client view (`apps/client/src/render/world/saltmarket/`)
`SaltmarketView` composes `ground` (terrain mesh with silt/mud/salt blending), `water` (the shared toon-water shader on the terrain's own grid, `aQ` from depth, so the shoreline matches), `flood` (`floodLevel(endsAtWorldMs, worldSec)` = `FLOOD.base + (max-base)*u^2`, pure, bounded, monotone while the timer runs; the view lifts the water in the Exchange with `applyScenario`, holds it once the sale resolves, drops it for another contract), `structures` (tarred stilted houses, piers, customs house, Exchange with a boarded ceiling, campanile, crane, wind pump, lantern poles), `cloth` (canvas awnings, the Syndicate's banner), `horizon`, `scatter` (reeds, tussock, tamarisk drawn from the delta's own palette keys). The ink hull has the same placements as the main mesh at every lod (only facets vary), otherwise it draws black. The only `PALETTE.world` read is `retint`, which tints the stock reed geometry toward the delta.

Showcase (`showcase/saltmarket.ts`): landing, horizon, quay, boardwalk, channel, stilts, customs, berth, cove, drop, exchange, flood, bridge, rim, walk3, lanterns, crane, campanile, windpump, reeds, top.

## Tests (and the mutation check of each)
- `packages/shared/src/saltmarket.test.ts` (17): determinism, no invisible walls, every site reachable with deep water closed, the nav build time, skyline bars. Mutated: the revetment pushed out (`for (const w of [])`) -> killed (3 tests); `deep` ignoring the deck (`wd > 0.9` only) -> killed (nav reachability).
- `saltmarketLedger.test.ts` (11): mutated: `ids = both` (the same contract twice) -> killed.
- `scenarios/smugglingRun.test.ts` (24): mutated `need: 3` -> 2 -> killed; the challenge timer removed -> killed (6).
- `scenarios/floodedMarket.test.ts` (21): hammer 30 s early -> killed; House-Head hostile ignored -> killed.
- `apps/server/src/systems/SmugglingRun.test.ts` (16) and `FloodedMarket.test.ts` (14): the real runner on a fake host (`vesperFake.testkit.ts`): one run per ending, forged crate use, stranger's pick, out-of-range options, input after the end, a 3000-input forged flood. Mutated: `consume: false` on the drop spec -> killed (2); the parley key `tell` renamed -> killed (2); `party_down` ignored -> killed.
- `apps/server/src/rooms/saltmarket.room.test.ts` (6, port 2604): a real room founded at the delta with either contract; `informed` and `consortium` driven for real through INTERACT and parleyPick; the forced `abandoned`; all eight endings through `outcome:` into the campaign, powers and paper.
- `apps/client/src/render/world/saltmarket/saltmarket.test.ts` (22): budgets at every preset, flood purity, view/ink-hull parity, dispose. Mutated: the flood level inverted -> killed (floodLevel and the view lift).
- Palette: `regionPalettes.test.ts` found real faults (indigoDark contrast 1.52 < 1.6, brass and synStripe chroma > 0.4); fixed in `paletteSaltmarket.ts`.

## Looked at
Horizon at noon and dusk, boardwalk, Exchange interior, customs, landing, channel, walk[3] at dusk, cove, berth, drop-house, reeds in fog, the chart and the parley sheet, and the three-way contact sheet with Kessar and Highmark (three distinct places). The chart shows four marks because Vesper is not live.

## Not done / open
- Vesper is C3's; the five-mark chart is unseen until it flips.
- Weather other than fog was not re-viewed after the last structure edits.
- The server tests import `vesperFake.testkit.ts` (C3's file). If it moves, copy it as `saltmarketFake.testkit.ts`.
- Software-GL only: numbers are floors, not performance claims.
