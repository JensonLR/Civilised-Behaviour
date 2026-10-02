# Notes for DECISIONS / BUILD_STATE: M3 combat (2026-09-30)

Proposed entry **D-027 Server-authoritative combat with deterministic cosmetic prediction and bounded lag compensation**. Code: `packages/shared/src/{weapons,ballistics}.ts`
(pure, tested), `apps/server/src/systems/Combat.ts` (the only writer of combat state), client `game/CombatView.ts`, `render/weapons/*`, `render/Projectiles.ts`,
`ui/CombatHud.ts`, `packages/procedural/src/three/weaponPose.ts` (arm IK + hold). Wire changes are in `NETWORKING.md` ("Combat").

## Design in one paragraph
The client sends *intent* (buttons FIRE/AIM/RELOAD/MELEE, a weapon wish, the aim direction). The server owns ammo, reload, cooldown, what a shot hits, damage,
knock and every wound (through the unchanged `Casualties.damage`, so downing, revive and dismemberment rules are untouched). The client draws a picture of the
same thing at once: the shot pattern is a pure function of `(worldSeed, slot, shotCounter & 255)`, so the shooter's flash, tracer and pellets are the ones the
server will resolve, and everyone else gets the `shot` event. Recoil is cosmetic (camera kick and weapon kick in the animator), never a movement input, so
shooting cannot desync prediction (measured below). Gameplay never depends on gore: hit markers, the bearing chevron and the wound card are readable with gore Off.

## Weapons (all numbers in `WEAPONS`, one table, unit-tested for sanity)
| Weapon | Fire | Damage | Zone x (head/torso/arm/leg) | Falloff (full to min) | Cooldown | Reload / mag / reserve (start) | Spread hip / aimed | Ball | Knock | Sever bias | FF scale | Noise |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Flintlock pistol | projectile | 30 | 2 / 1 / .7 / .7 | 20 m to 70 m, x.45 | .35 s | 3.0 s / 2 / 24 (14) | .030 / .007 | 190 m/s, g 4.5 | 1.6 | 1 | .75 | 90 |
| Percussion rifle | hitscan | 70 | 2.2 / 1 / .75 / .75 | 60 m to 160 m, x.55 | .8 s | 3.6 s / 1 / 20 (12) | .050 / .003 | - | 3 | 1 | .7 | 150 |
| Double blunderbuss | 8 pellets x 11 | 88 max | 1.6 / 1 / .85 / .85 | 5 m to 24 m, x.15 | .5 s | 4.2 s / 2 / 14 (8) | .100 / .075 | 155 m/s, g 6 | 4.5 | 1.4 | .7 | 120 |
| Cavalry sabre | melee arc | 36 | 1.5 / 1 / 1 / 1 | reach 1.9 m, arc +-.8, cleave 3 | .7 s (wind-up .2) | - | - | - | 2.2 | 1.8 | .7 | 14 |
| Walking umbrella | melee arc | 12 | 1.5 / 1 / 1 / 1 | reach 1.8 m, cleave 2 | .55 s (wind-up .18) | - | - | - | 4.2 | 0 | .6 | 6 |
| Fists | melee | 7 | 1.4 / 1 / .8 / .8 | reach 1.25 m | .5 s | - | - | - | 2 | 0 | .5 | 4 |
| Butt-strike (V, firearms) | melee | 14 (rifle 18, blunderbuss 16) | 1.4 / 1 / .8 / .8 | reach 1.5-1.7 m | .9 s | - | - | - | 3.6 | - | - | - |
| Field cannon | projectile | 160 direct + 120 blast, radius 6 m | 1 | - | fuse .7 s | load 4 s with two crew, 8 s alone; 6 shells | .004 | 75 m/s, g 9.81 | 11 | 2.2 | 1 | 320 |

Thrown props keep their existing rules. Friendly fire is a *campaign rule* (`WorldState.friendlyFire`, creator option, server default from `FRIENDLY_FIRE`,
a server that turns it off wins over a creator who asks for it): with it off, rounds pass through comrades (nobody blocks a shot they cannot be hurt by) and
blows do nothing; with it on, `ffScale` softens the hit and a shooter's own blast is halved even when the rule is off (`min(ffScale, .5)`): the shooter is always in danger.

