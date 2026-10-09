import { NPC } from "./campaignTypes.ts";

/**
 * D-094: a BEAST is an NPC row that is not a person (`NPC.BEAST`, `FLAG.BEAST` on its row): the hunt's quarry. The server's Cast drives it with the `beast` brain (graze, shy,
 * bolt, charge); its body is `BEAST_SHAPES` (ballistics.ts) for every hit test; it never loses a limb, is never revived or dragged, and the client draws it as an animal.
 * These are its numbers (first pass, unplayed).
 */
export const BEAST = {
  /** Health at the start (a person has 100): six or seven rifle balls to the barrel, three or four to the head. */
  health: 240,
  /** It walks away from anybody nearer than this (so a party can DRIVE it), and trots away from anybody nearer than `startleR`. */
  shyR: 9,
  startleR: 4,
  /** It grazes within this of where it stands, a step every few seconds; strayed further than 1.5x this from its post (the barley it came for), it ambles back, `homeStep` at a time. */
  grazeR: 5,
  homeStep: 4,
  /** Driven, it jinks up to this far (radians) either side of the way it is pushed, a new angle every two seconds. */
  jink: 0.5,
  /** Wounded, it charges whoever hurt it for this long (or until it has struck them), then bolts. */
  chargeSeconds: 5,
  /** Its horns reach this far from its centre (the strike), and do this much (a hard blow; the person is thrown). */
  hornReach: 2.3,
  hornDamage: 34,
  /** A strike is followed by this long before another. */
  hornCooldown: 1.6,
} as const;

/** Whether an NPC role is a beast's (the client draws these as animals, not people). */
export const isBeastRole = (role: number): boolean => role === NPC.BEAST;
