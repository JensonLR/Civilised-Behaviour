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
