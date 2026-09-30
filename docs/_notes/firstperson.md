# Notes for DECISIONS / BUILD_STATE: first-person view (2026-09-29)

Proposed entry **D-0xx First person is a camera mode over the same body, not a second character.** Code: `apps/client/src/render/firstPerson.ts` (pure maths),
`CameraRig.ts` (both views), `CharacterActor.ts` (`setFirstPerson`, `sampleEye`), `settings.ts` (`getView`/`getHeadBob`), `ui/Hud.ts` (crosshair).

## Decisions
1. **Toggle key is X, not V.** V is already melee (`KeyV: BUTTON.MELEE`). X (`VIEW_KEY` in `input/Controls.ts`) was free; on a pad it is a click of the right
   stick (R3, `VIEW_PAD_BUTTON = 11`), edge-triggered, because every face button and bumper is bound and left-stick click is not used but R3 is the conventional
   "view" button. The menu and the field hint say X. Ignored while typing in an input/select.
2. **Persisted, with a URL override.** Menu "Camera: Third person / First person" -> `localStorage cb.view`; `?view=first|third` wins for the session and does not
   touch the saved choice (same convention as `?gore=`). Default third person. Head bob is a separate menu option (`cb.headBob`, `?headbob=0|1`), default ON
   unless `prefers-reduced-motion`, in which case default OFF; an explicit choice beats the media query.
3. **The camera follows the rig's head, not a separate eye point.** `CharacterActor.sampleEye` reads the head joint's world matrix (neck), its up/forward axes,
   the torso centre and the eye offset from `rig.face.eyeL`. `eyePosition` puts the lens straight above the neck and a little ahead along the VIEW yaw (so idle
   head glances never rotate the picture), and blends to the head's own axes as the body lies down. Crouching, kneeling, the gait's own sway and a limp all
   lower or move the eye for free because the animation moves the neck. Vertical follow is low-passed at a rate the head-bob setting controls, so with bob off
   the gait sway is filtered out and the picture is still.
4. **Own head hidden, shadow kept.** `rig.joints.head.visible = false` (hair, hats, eyewear, the head's outline all live under that one group), plus an
   invisible depth-only sphere on the torso so the shadow still has a head. Torso/arms/legs stay visible. The head hides when the 0.25 s blend passes 70% and
   shows again as soon as it falls below, so the lens is never inside a hat mid-transition. Remote players are untouched; they see the whole figure, always.
   The rig is rebuilt on a look change: `applyHeadVisibility()` re-applies after every rebuild.
5. **The body turns with the camera** (first person only, local only): `CharacterActor.facing` is the drawn heading; `Game.onHit` uses it so a flinch
   goes the right way. The server's facing is unchanged (it is the yaw the client already sends), so nothing else moves.
6. **Arms are posed for the camera** (`FIRST_PERSON_ARMS`, added after the animator, local body only): a loose guard raises the hands into the bottom of the
   frame; carrying and kneeling are absolute poses with the hands in front of the eyes. A ragdoll pose still overrides.
7. **Lying down is measured, not timed.** A downed body reports how far over it is (`root.rotation.x / (PI/2 - 0.1)` -> `EyeSample.lie`), so the view
   descends and looks up in step with the body, and on a get-up the lens tracks the rising head (rates go up mid-sweep) instead of lagging into the torso. The
   pitch swings to about 63 degrees up (`downedPitch`); the mouse only nudges it. A physics ragdoll has no such number: the camera anchors on the TORSO centre
   (never the tumbling head), eases in over ~0.3 s, is lightly smoothed and eases out when the animator takes over.
8. **Same input, same movement.** Yaw/pitch are the rig's; `Controls` reports the same yaw to the shared movement step. First person only widens the pitch
   range (+-1.45 rad instead of -0.35..1.25).
9. **HUD.** A 6 px ink dot with a paper ring (`.crosshair`, CSS variables only) shows only when first person is fully active and the player is not downed. The
   local nametag is already not drawn. Prompts and the progress ring are unchanged.

## Bug found on the way (fixed): flinch spring explosion
`CharacterAnimator`'s flinch spring (k=220, c=15) was integrated with one explicit step per frame. At the game's dt cap of 0.1 s (any machine below ~10 fps) it
diverged (torso rotation reached 1e54 rad within a second of a knock-down) and the figure flailed until reload. It is now sub-stepped at <= 16 ms, with a
regression test in `packages/procedural/src/three/rig.test.ts`.

## Not done / weak spots
- Headless screenshots only (software GL). Nothing here was profiled; the added per-frame cost is one `updateMatrixWorld` on the local rig and a few multiplies.
- Ragdoll first-person is judged by eye on a handful of frames; the fall itself (first ~0.5 s) shows the body's shoulder/arm close to the lens, which is honest
  but busy.
- Kneel/revive hands are an absolute pose; they do not yet reach toward the patient's actual position.
- Gamepad: R3 is used; no on-screen glyph for it (the menu note mentions it).
- Aim FOV zoom (`aimFovScale`) is a gentle 10 %; there is no scope or ADS view.

---

# Update 2026-09-30 (agent P): the first-person VIEWMODEL

Problem this fixes: the aimed rifle sat low and the pistol was barely visible, because the hands and weapon were the third-person body's (shoulders behind and beside the
lens), nudged toward the view. They are now a separate thing: **a dedicated arms + weapon model on its own camera, drawn as a second pass over the world.**

