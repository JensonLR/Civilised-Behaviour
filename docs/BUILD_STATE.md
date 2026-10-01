# BUILD STATE - durable handoff

Last updated: 2026-10-01 (Expedition slice, D-034, integrated). Branch: `claude/civilised-behaviour-architecture-jtce2l`.
**Read this first after any context reset.** Be honest here: "done" means implemented AND verified.

## Now
- **M0 Foundation: done** except items listed under "Open".
- **M1 Multiplayer movement: mostly done.** Working & verified: authoritative movement, prediction/reconciliation via Colyseus
  `Predict`, remote interpolation, KBM + gamepad input, join code/invite link, reconnect window, hostile-input sanitising.
- **Expedition slice (D-034) is integrated: prep at the supply pyramid (manifest, hired hands, a horse) -> map room -> sail -> Kessar Reach -> one of FOUR contracts the campaign offers, against enemies that path, take cover, miss and break -> campaign state -> paper at HQ.** Verified by tests and a handful of software-GL stills; nobody has played it as a human and every balance number is a first pass tuned against scripted bots. See "Expedition slice" below for exactly what ran, what was only read and what is placeholder.
- **Slice 1 (D-033) is integrated and playable end to end in tests: HQ -> map room -> sail -> Kessar Reach -> one crossing scenario -> campaign state -> paper at HQ.**
  See "Slice 1" below for exactly what is verified and what is placeholder. Nobody has played it as a human. The fort, bridge, landing and the in-game arrival (orders card, rival timer, boat prompt) were looked at in software-GL renders and read well; not yet looked at: the map room, parley and paper sheets, the collapsed bridge. Was seen and open in slice 1, now answered by the expedition slice's culled `NameTags` (one plate looked at, under the compass band; not yet checked with 12 NPCs in view): far NPC name plates clamped to the top of the screen on top of the compass. Still open: in the `showcase=world&region=kessar` views the four lineup figures render sunk to the chest (the real game does not; cause not found, showcase only).

## Milestone board
| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| M0 | Foundation | DONE | monorepo, CI, docs, client/server boot, basic Three scene, room connection |
| M1 | Multiplayer movement | IN PROGRESS | see below |
| M2 | Character sandbox | DONE (art judged on software GL only) | see M2 detail |
| M3 | Combat | FIRST PASS DONE (unplayed; NPC AI is a first pass from Slice 1, see below) | firearms, melee, cannon, damage zones, gore, friendly fire, downed/revive, Rewind lag comp |
| M4 | First region | PARTLY (Hollowmere HQ + Kessar Reach slice) | Hollowmere is the HQ hub; Kessar Reach is the first colony region; no terrain streaming |
| M5 | Expedition | PARTLY (D-034 slice integrated, unplayed) | manifest sheet, three hired-hand kinds with a command wheel, horses and a wagon, region travel is still a sailing card (no playable boat), no outposts |
| M6 | Factions + negotiation | FIRST PASS | one local power (the Ward of the Nine Lamps) + one rival syndicate, parley, consequences; unplayed |
| M7 | Missions + chaos | FIRST PASS (unplayed) | FOUR scenario templates (crossing, hostage rescue, convoy ambush, border incident) with 20 resolutions, a pure chaos director dealing one complication with a cooldown, a ledger that picks the next contract; one authored parley per site |
| M8 | Settlement + campaign | TODO | outposts, evolution, infrastructure, campaign map, tech, newspaper/history |
| M9 | Full content | TODO | 4 regions, factions, balancing |
| M10 | Persistence | TODO | Postgres + Drizzle, identity abstraction, saves, migrations, recovery |
| M11 | Presentation | TODO | full UI, audio, effects, accessibility, tutorial, settings |
| M12 | Optimisation + QA | TODO | profiling, LOD, load/soak tests, bug burn-down |
| M13 | Distribution | TODO | web deploy (Cloudflare/R2), Railway, Electron, Steam adapter, demo, Playtest, website |
| M14 | Release candidate | TODO | security audit, clean-machine, controller-only, bad network, licences, docs |

