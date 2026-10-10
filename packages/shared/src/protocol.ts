/** Room names and JSON-ish message contracts shared by client and server. */
import type { ParleyView, RegionId, ScenarioTemplateId } from "./campaignTypes.ts";
import type { CommandMsg, Loadout } from "./expeditionTypes.ts";
import type { PowerId } from "./worldTypes.ts";

export const ROOM_WORLD = "world";

export interface JoinOptions {
  /** Display name, sanitised server-side. */
  name?: string;
  /** Campaign join code (empty/absent when creating). */
  code?: string;
  /** Opaque identity token from the PlatformIdentity adapter (browser: generated id). */
  token?: string;
  /** Desired world seed when creating a campaign. Server may clamp/replace. */
  seed?: number;
  /** Encoded character look (untrusted; the server validates, clamps and strips server-owned history). */
  look?: string;
  /** Campaign rule chosen when creating: allow dismemberment (default true). Ignored when joining. */
  dismemberment?: boolean;
  /** Campaign rule chosen when creating: comrades can be hurt by your shots (default true, server default from FRIENDLY_FIRE). Ignored when joining. */
  friendlyFire?: boolean;
  /** Region the campaign starts in (create only; default hollowmere; validated server-side). Dev, tests and screenshots: in play the party sails. */
  region?: RegionId;
  /** Contract offered at Kessar (create only; dev, tests and screenshots: in play the campaign ledger picks it). Validated server-side. */
  scenario?: ScenarioTemplateId;
  /**
   * RESUME a saved campaign by its join code (create only; D-035). The server loads the record, requires that `token` was a member, restores seed + ledger and starts at HQ.
   * A production feature (not dev-gated); a non-member and an unknown code get the SAME error. Ignored when joining.
   */
  resume?: string;
}

/** Client -> server messages other than the input stream. */
export interface ClientMessages {
  ping: { t: number };
  setName: { name: string };
  /** Change appearance (HQ/creator). Rate limited; history fields are ignored. */
  setLook: { look: string };
  /** Sailing (validated by the server's travel machine; out-of-phase or stale messages are ignored). */
  travelPropose: { to: RegionId };
  travelReady: { ready: boolean };
  travelCancel: Record<string, never>;
  regionReady: { region: RegionId };
  /** Parley with the Lamp-Warden: pick option `option` of the open view / walk away. Only the session that owns the parley is heard. */
  parleyPick: { option: number };
  parleyClose: Record<string, never>;
  /** The manifest at the supply table (edited freely by anyone at the table; the server normalises and re-validates it at propose and at sail). */
  loadoutSet: { loadout: Loadout };
  /** Hire (`on`) or dismiss a hand by roster/pool id. Only at the table. */
  hire: { id: string; on: boolean };
  /** An order to the hired hands. Hostile until the server's parser accepts it. */
  command: CommandMsg;
  /** Ask for an audience with a power at HQ (D-035): only the map table or dock, only for a power that is pending today; the answers reuse `parleyPick`/`parleyClose` and the `parley` message. */
  audienceOpen: { power: PowerId };
  /** Save the campaign's ledger now and say how it went (the pause sheet's "Save now" / "Save and quit"). Rate limited; answered with `saved` (`asked: true`) to the sender only. */
  saveNow: Record<string, never>;
}

/** Minimum gap between accepted setLook messages per client. */
export const SET_LOOK_MIN_INTERVAL_MS = 1500;

/** Server -> client messages. */
export interface ServerMessages {
  pong: { t: number; serverTime: number };
  notice: { text: string };
  /** A player took a hit. Cosmetic only (flinch, blood, ragdoll impulse); the authoritative result is in PlayerState. */
  hit: HitEvent;
  /** A limb was severed (cosmetic companion of the authoritative PlayerState.missing bit). */
  sever: SeverEvent;
  /** Someone fired (cosmetic: flash, smoke, tracers, sound). Direction is the aim; pellets and spread come from `seed` via weapons.ts. */
  shot: ShotEvent;
  /** A projectile or ray struck the world (cosmetic: dust, splinters, sparks, ricochet). */
  impact: ImpactEvent;
  /** An explosion (cosmetic: fireball, smoke column, shake). Damage and impulses were already applied by the server. */
  boom: BoomEvent;
  /** D-073: somebody cried out in panic (a civilian bolting, a soldier whose nerve has gone). Cosmetic: a voice at their row. */
  cry: CryEvent;
  /** Sent only to the shooter: their shot found somebody. Drives the hit marker. */
  hitmark: HitMarkEvent;
  /** Open a station UI for this player (the map room, or the paper at the notice board). */
  station: { kind: "map" | "paper" | "loadout" };
  /** The parley's state for its owner: a new view, or it closed (with the closing line). */
  parley: { view?: ParleyView; line?: string; closed?: boolean };
  /** Where the campaign's save stands: sent to a joiner, after every save the room makes, and in answer to `saveNow` (`asked`). */
  saved: SavedMsg;
}