## What it is
- `render/viewPose.ts` (pure maths, no three.js, allocation-free): where the weapon and both hands are in CAMERA space for every weapon and state (hip, aimed, sprint,
  reload with the free hand's route, fire kick, three slashes + a butt-stroke/thrust + alternating fists, draw/holster, carry / kneel / drag / crew), with look-sway,
  walking bob, breathing, recoil. `solveViewArm` puts each hand on its target (same `solveArm` as the body's hold). `SIGHTS` holds the sight line of each firearm in model
  space and the test proves the aimed pose puts rear and front sight on the camera's axis (x within 3 mm, y within 12 mm, within a degree): **the sights ARE the crosshair**.
- `render/ViewModel.ts`: builds the player's own arms by building the normal character rig from their look and re-parenting only its two shoulders into camera space
  (sleeves, skin, gloves, wounds, prosthetics and missing arms all work as on the body; with agent R's wrist bones present it lays each fist's grip axis on the weapon's handle
  via `solveWrist`, feature-detected), plus `WeaponModel(id, outline, firstPerson=true)`. Its own `Scene` and a `PerspectiveCamera` (FOV 62, follows the FOV setting by 35%,
  near 0.03) put at the world camera's pose each frame; the sun and sky lights are copied from the stage. `render()` does `clearDepth()` then renders: **the hands can never sink
  into a wall** (proved by `?showcase=viewmodel&wall=0.4`), and the world's wide lens does not stretch the gun. One draw per arm bone + hulls + the weapon and its hull:
  about 10 draws, ~8k triangles.
- Long guns use a viewmodel variant of the model with the stock trimmed behind the wrist (a shooter's eye never sees the butt plate; a butt in front of the lens was a wall of
  brass). The percussion nipple moved 3 cm off the sight line (it sat exactly on it).
- Body and viewmodel: while the viewmodel draws, the body's own arms and weapon are `ghost`ed (`render/ghost.ts`): they keep casting their shadow (colour-write and
  depth-write off; hulls and dressings hidden), everything else is untouched; re-applied every frame so a new dressing or a rebuilt rig is ghosted too. Remote players are
  never touched. The viewmodel is shown only on your feet in first person (not downed, not dragged, not ragdolled); otherwise the body's arms are what you see.
- Muzzle flash, smoke, tracer and ejected cap leave the VIEWMODEL's muzzle: `matchScreenPoint` maps a point from the viewmodel lens to where the world lens would draw it at
  the same screen spot (the two lenses differ), pushed 6 cm along the barrel so the flash is in front of the gun. `CombatView.viewmodel` carries it; recoil and blows are
  triggered from `predictShot` / `predictBlow` together with the body's.
- Settings that act on it, live: FOV, head bob (walking bob only), reduce motion (sway and recoil to 30%), gore and show-limbs (arm wounds/stumps), colour of sleeves follows the look.
- `?showcase=viewmodel` (see its header: `w= state=hip|ads|sprint|reload|fire|swing|bash|draw|carry|kneel|drag|crew u= kind= seed= wall= wounds= missing= hide=L|R`).

## Decisions and traps
- Camera space, not the torso's: a viewmodel's shoulders are wherever the hands can use them (`SHOULDER_SLACK` 0.12 m, `SHOULDER_MIN_Z`), the forearm+hand is scaled
  down for giant-fisted characters (`VM_HAND`, floor 0.62) and the upper arm stretched up to 1.25x so a 0.52 m arm can still hold a rifle at the sights. A test runs 43 bodies
  (3 extremes + 40 generated) x 6 weapons x 11 states: the hand ends within 1.5 cm of its target.
- Hands at `y = -0.19` at 0.44 m are at the bottom of a 62 degree frame: anything lower is OUT of the picture (the fists were first invisible). The horn for reloading is
  deliberately below the frame: the hand leaves the picture to fetch it.
- The shader-written effects (puffs, ring, scars) used to write linear light to an sRGB target: see the impact-effects update in `combat.md`.
- `renderer.info.autoReset` is turned off while a viewmodel exists and `Game.frame` resets it once, so the F3 overlay counts both passes.

## Not done / weak spots
- Judged by eye on software GL stills only; the ADS stock wedge (the dark stock coming up the bottom of the frame) is realistic but heavy; a real GPU and a real hand on the
  mouse may want the sights 1-2 cm lower, or the hip pose further right. All numbers are in the pose tables at the top of `viewPose.ts`.
- Never played with a server: the wiring in `Game.updateViewmodel` / `CombatView` is tested only through the ViewModel/ghost tests and the showcase.
- Carry/kneel/drag hands are in front of the lens, not reaching the actual prop / patient.
- The body's weapon still runs its own animator hold in first person (for the shadow); the viewmodel is independent of it by design.
- The flash can be partly covered by the barrel (the flash is in the world pass, the gun in the second pass).