## M1 detail
Done + verified (tests in parens):
- Deterministic shared sim: RNG, terrain, analytic collision, `stepCharacter` (14 vitest cases: determinism, walls, sliding, step-up, jump, latch, stumble, bounds, cliff).
- WorldRoom: join/leave, unique slots, max 4, name sanitising, authoritative movement, hostile input, reconnect, code lookup (7 integration cases).
- Browser e2e with two real Chromium contexts: create, join by code, prediction, remote sync, bad-code error (2 Playwright cases).
- Client: Stage (lighting, fog, texel-snapped shadow follow; the world itself is `render/world/`, see "World" below), CameraRig, Controls (KBM+pad),
  Menu (with basic pad focus), DebugOverlay (F3).
Also done (2026-09-29): server-authoritative props + pick up/carry/drop/throw (Rapier, D-014) verified in a real browser; QA debug command; origin enforcement (D-012); bot client (`apps/server/src/bots`); prediction verified at 0/100/150 ms RTT with 0 drift, and
fixed a real desync (D-013: idle-tick synthesis). See NETWORKING.md.
Not done in M1:
- Jitter/packet-loss simulation (Colyseus only supports fixed delay); bandwidth measurement; drift shown in the browser overlay.
- Player-vs-player collision (deliberately deferred: needs prediction-aware design).
- Pad remapping, settings UI, UI scale (M11).
- Real character art: `Puppet` is an M1 stand-in only.

## Slice 1: the core loop (D-033; integrated 2026-09-30; spec `docs/_notes/slice.md`)
What exists. One Colyseus room holds one active region; `WorldRoom.enterRegion` swaps world, Rapier, props, cannons, NPCs and scenario. Schema/protocol additions are append-only
(`WorldState.region/travel*/campaign*/scenario*`, `PlayerState.npc`, `JoinOptions.region`, `travelPropose/travelReady/travelCancel/regionReady/parleyPick/parleyClose`, `station`, `parley`).
Server: `systems/Travel.ts` (pure machine in `shared/travel.ts`), `systems/Scenario.ts` (pure reducer in `shared/scenario.ts`), NPC rows (`npc:<id>`) stepped by the same `stepCharacter` + `Combat.onFrame`;
`Combat.hittable` makes the party and the garrison always enemies (friendly fire only governs party-vs-party; NPC-vs-NPC never), `Casualties` scans see only the real party, `HitInfo.by` names the attacker.
Client: `Game` follows the room (sailing card + input held, rebuild of world/ragdolls/camera on region change or a fallen bridge, `regionReady`), map room (table or dock), parley sheet, broadsheet at the notice board
(`generatePaper(parseCampaign(state.campaign))` on the client), objective tracker, prompts from `findStation`. `?region=kessar` founds a campaign already at Kessar.
Verified by running code: shared 389, client 468, server 186, procedural 554 unit/integration tests; new server integration `rooms/campaign.test.ts` (6: HQ map table -> sail -> land -> Warden parley -> pay -> sail home -> paper differs;
hostile messages; two-player vote waits for the slowest client; force; sabotage with a real barrel, pier and fuse; a real pistol shot hurts a sentry with friendly fire off), `bots/travelNet.test.ts` (2: a prediction bot sails, lands, walks Kessar's road and stays
within 0.5 m of the server; a late joiner lands in Kessar) and one Playwright run (`tests/e2e/kessar.spec.ts`: a real browser founded at Kessar shows the orders, sails home, rebuilds its world and sends `regionReady`, no page errors).
Judged only by unit tests / reading: the Kessar look (draw and triangle budgets are asserted, the scene was built headlessly under `gfx=test`, but nobody has LOOKED at it: run
`node scripts/shot.mjs "?showcase=world&region=kessar&view=landing"`, also `bridge`, `gate`, `camp`), the map room, parley sheet and newspaper layouts (DOM unit tests only; never opened in a browser), the Sailing card's look, the fallen-bridge rebuild in a browser (logic + server world verified),
the `paper` and `map` station prompts in the HUD, all new copy (registered in `AI_CONTENT_REGISTER.md`, pending developer review), garrison balance (a lone player was put down in about two seconds by rifles and a pistol in a test: expect retuning).
Review pass: a downed player cannot propose a sailing, proposals are rate-limited (1.5 s, room-wide), and a client already standing in the new region at landfall (late join, reconnect) now sends `regionReady` instead of making the party wait out the 30 s timeout (client change run through `kessar.spec.ts` only). Known gaps from review: sailing away from Kessar mid-scenario commits nothing (kills and broken promises are forgotten), the lit-charge blast only hurts the party when friendly fire is on, and a scripted explosion has no owner.
Placeholder / not done (slice 1; the NPC, scenario-template, loadout and horse items below were answered by the expedition slice): sailing is a full-screen card, not a voyage; wall cannons are display only; the gate door is a closed collider with no opening; Kessar's hill rings
reuse the Hollowmere ring (its windmill shows); no audio for any new content; no outposts; campaign state lives in the room and is lost on a server restart (M10); revisiting Kessar with a collapsed bridge starts the scenario
resolved (unit-tested, not driven through a room); a reconnect during the sailing is handled by the machine (dropped slots stop counting) but has no integration test; the hostile-message fuzz covers the obvious forged payloads, not every field of every message; the old per-scenario NPC loop is gone (the `Cast` replaced it: 20 NPCs tick in 0.33 ms median in a unit rig; p95 with 20 NPCs + 4 bots through a real room is still not measured). Deviation from the spec: NPC rows take slots 16+ (not 255) so every victim of one blast keeps its own entry in Combat's pending-hit map; `Stance`/`Station` in `campaignTypes.ts` were renamed `FactionStance`/`UseStation`
because `@cb/shared` already exports `Stance` (weapons) and `Station` (villagers).

