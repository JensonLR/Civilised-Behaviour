import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Client -> server input frame. Flat primitives only (Colyseus input codec requirement) and
 * quantised so a 30 Hz stream costs a few bytes per frame after delta encoding.
 */
export const MoveInput = schema({
  moveF: t.int8(),
  moveR: t.int8(),
  yaw: t.uint16(),
  buttons: t.uint16(),
});
export type MoveInputType = SchemaType<typeof MoveInput>;

export const PlayerState = schema({
  name: t.string(),
  // --- predicted movement state (mirrored 1:1 by the client reconciler) ---
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  vx: t.float32(),
  vy: t.float32(),
  vz: t.float32(),
  facing: t.float32(),
  /** FLAG bits (uint16: more than 8 states now). */
  flags: t.uint16(),
  stumble: t.float32(),
  // --- server-owned, not predicted ---
  /** Encoded CharacterSpec (see @cb/procedural). Validated and re-encoded by the server; ~54 chars. */
  look: t.string(),
  /** Campaign nickname/title shown with the name (server-owned; empty until earned). */
  title: t.string(),
  /** 0..100. Server-owned. Reaching 0 puts the player down (revivable), never removes them. */
  health: t.uint8(),
  /** Packed wound severities, 2 bits per ZONE (see wounds.ts). Server-owned; drives bandages, blood and limping on every client. */
  wounds: t.uint16(),
  /** Bit mask of lost limbs (LIMB in limbs.ts). Server-owned; persists through downing and reviving. */
  missing: t.uint8(),
  /** 0..100 progress of a revive in progress ON this (downed) player. */
  reviveProgress: t.uint8(),
  /** Session id of whoever is reviving this player, or "". */
  reviver: t.string(),
  /** Session id of whoever is dragging this player, or "". */
  dragger: t.string(),
  slot: t.uint8(),
  connected: t.boolean(),
});
export type PlayerStateType = SchemaType<typeof PlayerState>;

/** The subset of PlayerState the reconciler predicts. */
export const PREDICTED_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "facing", "flags", "stumble"] as const;

export const PropState = schema({
  kind: t.uint8(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  qx: t.float32(),
  qy: t.float32(),
  qz: t.float32(),
  qw: t.float32(),
  /** Session id of the carrying player, or "". */
  holder: t.string(),
});
export type PropStateType = SchemaType<typeof PropState>;

export const WorldState = schema({
  code: t.string(),
  seed: t.uint32(),
  players: t.map(PlayerState),
  props: t.map(PropState),
  /** This campaign allows limbs to be severed (rules chosen at creation). Clients may still opt out of SEEING it. */
  dismemberment: t.boolean(),
});
export type WorldStateType = SchemaType<typeof WorldState>;