export interface SavedMsg {
  /** False when this room keeps nothing (the web demo, or a campaign made without a usable identity): "Saved" must never be shown then. */
  kept: boolean;
  /** The last save attempt went through. */
  ok: boolean;
  /** Epoch ms of the last good save (0: none yet). */
  at: number;
  /** This answers a `saveNow`. */
  asked?: boolean;
}

export interface ShotEvent {
  /** Session id of the shooter, or `cannon:<id>`. */
  id: string;
  /** Weapon id. */
  w: number;
  /** Where the round left (world), and the unit aim direction. */
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /** Pattern seed (weapons.ts shotSeed) for the pellet/spread directions. */
  seed: number;
  /** Spread half-angle the server used. */
  spread: number;
  /** This was a blow (a swing, a butt-stroke, a punch), not a discharge: `w` is the weapon in hand. */
  m?: boolean;
}

export interface ImpactEvent {
  /** Session id of the shooter (or `cannon:<n>`). */
  id: string;
  x: number;
  y: number;
  z: number;
  /** Surface normal (unit). */
  nx: number;
  ny: number;
  nz: number;
  /** SURFACE id. */
  s: number;
  /** Weapon id that made it (sizes the puff). */
  w: number;
}

export interface CryEvent {
  /** The row (an NPC key) that cried out. */
  id: string;
}

/** D-087: a party member exclaims (cosmetic): who (a session id or row key) and the occasion; the client picks the words (`barkLine`) and the babble. */
export interface BarkEvent {
  id: string;
  k: string;
  /** Picks the line, the same on every client. */
  salt: number;
}

export interface BoomEvent {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface HitMarkEvent {
  zone: number;
  /** The blow put the victim down. */
  down: boolean;
  /** A limb was taken. */
  sever: boolean;
  /** D-105: it was a coup de grace (a blow on a staggered man). Absent: an ordinary blow. */
  fin?: boolean;
}

/** Broadcast when a limb comes off. Direction and power drive the flying limb and the spray. */
export interface SeverEvent {
  /** Session id of the victim. */
  id: string;
  /** LIMB bit. */
  limb: number;
  dx: number;
  dz: number;
  power: number;
}

/** Broadcast when a player is harmed. `dx`/`dz` is the unit horizontal direction the blow pushes the victim. */
export interface HitEvent {
  /** Session id of the victim. */
  id: string;
  /** ZONE the blow landed in. */
  zone: number;
  dx: number;
  dz: number;
  /** 0..1: how hard the blow was (damage / 60, clamped); scales particles and ragdoll impulse. */
  power: number;
  /** This hit put the victim down. */
  down: boolean;
  /** 0..1, blasts only (D-064): how hard the blast threw the body UP as well as away (a ragdoll flies with it). Absent: an ordinary blow. */
  lift?: number;
  /** D-103: the flames did it (no blood and no flinch: the fire on the body is the effect). Absent: an ordinary blow. */
  burn?: boolean;
  /** D-105: a coup de grace (the clients throw more blood and the body sprawls). Absent: an ordinary blow. */
  fin?: boolean;
}

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 5;

export function isValidJoinCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length !== JOIN_CODE_LENGTH) return false;
  for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

function isUnsafeCodePoint(cp: number): boolean {
  return (
    cp < 0x20 || // C0 controls
    (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 controls
    (cp >= 0x200b && cp <= 0x200f) || // zero-width + directional marks
    (cp >= 0x2028 && cp <= 0x202e) || // line/paragraph separators + bidi embeds/overrides
    (cp >= 0x2060 && cp <= 0x206f) || // invisible formatting
    cp === 0xfeff // BOM / zero-width no-break space
  );
}

/** Player-visible custom text is untrusted: strip invisible/control characters, collapse spaces, cap length. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "Nameless Fool";
  let out = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isUnsafeCodePoint(cp)) continue;
    out += ch;
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 20).join("") || "Nameless Fool";
}
