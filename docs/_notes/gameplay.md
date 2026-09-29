# Notes for DECISIONS: injuries in gameplay (2026-09-29)

Proposed entry **D-026 Injuries matter (predicted input, not a server-only slowdown)**. Supersedes the "no gameplay effect yet" line in D-019 and the
"not done: movement effect of limb loss" in D-023. (Numbers in NETWORKING.md; code in `packages/shared/src/injury.ts`.)

## Decisions
1. **One pure mapping, three consumers.** `injuryMods(wounds, missing, prosthetic, out)` decides speed, sprint, jump, carry mass and throw strength. The shared step,
   the server's pickup/throw rules and the client prompt all call it, so they cannot disagree. Tuning lives in `INJURY`, table-tested (incl. a monotonicity test:
   adding a wound or removing a limb never improves any ability).
2. **Wounds and limbs are predicted INPUTS.** `wounds` and `missing` joined `CharState` and `PREDICTED_FIELDS`; the step reads, never writes them. The Colyseus
   reconciler adopts them from the same snapshot as position + ack and replays with them, so a wound landing mid-sprint costs <= 1 mm mean / 45 mm worst correction
   (120 ms RTT) instead of 70-217 mm / ~0.5 m unmirrored. Rejected: server-only slowdown (rubber-banding on every hit), sending the slowdown as a separate
   replicated float (redundant with the mask, a second thing to keep equal), running the mapping only on the server and correcting later (same snap).
3. **Lost limb overrides the wound on its zone.** A stump is always grievous (and stays 2 after a revive), so counting it would make a wooden leg pointless and
   double-punish. Consequence: dressing a stump changes the picture, not the ability.
4. **Wooden leg = a flag, not the look string.** `FLAG.PEG_LEG` is raised by the server when `look.woodenLeg` (server-owned history) is fitted where a leg is missing
   (`prosthesisFor`, refreshed on sever/restore/look change, not per tick). A flag is already predicted; a string in the reconciler field list would have turned off its
   history ring. The peg softens the hobble (x0.45 -> x0.7) and gives back the jump, never the sprint, never a whole leg. Fitting one is still debug-only
   (`debug peg:<n>`); the campaign layer will grant them.
5. **Arms gate carrying, not walking.** Two sound arms lift anything; one sound arm (other lost or grievous) only light props (<= 8 kg: bottle, chair); both lost
   nothing. Throws scale by the mean arm power. The check is enforced twice on the server: at the pickup gate, and every tick (a carrier who loses an arm drops the
   crate). Tests observe the gate directly (spy on `physics.hold`) so the second layer cannot hide a broken first.
6. **Head/torso grievous = no sprint only.** There is no stamina system; "dizzy/winded" is the cheapest honest expression. Revisit when stamina exists.
7. **Field dressing reuses the revive hold** (no new input bit, no protocol change): INTERACT, 2 s, on a standing wounded comrade, one severity level per action,
   floors at scratch (1) and dressed stump (2), never self, no health. Bleed-out stays rejected: people are downed, not dying. Priority: revive > prop > dress; a player who
   cannot lift the prop beside them falls through to dressing. Rejected: a dedicated TREAT button (needs Controls/HUD work and a mapping for pads for little gain), dressing
   yourself (removes the reason to keep a medic), letting dressing reach 0 (scars are the story, D-019).
8. **Revive and rout never restore limbs.** `restoreLimbs` is debug-only and documented as such; tests assert the limb (and the hobble) survive both.
9. **Hostile-input policy.** The client sends 4 fields; everything here is derived from server-owned state, so the attack surface is "crafted buttons": tests send
   sprint/jump from hobbled bodies (also flooded 3 frames per step), 0xffff button words from an armless body, INTERACT at heavy props with one arm, self-dressing,
   dressing out of range and with an early release. Mutation-checked: breaking each guard fails the matching tests (see report).

## Left / follow-ups
- No campaign source of wooden legs yet; no medical supplies, so dressing is free (a cost is a campaign-layer decision).
- `carryFactor` still ignores prop weight class (MOVEMENT comment promises it); heavy props could slow carriers further.
- Camera/aim sway for head wounds is client-only cosmetic (not done).
- `driftEma` of the reconciler now includes numeric jumps of `wounds`/`missing`/`flags`; only the positional `correction*` numbers are meaningful in bot tests.
- Client HUD wording ("Dress X's leg", carry refusal) is minimal; a proper surgeon's-tag tooltip is art/UI work.
