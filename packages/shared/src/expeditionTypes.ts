/**
 * Expedition contract (docs/_notes/expedition.md section 1, D-034). Types and constants only; frozen, append-only.
 * (Authored by package N because phase 0 had not landed: the integrator may replace this file with the full contract, provided every name here survives.)
 */
import type { FactionId } from "./campaignTypes.ts";
import { NPC } from "./campaignTypes.ts";
import type { CollisionWorld } from "./collision.ts";
import type { MoveCommand } from "./movement.ts";
import type { PlayerStateType } from "./schema.ts";
import type { WeaponId } from "./weapons.ts";

export type NpcSide = "ward" | "rival" | "outlaw" | "party" | "neutral";
/** Role -> side. Hostile by default: outlaw vs everyone; party vs ward only while the ward group is `alert`; ward vs rival only under `war`. */
export const NPC_SIDE: Readonly<Record<number, NpcSide>> = {
  [NPC.SENTRY]: "ward", [NPC.WARDEN]: "ward", [NPC.RIVAL_GUARD]: "rival", [NPC.RIVAL_SURVEYOR]: "rival", [NPC.DESERTER]: "outlaw",
  [NPC.HOSTAGE]: "neutral", [NPC.DRIVER]: "neutral", [NPC.PORTER]: "party", [NPC.HIRED_RIFLE]: "party", [NPC.SURGEON]: "party",
};
export type BrainId = "garrison" | "follower" | "civil";   // civil = hostage, driver: never fights, flees, follows when freed
export interface NpcSpec {
  id: string; role: number; faction: FactionId; side: NpcSide; group: string; post: { x: number; z: number }; weapon: WeaponId; lookSeed: number;
  look?: Record<string, number> /* authored CharacterSpec patch, run through specFromUntrusted */; name: string; skill: number; bravery: number; brain: BrainId;
}
export type CastOrder =
  | { o: "post" } | { o: "alert" } | { o: "stand_down" } | { o: "hold_fire" } | { o: "flee" } | { o: "march"; route: string }
  | { o: "guard"; x: number; z: number; r: number } | { o: "follow"; target: string } | { o: "attack"; side?: NpcSide };
export interface CastCount { alive: number; routed: number; down: number; total: number }
export type PlayersView = { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
export interface CastApi {
  spawn(specs: readonly NpcSpec[]): number; order(group: string, o: CastOrder): void; setWar(a: NpcSide, b: NpcSide, on: boolean): void; count(group: string): CastCount; row(id: string): PlayerStateType | undefined;
  defineRoute(name: string, pts: readonly { x: number; z: number }[]): void; noise(x: number, z: number, radius: number, src: string): void; despawn(group?: string): void; tick(dt: number): void; setWorld(w: CollisionWorld): void; atWar(roleA: number, roleB: number): boolean;
}
export interface NavPath { n: number; x: Float32Array; z: Float32Array; complete: boolean }   // NAV.pathMax = 48 waypoints, preallocated by the caller
export interface NavApi {
  open(x: number, z: number): boolean; los(ax: number, az: number, bx: number, bz: number): boolean; path(sx: number, sz: number, tx: number, tz: number, out: NavPath): boolean;
  cover(fx: number, fz: number, thx: number, thz: number, radius: number, out: { x: number; z: number }): boolean;
  flank(fx: number, fz: number, tx: number, tz: number, side: 1 | -1, dist: number, out: { x: number; z: number }): boolean;
  nearestOpen(x: number, z: number, out: { x: number; z: number }): boolean;
}
export const NAV = { cell: 2, clearance: 0.55, pathMax: 48, expansionCap: 2500, queriesPerTick: 2 } as const;
export type NpcMode = "post" | "alert" | "advance" | "fire" | "cover" | "flank" | "retreat" | "flee" | "stand_down" | "march" | "guard" | "follow" | "hold" | "fetch" | "tend" | "civil";
export type Intent = { k: "follow" } | { k: "hold"; x: number; z: number } | { k: "attack"; target: string } | { k: "fetch"; prop: string; to?: { x: number; z: number } } | { k: "retreat" };
export interface Morale { v: number /* 0..100 */; shock: number /* decaying fear impulse */ }
export interface NpcBrain {
  mode: NpcMode; since: number; morale: Morale; target: string; cooldown: number; react: number; burst: number; route: number; px: number; pz: number; weapon: number;
  intent?: Intent; path: NavPath; pathAt: number; hurtAt: number;
}
export interface NpcBody { x: number; z: number; facing: number; health: number; weapon: number; ammo: number; flags: number; vx: number; vz: number }
export interface NpcSenses {
  enemy?: { id: string; x: number; z: number; armed: boolean; moving: number; down: boolean }; allies: number; alliesDown: number; alert: boolean; standDown: boolean; fear: number; token: boolean;
  underFire: number /* 0..1 */; leader?: { id: string; x: number; z: number }; now: number; rain: number; nav: NavApi;
}
export type BrainFn = (b: NpcBrain, me: NpcBody, sn: NpcSenses, dt: number, out: MoveCommand) => void;   // Cast registers {garrison: N's npcThink, follower: L's followerThink}; `civil` is Cast's own two-liner

// ---- mounts, loadout, party (packages H and L) ----
export type MountKind = "horse" | "wagon";
export type MountPhase = 0 /* loose */ | 1 /* ridden */ | 2 /* led */ | 3 /* bolting */ | 4 /* wrecked */;
export interface MountApi {
  spawnWagon(at: { x: number; z: number; yaw: number }, o: { coat: number; crates: number; horse?: boolean }): string; lead(wagonId: string, leaderKey: string): void; route(wagonId: string, name: string): void;
  pos(id: string): { x: number; z: number } | undefined; wreck(id: string, burn: boolean): void; seize(id: string, by: string): number /* cargo pounds */; remove(id: string): void;
}
export interface Loadout { ammo: 0 | 1 | 2; medical: 0 | 1 | 2 | 3; provisions: 0 | 1 | 2 | 3; powder: 0 | 1 | 2 | 3; horses: 0 | 1 | 2; wagon: boolean }
export type FollowerKind = "porter" | "rifleman" | "surgeon";
export interface Follower { id: string; kind: FollowerKind; name: string; lookSeed: number; wage: number; bravery: number; loyalty: number; morale: number; wounded: number; owed: number }   // ints 0..100 except wage/owed (pounds)
export interface PartyState { v: 1; loadout: Loadout; roster: Follower[] /* <= FOLLOWER_CAP */; medical: number; provisions: number }
export type CommandId = "follow" | "hold" | "attack" | "fetch" | "retreat";
export interface CommandMsg { intent: CommandId; at?: { x: number; z: number }; target?: string; who?: number /* bitmask of roster indices; 0/absent = all */ }