## Hit resolution
- Bodies are six stacked ellipsoids in the character frame (`BODY_SHAPES`; crouch squashes them by 1.2/1.8; a downed body lies down and is not a target).
  A ray or a swept segment is inflated by the projectile radius. *A torso shot from the side meets the arm first*: that is the physics of a stack, and the tests
  face the victim toward the shooter (`faceBack`) for that reason.
- The world is a grid DDA over obstacles (cylinders, OBBs with a y range), a terrain march with bisection, and props via the physics ray. Cover works: a rifle round is
  stopped by the camp wall, a man behind it is untouched (test). Props only receive an impulse (capped by `COMBAT.maxPropSpeed`).
- One *wound event per shot per victim*: pellets are aggregated (`addHit` keyed `shotKey*8+slot`, flushed at the end of the tick) so a blunderbuss blast is one
  hit event, one wound level step, one hit marker.
- Explosions: smoothstep falloff to the radius, cover takes the sting out (x.3 through a world ray), lift, prop impulses; damage goes through `Casualties.damage`
  with a direction away from the centre.

## Lag compensation (what it does, what it costs)
Colyseus `allowRewindState` records `facing` and `flags` (held between snapshots) and positions (linearly interpolated) at the 50 ms patch cadence.
For each hitscan shot and for each projectile's first instants the server asks `lastSeenBy(shooter)`, i.e. *the frame this shooter's client last rendered*, and tests
people against that; the world and the shooter stay live. Clamp: `COMBAT.rewindMaxMs` = 400 ms (250 until D-041). Projectiles keep the shooter's full lag for `projectileRewindHold`
(0.3 s) and then fade to live positions over 0.1 s (`projectileLag`), so a ball that needs 0.1 s to arrive still meets the man the shooter saw, and nothing is hit around
a corner for more than the clamp.
Trade-offs, stated plainly:
1. The *target* pays: a man who ducks behind cover can still be hit for up to ~400 ms after he thought he was safe. That is the price of letting a 200 ms player hit
   what he saw; the clamp bounds what a hostile client can gain by claiming a large lag. The view time is the render timestamp the SDK's `Predict` stamps on the client's inputs, which the server cannot verify, so a cheater can always pick the worst 400 ms for the victim; he cannot reach further back. (In this co-op game the far end of a shot is almost always an NPC; players meet each other's rounds only under friendly fire.)
2. Rewind covers people only. Walls, props and the shooter are live; a door closed in the last 400 ms is closed.
3. Melee is compensated with the lag stored at the press, resolved after the wind-up.
4. D-041, measured: at a 200 ms round trip every shot asks the rewind for 320-360 ms (half the trip, the display delay and the frame's wait), not the ~200 ms first assumed, so the old 250 ms cap clamped every shot and the server judged a strafing target 40-70 ms after the shooter saw it (6-12 of 14 landed). At 400 ms all 14 land at 0, 100 and 200 ms. Above a ~300 ms round trip the cap bites again.
5. A cannon ball and blasts are not compensated (slow, big, telegraphed by a 0.7 s fuse).
Switch: `Combat.lagCompensation` (tests use it as the control).

### Measured (headless bots against a real server, `apps/server/src/bots/combatNet.test.ts`, output `test-results/combat.json`)
A rifleman aims at where he *sees* a target strafing 4 m/s at 22 m (14 shots); the target's chest is ~0.3 m across.
| RTT | Lag comp ON: hits | Lag comp OFF: hits |
|---|---|---|
| 0 ms | 14/14 | 7/14 |
| 100 ms | 14/14 | - |
| 200 ms | 10/14 (71%) | 0/14 |
Control: aiming 1.2 m to the side hits 0/8 at 0 and 150 ms (the test is honest). Pistol balls (12 m, strafing man, first instants compensated): 11/12 at 0 ms, 6/12 at 150 ms
(a ball in flight can also be dodged). During development the `diag` hook measured how far the aim ray passed from the target's chest in the rewound view versus the live
one: about 0 to 0.08 m rewound (a strafing man moving 4 m/s would be ~0.8 m off in the live view at 200 ms; that is arithmetic, and I did not commit the per-shot distances, the hit rates above are the committed numbers).
Prediction under fire (bot walking a circle while aiming and firing, 11 shots): worst reconciler correction 3.7e-7 m at 0 ms and 3.5e-7 m at 100 ms RTT, i.e. shooting does not
touch the predicted step. A *knock* (server velocity added on a hit) is different: 0.42 m worst correction at 100 ms RTT while it is applied (bounded; the server owns it).

## Cannon
A fixture of the camp at (16.4, 4.4) (circle obstacle r .8). INTERACT held within 2.6 m is the work (phase 0 empty, 1 loading, 2 loaded, 3 fuse). Two or more crew load in 4 s, one in
8 s; walking off pauses the work; nobody carrying, downed or out of reach can work it; FIRE while working a loaded gun lights a 0.7 s fuse (the crew's card says "stand clear!") and the barrel slews toward the lead worker's aim within +-1.75 rad. The ball is a heavy projectile with a blast; `boom` events carry only the picture.

## Inputs, hostile client (tests in `rooms/combat.test.ts`)
Ammo cheating (empty gun, reload spam, weapon not owned, out-of-range or junk weapon numbers, the cannon as a carried weapon), trigger floods (three fresh presses per step for two seconds),
switching to launder a cooldown, shooting while downed/carrying/dragging/working a gun, an `aimYaw` pointing behind the camera (clamped to +-0.6 rad of the camera yaw), joiners changing the
friendly-fire rule, and event traffic (one `shot` event per pull however many pellets, impacts per shot capped, rounds of a departed player land harmlessly).

## Mutation checks run on the protections (each applied, the named test seen to FAIL, then reverted)
1. cooldown gate in `fire()` removed -> "the cooldown between shots is enforced on its own" fails (the first version of this check SURVIVED: the flood and switching tests were
   really stopped by the 2-round reload, so that test was added).
2. empty-magazine check removed -> "the magazine and the reserve count down..." fails.
3. weapon ownership check in `handleSwitch` removed -> "hostile weapon requests are refused" fails.
4. aim-yaw slack clamp removed -> "the shot direction cannot leave the camera's half-circle" fails.
5. friendly-fire rule ignored in the ray cast -> "friendly fire is a campaign rule" fails.
6. BUSY mask (downed/carrying/dragging/operating) ignored -> "nobody fires while downed..." fails.
7. cannon `soloFactor` .5 -> 1 -> "a lone gunner loads it at half speed" fails.
8. umbrella `severBias` 0 -> 3 -> "every blow and ball carries its weapon's sever bias" fails (the first version SURVIVED: the old test injected the bias itself; the new one spies on `Casualties.damage`).
9. lag compensation disabled in the hitscan view -> "hitscan at 200 ms RTT" fails (and the OFF control shows 0/14).

## Client
Weapon meshes are built like the character parts (`PartBuilder`, toon ramp, inked hull) in `render/weapons/WeaponModels.ts`; `WEAPON_ANCHORS` (grip at the origin, -Z down the barrel) is the contract
between the models and the animator's arm IK (`weaponPose.ts`: closed-form elbow, sideways abduction, Gauss-Newton polish, reach fitting; the left hand slides along the fore-end to what the arm can
reach). Third person: over-the-shoulder aim camera (`CameraRig`: while aiming the view looks *down the aim* from 1.15 m to the side, so the crosshair is where the shot goes and the wearer stands
left of it). First person: the same hold, raised toward the eye line. FX (`ShotFx`): additive star flashes, drifting smoke that follows the sky's wind, tracers, debris, shock rings, all pooled and
capped, scaled by the graphics level; gore goes through `HitFx`. Sound goes only through `render/weapons/sfx.ts` to the audio module's names.
`?fxslow=0.15` slows the effects for stills, but the loop clamps a frame to 50 ms, so at ~3 fps software rendering the effects advance only ~0.02 s per real second at that setting: wait
seconds before judging puffs.

## Weak spots (be honest)
- Lag comp is measured in a headless bot at 22 m on one strafing pattern; 200 ms RTT lands 71%. Real networks have jitter and loss the simulator does not; nothing here was run over a real link.
- Reviewed in a real browser by stills only (software GL ~3 fps): held weapons in third person, aiming, muzzle flash and smoke for the pistol, rifle and blunderbuss, sabre swing, cannon loading and blast,
  first-person ready/reload, a rifle hit with blood and the bearing chevron. NOT reviewed: gamepad (bindings exist, untested on a device), audio (names exist in the module; nothing was heard),
  gore Reduced/Off on a wound, four players at once, the umbrella swing frames, dismemberment by cannon.
- First-person aimed pistol/rifle sit low in the frame (the shoulder is far below the eye on these big-headed figures and the arm's reach limits how high the piece can come); the rifle is visible, the pistol only just.
- Surface dust puffs are pale on pale earth and read weakly; debris and the flash carry the impact.
- Blunderbuss on a body far to the side of the pellet cone, and the cannon against moving targets, are tuned by numbers, not by play.
- Balance is a first pass: nothing has been played by humans. Rifle 70 damage with head x2.2 downs a full-health man with one headshot by design; the cannon kills at its centre and the rim is gentle.
- The reload is a client picture keyed to the replicated progress (0..100); a dropped patch shows a stall, never a wrong ammo count.
- Bots shoot in tests (`BotFrame` combat fields); there is no combat AI for NPCs yet (D: utility AI is later).

---

# Update 2026-09-30 (agent P): impact effects

`render/weapons/ShotFx.ts`, `render/HitFx.ts` users, `game/CombatView.ts`, `showcase/Fx.ts` (`?showcase=fx&fx=impact|muzzle|hit|explosion&w= s= t= n= wind=`).
- **Dust reads on pale earth.** The puff shader (`PUFF_FRAG`) gets a lighter heart and a darker contour ring; and the raw shader materials (puffs, ring, scars) now include
  `tonemapping_fragment` + `colorspace_fragment`: before, palette colours were written as linear light straight to an sRGB target, so every cloud was darker and more saturated
  than its palette colour (the main reason dust looked like brown blobs on brown ground). Earth impacts: a lifted plume (bigger, longer, `PALETTE.world.dust` to `FX.dust`),
  a low ring of dust racing outward (`ringAt`; the ring pool is now 14, with per-ring alpha/life), flung clods, and a **ground scar** (`scar`: dent, lip, six cracks in a
  shader; pool of 40, 40 s, fades over the last quarter; stone floors get one too; walls none).
- **Wind.** `smokeWind(t, getAtmosphere().wind)`: the deterministic heading of `windAt`, scaled by `windGain` (0.5x calm to 3.4x gale). Muzzle smoke also leaves 1-4 big thin
  **powder haze** puffs that hang 3.5-5.5 s and drift downwind.
- **Debris.** A brass **percussion cap** flies from the lock (derived behind the muzzle: `LOCK_BACK`), beside the existing wad and sparks.
- **Bullet whizz.** `ShotFx.nearMiss` (hitscan tracers of other players, and flying balls via `Projectiles`): a round passing within 3.2 m but not through you and not from your
  own muzzle leaves two hairline streaks and a ripple, rate-limited to one per 0.12 s (a blunderbuss is one whizz), and flicks the camera (scaled by the shake setting). No
  sound was added (sound recipes are the audio agent's).
- **Gore Off** hits also throw soft dust (`bodyDust`) in addition to the pale sparks.
- **Hit direction** (`CombatHud.damageFrom`): up to six exact-bearing wedges-with-arrowheads on a ring round the sight (was four quadrant slots), a repeat hit from about the
  same direction refreshes its mark, bold by damage; colour-blind and high-contrast modes draw it in ink.
- **Low health**: `.vitals` hatching closes in from the screen edges (a pattern, not just red) at 55%, harder and pulsing at 35%, heaviest with a desaturating sepia when
  down; the gauge label says Critical! / Down, never colour alone.
- **Downed camera** (`CameraRig.update(..., downed)`): the follow camera settles 32% closer and ~1 m lower, looks a little up, with a slow unsteady drift; eases out on revive.
  No cut, no kill-cam. First person already lay down (`downedPitch`).
Tests: `weapons/shotfx.test.ts` (wind scaling, scars pooled and expiring, cap/haze, whizz rules, disposal), `CameraRig.test.ts` (downed framing), `ui/interface.test.ts`.
Weak spots: dust/puff look is judged from stills; scars are flat quads (they float on steep slopes); the flash is in the world pass so the viewmodel barrel can cover part of it.
