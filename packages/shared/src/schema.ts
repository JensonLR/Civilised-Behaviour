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
  // --- combat (append-only; the movement step never reads these) ---
  /** Direction of a shot, same encoding as yaw (0..65535 = 0..2PI). Constrained server-side to within COMBAT.aimYawSlack of `yaw`. */
  aimYaw: t.uint16(),
  /** Elevation of a shot in 1/20000 rad (+ = up), see elevToWire. */
  aimElev: t.int16(),
  /** Weapon wanted in hand: 0 = nothing drawn, else weapon id + 1 (weaponToWire). The server only honours weapons the player owns. */
  weapon: t.uint8(),
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
  // --- combat (server-owned, append-only) ---
  /** The weapon in hand: 0 = none, else weapon id + 1. */
  weapon: t.uint8(),
  /** Bit i set = the player carries weapon id i. */
  weapons: t.uint8(),
  /** Rounds in the magazine of the weapon in hand, and spare rounds for it. */
  ammo: t.uint8(),
  reserve: t.uint8(),
  /** 0..100 progress of a reload in progress, else 0. */
  reload: t.uint8(),
  /** Attacks made so far (wraps at 256): seeds the shot pattern (shotSeed) and lets remote clients play the recoil or the swing. */
  shots: t.uint8(),
  /** Aim elevation for the pose of remote figures, 1/80 rad (int8: +-1.58 rad). Cosmetic. */
  aim: t.int8(),
  // --- campaign cast (append-only) ---
  /** 0 = a real player; else NPC.* (a garrison/rival row keyed `npc:<id>`, slot 16+, driven by the server through the same step). */
  npc: t.uint8(),
  // --- expedition (append-only, D-034) ---
  /** A hired hand's current order (CommandId index, 255 = none). Plates only. */
  cmd: t.uint8(),
  /** A hired hand's morale 0..100 (plates only). */
  morale: t.uint8(),
  // --- fire (append-only, D-103) ---
  /** On fire: tenths of a second left burning (0 = not alight). Server-owned; the clients draw the flames on the body and the scream. */
  burn: t.uint8(),
});
export type PlayerStateType = SchemaType<typeof PlayerState>;

/**
 * The subset of PlayerState the reconciler mirrors. `wounds` and `missing` are server-owned INPUTS to the shared step (injury.ts): the
 * step never writes them, but the reconciler must snapshot them with the position they produced, or a replay after a correction
 * would step with stale injuries. They change rarely, so they do not defeat the reconciler's "prediction matches" skip.
 */
export const PREDICTED_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "facing", "flags", "stumble", "wounds", "missing"] as const;

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
  /** D-054: a lit keg's fuse, tenths of a second left (0 = not lit). */
  fuse: t.uint8(),
});
export type PropStateType = SchemaType<typeof PropState>;

/** A crewed field cannon: a fixture of the camp. Position and rest yaw never change; the barrel slews, the round loads, the crew is counted. */
export const CannonState = schema({
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  /** Barrel heading (radians, 0 = -Z) and elevation (+ = up). */
  yaw: t.float32(),
  elev: t.float32(),
  /** 0 empty, 1 loading, 2 loaded, 3 fuse lit. */
  phase: t.uint8(),
  /** 0..100: loading progress, or the fuse burning down. */
  progress: t.uint8(),
  /** People working it right now (loading or laying), and rounds left in its limber. */
  crew: t.uint8(),
  shells: t.uint8(),
  /** Times fired (wraps): the recoil and the flash are keyed to it. */
  fired: t.uint8(),
  /** D-092: 0 the field cannon, 1 the post's crank gun (whose phases and counters read as `CRANK` says). */
  kind: t.uint8(),
});
export type CannonStateType = SchemaType<typeof CannonState>;

/** A horse or a wagon (written by the server's Mounts system; a ridden horse is drawn from its rider's predicted state). `kind`/`phase`: see mount.ts MOUNT_KIND / MOUNT_PHASE. */
export const MountState = schema({
  kind: t.uint8(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  facing: t.float32(),
  speed: t.float32(),
  /** Session id (or `npc:` key) of the rider, "" when nobody rides. */
  rider: t.string(),
  /** Wagon: id of the horse hitched to it; horse: id of the wagon behind it. */
  hitch: t.string(),
  /** Horse coat seed (decodeHorse / horseFromSeed). */
  coat: t.uint32(),
  phase: t.uint8(),
  hp: t.uint8(),
  /** Wagon: crates loaded (low nibble) and bodies loaded (high nibble). */
  cargo: t.uint8(),
});
export type MountStateType = SchemaType<typeof MountState>;

export const WorldState = schema({
  code: t.string(),
  seed: t.uint32(),
  players: t.map(PlayerState),
  props: t.map(PropState),
  /** This campaign allows limbs to be severed (rules chosen at creation). Clients may still opt out of SEEING it. */
  dismemberment: t.boolean(),
  // --- the world clock (append-only; see daycycle.ts `worldHours` and weather.ts `weatherAt`) ---
  /** Milliseconds the world has been alive, as of the server's last sync (refreshed every few seconds and on every join). Clients extrapolate with their own monotonic clock. */
  worldMs: t.float64(),
  /** The clock hour the world started at (server config). */
  dayStartHour: t.float32(),
  /** Real minutes a full day takes (server config; 0 freezes the clock). */
  dayMinutes: t.float32(),
  // --- combat rules and fixtures (append-only) ---
  /** Campaign rule: shots and blasts hurt comrades (weapon.ffScale applies). Default on; the creator may switch it off. */
  friendlyFire: t.boolean(),
  cannons: t.map(CannonState),
  // --- the campaign (append-only) ---
  /** The active region (RegionId). One room holds one active region; sailing swaps it. */
  region: t.string(),
  /** Sailing: 0 idle, 1 proposed, 2 sailing, 3 arriving (clients build the new world, then send regionReady). */
  travelPhase: t.uint8(),
  travelTo: t.string(),
  /** Bitmask of slots that said yes (phase 1) or have arrived (phase 3). */
  travelReady: t.uint8(),
  /** Whole seconds left in the current travel phase. */
  travelLeft: t.uint8(),
  /** CampaignState JSON (server-owned, parsed by parseCampaign) and its revision. */
  campaign: t.string(),
  campaignRev: t.uint16(),
  /** ScenarioView JSON ("" outside a scenario) and its revision. */
  scenario: t.string(),
  scenarioRev: t.uint16(),
  // --- the expedition (append-only, D-034) ---
  mounts: t.map(MountState),
  /** PartyState JSON (loadout manifest + hired roster, < 2 KB; parseParty) and its revision. */
  party: t.string(),
  partyRev: t.uint16(),
  // --- the campaign grows a future (append-only, D-035) ---
  /** PowersState JSON (the three minor powers, the relation map, the rival agent, flags and a short log; < 3 KB; parsePowers) and its revision. */
  powers: t.string(),
  powersRev: t.uint16(),
  /** SettlementsState JSON (the outposts and the latched tech; < 2 KB; parseSettlements) and its revision. */
  settlements: t.string(),
  settlementsRev: t.uint16(),
  // --- fire (append-only, D-103: fire.ts) ---
  /** The cells burning now (FireGrid.encodeBurning: a few hundred characters at most; refreshed at most twice a second while it changes). */
  fire: t.string(),
  /** The scorched ground (FireGrid.encodeBurnt), for anyone who joins after it burnt (refreshed at most every two seconds while it changes). */
  scorch: t.string(),
});
export type WorldStateType = SchemaType<typeof WorldState>;