## Expedition slice (D-034; integrated 2026-10-01; spec `docs/_notes/expedition.md`)
Four packages (N: navigation + utility brain + `Cast`; H: horses, wagon, the second shared step; L: manifest, hired hands, command wheel; S: scenario templates, chaos, outcomes, paper) built in parallel against a contract, then wired by one integrator. Phase 0 (the frozen contract) had NOT landed when the packages started, so each package wrote what it needed and the integrator reconciled it: the integrator's edits are listed at the end.
**What exists.**
- Shared (`packages/shared`): `nav.ts` (2 m grid, A*, line of sight, cover, flank), `npcBrain.ts` (utility brain: reaction time, aim error that ranges in, cadence, attack tokens, flee at broken), `morale.ts`, `garrison.ts` (roster + `kessarNavOptions`), `nameTag.ts` (culled plates), `mount.ts` (`stepMounted`, `throwRisk`, `trailStep`, the wagon bays, spots), `loadout.ts`, `followers.ts`, `command.ts`, `partyState.ts`, `chaos.ts`, `scenarios/*` (four templates, registry, parleys), `expeditionTypes.ts`. New append-only schema/protocol: `PlayerState.cmd/morale`, `WorldState.mounts/party/partyRev`, `FLAG.MOUNTED/HITCHED/GALLOPING`, `loadoutSet/hire/command`, `station: "loadout"`, `JoinOptions.scenario`. `stepCharacter` hands a MOUNTED body to `stepMounted` (one shared step, client and server).
- Server: `Cast` runs every NPC row (garrison, rivals, deserters, hostages, drivers, hired hands) through the same step and combat path a player takes; `Mounts` (horses, wagon, riders thrown by walls, blasts, blows and being downed); `Followers` (manifest and hire messages, orders, wages and desertion, morale, the surgeon through `Casualties.assist`); `Scenario` is now a template-agnostic runner; `Combat.hittable` is side-aware (rounds from an NPC pass through anyone its side is not fighting; a hand answers fire and obeys an attack order); a rider's hit zones and muzzle sit at the saddle; a ranged round into a BARREL sets it off (powder keg: also the convoy's `burned` ending); an NPC's firearm reserve is topped up when it falls below 4 (the skirmish balance was tuned that way, hired hands included).
- Client: `MountView` (horses and wagons; a ridden horse is drawn from its rider's predicted state), the rider's seated pose, a camera that pulls back and up on a horse, mount/dismount/hitch/load prompts, `LoadoutSheet` at the supply pyramid, `CommandWheel` (hold T, or the d-pad's down, release to send; the mouse or right stick picks), `NameTags` replacing the inline plates (culled, not clamped; a hired hand's plate shows his order and nerve), the three contract sites in Kessar (`sites.ts`), the map room's note naming the contract on offer, `?showcase=horses`, `&scenario=<id>`.
**Verified by running code** (final run below): shared unit tests for every new module (nav determinism and budgets, brain, mounts incl. jump heights and throw rules, loadout/followers/command tables and fuzz, partyState fuzz, templates, chaos, registry, noRealWorld now also scanning the follower, command, loadout and mount sources); server unit and fake-host tests (Cast incl. `hostileTo`, Mounts, Followers, Scenario for all 20 resolutions, `Casualties.assist`, skirmish bots); NEW real-room integration (`rooms/expedition.test.ts`, 9): the supply pyramid station; manifest, hire, sailing, landfall with the manifest charged once, rounds scaled, a keg at the landing, a horse and the hand ashore; orders obeyed and written onto the hand; hostile `command`/`loadoutSet`/`hire` payloads and a flood ignored; an unaffordable overloaded manifest trimmed in the fixed order with a notice and charged once; a shot barrel goes up; a rider sails and leaves nothing mounted behind; sailing right after landing commits NOTHING (campaign byte-identical) while sailing after first blood commits `abandoned` with the tally; a paid crossing is settled (a forced entry starts resolved, nothing more is committed); the ledger offers another contract after the first. NEW bot test (`bots/expeditionNet.test.ts`): a real `Bot` mounts at the stable, gallops, jumps and dismounts through the real room with the shared step predicting it: topped 10.5 m/s, mean correction < 0.1 m, the dismount's 1 m placement the only position correction, ends within 0.6 m of the server; mutation-checked (take the movement dispatch out and it fails). Also mutation-checked this pass: the keg hook. In process at 100 and 150 ms RTT (`bots/mountNet.test.ts`, now through the REAL dispatch): worst riding correction <= 0.5 m. One Playwright spec (`tests/e2e/expedition.spec.ts`, 4 tests, 46 s): the supply pyramid opens the sheet in a real browser, a horse and a crate of rounds are charged once at sailing (purse - 38) and the horse stands at the landing; the hostage, convoy and border contracts each load at Kessar and the tracker shows their title; no page errors. Two integration bugs found only by these tests and fixed at the root: the `loadoutSet` payload was unwrapped before the parser wanted it; a dev-forced contract was also started at the hub (so sailing out of Hollowmere committed `abandoned`).
**Skirmish numbers (scripted bots, 10 seeds, never played by a human; `bots/skirmish.test.ts`):** a bot standing still at 25 m is downed in a median of 15 s; one that strafes from cover survives a median of 90 s; three rifle bots clear the garrison in 7-20 s in 10/10 seeds with at most one bot downed (the garrison is weak in open ground; tuned lightly). Cast with 20 NPCs ticks in 0.33 ms median (p95 0.6 ms); the Kessar nav grid builds in 50-90 ms. Mount replay error 7e-6 m steady; correction 0.26 / 0.44 m at 100 / 150 ms RTT in process.
**LOOKED AT (software GL, this pass):** the horse lineup (six coats, riders seated, a wagon: `?showcase=horses&n=6&rider=1&wagon=1&view=three`), a rider mounted at the HQ stable in the real game (rear and three-quarter views; it reads), and the deserters' camp at Hangman's Orchard in the real game (the cage wagon, the tents, the flag, two name plates under the compass band, the orders card with its title; the player was already badly shot, which is the camp doing its job). H also looked at gaits, jump, rear and wagon renders. **NOT looked at:** the manifest sheet and the command wheel (DOM tests and one e2e opening the sheet only), the map room's contract note, the convoy's Dry Cut and Marker Stone No. 4 sites, a wagon or hired hands in the game, plates with 12 NPCs in view, anything on a real GPU. Still ugly (H): blobby dapple coats, sparse manes, thighs hidden by coats.
**Placeholder / not done / known gaps.**
- Every number (skirmish, wages, capacity, gallop and throw rules, morale bands, tension, deadlines, prices) is a first pass; nobody has played any of it. No audio for any new content (horses, wagon, hands, contracts).
- Hired hands: they exist only in Kessar (the hub spawns none); a hand who is downed is never permadead (`isDead` is not wired, so "the dead stay dead" is unproven); wages and desertion are settled only when an outcome commits (an expedition dismissed by sailing at once pays and costs nothing); dressings gate only the surgeon (a human's own first aid is still free); gifts and tools are not in the manifest.
- Mounts: the horse takes no damage; mounted melee is untuned; the wagon canopy and horse audio are not built; the Hollowmere stable (two horses and a wagon) is always there and is not a manifest item; a seized convoy pays through the abstract crate value (the keg at the Cut cannot be loaded onto the wagon).
- Scenarios: "seen" is distance only (no line of sight); of the 20 resolutions only the crossing's are driven through a real room (campaign.test, expedition.test); the other 13 run on the fake host. Reconnect during a ride or the sailing has no integration test. Every barrel is now a powder keg (including the decorative ones in Hollowmere).
- Command key is T (the spec said Q; the existing bindings tests use Q as their example free key) and the pad uses the d-pad's down (LB is Throw). Name plates' line-of-sight uses one client ray per soldier within 26 m.
- Review findings left open (adversarial pass, 2026-10-01): `JoinOptions.region`/`.scenario` are honoured from any creating client (dev and test hooks, not gated on `debugCommands`; a shipping build should gate both); `loadoutSet` and `hire` check the hub and the sender's standing but not that the sender is at the supply table; the Cast's clock is the wall-clock world age (`performance.now() - bornAt`, shared with the weather), so NPC think timing and reaction jitter are not reproducible between runs of the same seed (tests use a fake clock); `nav.ts` reads `performance.now()` for its diagnostic `buildMs` only; `mountPromptNow` builds a small array and two closures per frame while any mount row exists. Fixed in the review: a rider beside the field cannon had his INTERACT taken by the gun (he could not dismount and was marked OPERATING while riding); `throwRiskValue` allocated an array per call.
- Not in this slice (spec section 10): horse damage and death, steam launches or canoes, NPC-crewed cannons, persistence across restarts (M10), real-GPU numbers, human playtests, outposts.
**Integrator edits** (the packages did not touch these): `constants.ts`, `schema.ts`, `protocol.ts`, `index.ts`, `movement.ts` (one dispatch line), `regions.ts` (loadout station), `WorldRoom.ts`, `Combat.ts` (`hostile`, `blasted`, `propShot` hooks, `scaleReserve`, rider lift), `Casualties.ts` (helpable view, `assist`, public `releaseDrag`), `Cast.ts` (`brainOf`, `hostileTo`, `routePoints`, an attack order picks its target), client `Game.ts`, `CameraRig.ts`, `CharacterActor.ts` (ride pose), `Controls.ts`/`bindings.ts` (Command), `Session.ts`/`boot.ts`/`main.ts`, `KessarView.ts` (sites), `campaignView.ts`.

## Deployment (see DEPLOYMENT.md)
Render free-tier test deploy is live: client https://cb-client-42gz.onrender.com, server https://cb-server-86wx.onrender.com.
Server-side WebSocket joins verified; end-to-end browser session against it NOT yet verified (sandbox Chromium gets 404 on wss upgrade).
ALLOWED_ORIGINS now enforced (D-012). Open: set health-check path in Render dashboard.

## M2 detail (started 2026-09-29)
Done + verified:
- `packages/procedural`: character spec (41 fields), catalogs, compact codec, sanitiser, archetype-driven seeded generator, proportions fitted to the gameplay
  envelope (24 tests incl. 2000-seed envelope sweep, hostile-input clamping, server-owned history).
- Three.js rig (rigid hierarchy, merged vertex-coloured bone meshes, cached by spec), procedural animator (distance-locked gait, crouch, carry, air, downed,
  blink, 6 expressions), adaptive tessellation (avg 5.9k tris/character).
- Server: `look` validated/canonicalised on join, `setLook` rate-limited, history stripped (5 integration tests, mutation-checked).
- Client: `CharacterActor` replaces the stand-in puppet; creator UI generated from field metadata with live 3D turntable preview, gamepad navigation (`PadNav`),
  look persisted per browser; lineup/close-up showcase scene; 4 Playwright tests incl. creator + cross-player look replication.
Done + verified (downed/drag/revive, 2026-09-29):
- Health + down state through one damage entry point; timed revive (server ticks), drag with server-steered velocity, rout; kneel/haul animations; wounds HUD,
  revive progress, "you are down" banner, nametag markers, prompts; Grab control (F / RB). 16 casualty integration tests + 4 prediction/flood bot tests
  (mutation-checked) + 12 shared tests + a two-browser Playwright scenario (revive, then drag).
- Security finding + fix: input-frame flooding gave 3.0x speed; now bounded to ~1.03x by a server-side input budget (D-017).
Done + verified (character art polish pass, 2026-09-29):
- Inverted-hull silhouette outline (smoothed-normal, clip-space thickness, distance-scaled, fog-aware), coarse hull geometry cached separately; on for medium/high
  presets, off on low (`GraphicsPreset.outlines`, `CharacterActor` param). Baked per-vertex shading + per-primitive clay tint; head rebuilt (`head.ts`): brow
  ridges, nose that cannot swallow the mouth, face features placed on the real face surface, 10 hair styles, 8 beards, 10 moustaches, 11 hats; fist hands with
  thumb and knuckles; teeth (gold/missing) and a mouth interior. New catalog entries are append-only so old looks still decode. Verified by renders
  (`?showcase=lineup`), 26 procedural tests incl. outline regressions, and the full Playwright suite. Judged by eye on software GL only: needs a look on a real GPU.
Done + verified (wounds and ragdoll, 2026-09-29):
- Wounds: 6 body zones x severity 0-3 packed in `PlayerState.wounds`; `Casualties.damage` takes zone + direction, stacks wounds, emits a cosmetic `hit` event;
  revive patches to at most a dressing. Rig shows plasters/dressings/stains per zone (one merged mesh per wounded zone, ~2.0k tris only if all six are grievous);
  animator gains a limp (leg wounds) and a flinch spring; hit particles + ground stains pooled (`HitFx`); HUD injury chart (fill + outline weight + words);
  Gore Full/Reduced/Off in the menu (Off = bandages + iodine, no red; verified by a vertex-colour test).
- Ragdoll: client-side Rapier (lazy chunk), 11 bodies with hinge/ball joints and limits, capped at 6, tethered to the server capsule, ~2.6 s max, then blends
  into the animator's lying pose. Triggered by the `hit` event with `down`. `@cb/physics` extracted so server and client build identical static colliders.
  Tests: 22 wound/animator (shared 8, procedural 7, server 7 integration), 10 ragdoll (limits, tether, cap, no leaks, blend equality, no pops), 6 HitFx,
  plus a two-browser Playwright scenario (wounds visible to both, ragdoll seen and ended). Protections mutation-checked: revive cap, zone validation, joint limits,
  tether, animator channel reset.
- Found: `JointData.limits` is silently ignored in rapier 0.21 (limits must be set on the created joint) and the animator did not own every joint channel
  (a finished ragdoll left stale rotations); both fixed with regression tests.
Done + verified (character rebuild, 2026-09-29): lofted bodies and coats/boots (D-020), sculpted faces (D-021), one game palette with art-direction tests (D-022).
Judged by eye on software GL (`docs/ART_DIRECTION.md` lists the review commands); 63 procedural + 55 shared + 19 client tests; full Playwright suite green.
Known rough edges: hair shells and beards are flat-shaded masses (no strand detail), ears are simple cups, expressions do not yet move the jaw, the low-poly
lower face shows toon band contours on close-ups (a 5-step ramp would soften them), and crowds still need character LOD (head has a coarse mode ready).
Done + verified (cosmetics, dismemberment, interface, 2026-09-29):
- Cosmetics that clipped the body were rebuilt on the sculpt: eyewear (skin-hugging temple arms, nose-bridge arch, goggles with a back strap, pince-nez, eyepatch with strap),
  hats seated on the skull at designed heights using the skull width there, flush nostril tubes, jaw beards, and a diagonal sash swept along the torso's own sections
  (`sweep` gained rounded ends and a per-point side axis, both tested). Judged by renders (`docs/ART_DIRECTION.md`); triangle budget re-measured: avg 7.8k, max 9.5k.
- Dismemberment (D-023): server-owned `missing` mask + campaign rule + seeded `severChance`, stumps on the rig, flying limb debris (`LimbDebris`, 5 tests), injury chart
  "lost" state, personal "Severed limbs" setting, menu options; 8 server integration tests and a two-browser Playwright scenario (stump + debris for the victim, dressing only
  for a witness who hid limbs). Not done: prosthetics, movement effects, sound.
- Interface (D-024): charter/ledger/gauge/luggage-tag/telegram redesign, period fonts bundled. Judged by screenshots at 1440x800 and 800x450 only; gamepad focus rings,
  UI scale and colour-blind review of the creator swatches still to do.
Done + verified (world art pass, D-025, 2026-09-29): the environment now shares the characters' look. Toon ramp + palette vertex colours + instanced ink outlines on trees, rocks, camp and props;
painted terrain (`groundColour`); hill rings + ground skirt + distant groves so the arena edge is not the end of the world; painterly banded sky with a sun disc and ring; three tree species,
shrubs, faceted rocks, wind-swept grass tufts and flowers; a collidable expedition camp at the spawn (two bell tents, campfire with unlit flame and glow, flagpole with a rippling pennant, signpost with
lettered boards, luggage, supply cart, the two step-up crates, a ruined dry-stone wall) driven by `camp.ts`, which also keeps props and spawns out of it; props are one instanced mesh per kind with
crate slats, hooped barrels, glass bottles and bentwood chairs. Tests: shared 11 (camp/spawn/prop keep-out, determinism, tag contract, ground colour finite/in gamut/muted, cover density,
species), palette coverage for the new colours, client 53 (geometry finite / outward / has `onormal`, hull cheaper, props inside their physics boxes, camp inside its collision footprints, banner UVs,
PropViews instancing, WorldView draw/triangle budget per preset, dispose), procedural 4 (outline instancing path). `pnpm typecheck`, `pnpm test`, e2e "two players share" and "picks it up" green.
Measured (software GL): world 22 / 28 / 28 draw calls (low / medium / high) incl. shadow pass; in the game medium is 86 calls / 297k tris (was 61 / 91k). Judged by renders on software GL only.
Known weak spots: wildflowers are small flat cups that read as dots; the spawn clearing is a large uniform-ish earth disc; the hill rings are smooth slabs (no tree-line texture); clouds are one soft
layer; the snag is thin; no wind on trees, weather or day/night; `rig.ts` still owns a private copy of the toon ramp (`sharedToonRamp` in `outline.ts` is the same four values; make rig import it);
shrubs and grass have no collision or reaction to walkers; an ink outline on world objects is the same pixel width as on characters, which reads heavy on close rocks.
Done + verified (final upgrade pass, 2026-09-29; D-026..D-029): injuries change movement and carrying through the predicted step (server hostile-input tests, 12 mutation checks);
characters gained ~100 cosmetics, garment patches, face decals, strand hair, prosthetics, three LODs and a richer animator (audit test over every option); the world gained a day cycle,
water, wind, ambient life, landmarks and paths; first-person view (X). Unit tests: shared 144, procedural 430, client 152, server 104. Everything visual judged on software GL only.
Known weak spots (details in docs/_notes/*.md): cape/poncho read as bowls from above and clip at extreme arm swings; sideburns 4-6 read as dark curtains; hands are still fists;
LOD1 is heavier than aimed (5.7k); face parts rebuild per instance (crowds need them cached); ragdoll from a mid idle-act pose can overshoot an elbow limit for a frame; first-person arms
only show when looking down; day clock is per client; nothing grants wooden legs in the campaign yet; no weather, no sound.
Done + verified (M3 combat, audio/settings, world clock and weather, character polish, 2026-09-30; D-030..D-032): weapons and authoritative combat with lag compensation (unit 226 shared, 148 server incl. 9 mutation checks and bot-measured hit rates); synthesized audio engine and settings/pause/how-to screens with accessibility options; server-synced day clock and deterministic weather; observatory, clearing, flock and vegetation; drapes, hands with grip, LOD costs, creator with presets/undo/paste, batch-3 cosmetics; ragdoll hinge limits fixed at the root. Unit tests: shared 226, procedural 512, client 320, server 148.
Known weak spots (details in docs/_notes/*.md): audio never heard by a human; combat balance never played; first-person aimed weapon sits low; dust impacts read weakly; NPC combat AI does not exist; the shared clock IS verified live (two real browsers agree within 0.2 s and match the server's formula) but weather has only been checked by tests and stills; puddle/rain/animal shaders unmeasured on a real GPU; tiny cosmetics (laces, cuffs) read as specks at distance; the free Render server tier is too slow for real sessions (tick ~100 ms vs 33 ms budget); the browser cannot be driven against the Render deployment from this sandbox (WebSocket 404), only through the Node SDK.
Done + verified (fit pass and Hollowmere, 2026-09-30): a signed-distance body field (`three/fit/`) now places wearables and `fit.test.ts` measures real interpenetration, floating parts and pose clipping for every option on extreme body grids with ratcheting thresholds (floating 0; head penetration worst 1.1 cm; trunk garments 2.9 cm; limbs `poseClip` still up to 21 cm on Baggy trousers, mostly bare-body overlap in crouches). Coat skirts, packs, straps, hats, hair, eyewear, ears, sleeves, cuffs, hands, trousers and boots were rebuilt to fit any size. World: 15-site fictional village (8 building types), expedition HQ pavilion, jetty/mill/weir, crags, windmill, snow range, mist, moon phases, golden hour, ducks/deer/cat. Unit tests: shared 247, procedural 539, client 337, server 148. Browser suite: all scenarios pass when run without other load; under load the page-load waits time out on software GL (wait raised to 120 s).
Not attempted in that pass: face-quality items (eyelid/brow/nostril/lip sculpt, catchlights); cape/poncho shoulder pieces still read as stiff wings; hands are still a single block without a wrist bone (needs a rig.ts change); neckwear on very wide necks clips raised arms (up to 7.6 cm); hip gear touches a hanging hand (up to 6 cm); long hair reads as one cloth sheet from behind; village has no villagers yet; puddle/mist/animal shaders unmeasured on a real GPU.
Done + verified (test speed and boot, 2026-09-30; docs/PERFORMANCE.md): a hidden `gfx=test` preset (no shadows, ink, villagers, ground cover; half-size frame buffer) gives e2e ~20 fps on the software rasteriser, the menu opens before the world builds, and `low` dropped MSAA (2.9 -> 4.8 fps software). Server integration files now run one at a time (`fileParallelism: false`) because the lag-compensation and drift tests use real timers and failed under parallel load (57% vs a 60% bar; 79% alone; not weakened). Software-GL numbers are floors, not performance claims: medium/high were not re-measured on a real GPU.
Known weak spots: the two-browser e2e tests are still the slow end (wounds 1.1-1.7 min, severed limb 22 s alone but >3 min late in a busy full run, so it now has the wounds test's 360 s budget); villagers add 230-320 draw calls and want a merged mid-detail LOD; hair has no sway; nose-bridge ink reads heavy in 3/4 view; closed eyes are round bumps; hip gear touches the swinging hand on an extreme stubby body (6.7 cm); slope/stair adaptation is not done; puddle/mist/animal/ground shaders are unmeasured on real GPUs; audio has not been auditioned by a human; combat balance has not been played; wooden legs are not granted by the campaign; the free Render server tier is too slow for real sessions.
Not done in M2 (next):
- Wounds have no gameplay effect yet (limp is animation only; a real slow-down needs `wounds` as a predicted input of the shared step). No bleed-out or
  medical supplies (M5). Dirt/mud accumulation and blood on clothing beyond the dressings. Outline rollout to NPC crowds (LOD).
- Ragdolls for living characters (explosion knock-back) and NPCs, persistent limp bodies while dragged. Shoulder-carry a body (reuse prop-carry), wagon transport (M5).
- Character LOD for crowds (see PERFORMANCE.md risk); NPC use of the generator.
- Expression triggers beyond downed=pain; head-look; drunkenness from gameplay.
- Creator: colour-blind-safe review, UI scale, keyboard shortcuts; title/nickname editing.

## Open / blockers (human-only)
- Steam App ID, Steamworks account, Steam Direct fee, signing certificates, domain(s), Cloudflare + Railway accounts: none exist yet.
  All isolated behind config; see DEPLOYMENT.md / STEAM_RELEASE.md (drafts, not verified).
- Final title / trademark clearance search: not done (must happen before store page).
- Steam wrapper choice open (D-010).

## Test results (last full run 2026-10-01, after the expedition slice)
`pnpm typecheck` clean; `pnpm test`: shared 625 (38 files), procedural 579 (28), client 526 (51), physics, server 317 in 28 files run serially (the NPC powder top-up test was added after the integrator's run; the adversarial review then added one more, a rider beside the field cannon, mutation-checked; Mounts, combat and expedition files re-run alone after the review: 68 passed). All of it passed in the full run; the server suite takes ~10 minutes and is timing-sensitive, so run it with nothing else going (a first run beside the client and procedural suites reproduced a leave-commit failure that was a REAL bug, fixed; load otherwise only widens windows). Playwright: only `tests/e2e/expedition.spec.ts` was run this pass (4 tests, all pass, 46 s); the earlier specs (coop, firstperson, kessar, settings) were NOT re-run after the integration, so treat them as unverified against it. Everything visual judged on software GL only.

## Conventions reminder
See CLAUDE.md. Keep this file current: completed / in progress / next / blockers / test results.
