/** Simulation and network rates. Profiled values live in docs/PERFORMANCE.md. */
export const TICK_RATE = 30;
export const STEP_DT = 1 / TICK_RATE;
export const PATCH_RATE_MS = 50;
export const MAX_PLAYERS = 4;
export const MAX_MESSAGES_PER_SECOND = 120;

/** Collision envelope shared by every caricature body regardless of customisation. */
export const CHARACTER = {
  radius: 0.4,
  height: 1.8,
  crouchHeight: 1.2,
  stepHeight: 0.5,
  /** Steepest walkable slope, as rise/run (~50 degrees). */
  maxSlope: 1.2,
  snapDistance: 0.35,
} as const;

export const MOVEMENT = {
  walkSpeed: 2.2,
  runSpeed: 4.4,
  sprintSpeed: 6.6,
  crouchSpeed: 2.0,
  groundAccel: 32,
  groundDecel: 44,
  airAccel: 7,
  gravity: 22,
  jumpSpeed: 6.6,
  turnRate: 14,
  /** Fraction of control kept while stumbling. */
  stumbleControl: 0.15,
  terminalVelocity: 40,
  /** Speed multiplier while carrying a prop (further scaled by the prop's weight class). */
  carryFactor: 0.72,
  /** Speed multiplier while dragging a body. */
  dragFactor: 0.55,
  /** Crawl speed of a downed player. */
  crawlSpeed: 0.9,
  /** Speed multiplier while aiming down a weapon (AIM held): a steadier, slower walk. Sprinting is not possible while aiming. */
  aimFactor: 0.7,
} as const;

/** Bit flags packed into PlayerState.flags (uint16). */
export const FLAG = {
  GROUNDED: 1,
  JUMP_LATCH: 2,
  CROUCHING: 4,
  SPRINTING: 8,
  DOWNED: 16,
  /** Set by the server while a player holds a prop (slows movement, blocks sprint/jump). */
  CARRYING: 32,
  /** Server-set: this player is kneeling over a downed teammate, reviving them. */
  REVIVING: 64,
  /** Server-set: this player is dragging a downed teammate. */
  DRAGGING: 128,
  /** Server-set: this (downed) player is being dragged; the server steers their velocity, input is ignored. */
  DRAGGED: 256,
  /** Server-set: a wooden leg is fitted where a leg is missing (softens the hobble, see injury.ts). Predicted like every flag. */
  PEG_LEG: 512,
  /** Derived by the step from the AIM button (predicted like every flag): the body is aiming down a weapon, so remote clients pose it that way. */
  AIMING: 1024,
  /** Server-set: this player is working a field cannon (loading, aiming); like REVIVING they hold their ground and lean into the work. */
  OPERATING: 2048,
} as const;

/** Bit flags packed into MoveInput.buttons (uint16). */
export const BUTTON = {
  SPRINT: 1 << 0,
  CROUCH: 1 << 1,
  JUMP: 1 << 2,
  INTERACT: 1 << 3,
  AIM: 1 << 4,
  FIRE: 1 << 5,
  RELOAD: 1 << 6,
  MELEE: 1 << 7,
  THROW: 1 << 8,
  /** Grab / let go of a downed teammate to drag them. */
  GRAB: 1 << 9,
} as const;

/** Physics/collision layer bit masks. Planned up front so nothing collides with everything. */
export const LAYER = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  NPC: 1 << 2,
  PROP: 1 << 3,
  PROJECTILE: 1 << 4,
  RAGDOLL: 1 << 5,
  SENSOR: 1 << 6,
  VEHICLE: 1 << 7,
  TRIGGER: 1 << 8,
} as const;
