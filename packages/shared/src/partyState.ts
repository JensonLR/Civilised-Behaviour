import { FOLLOWER_CAP } from "./campaignTypes.ts";
import type { CommandId, CommandMsg, Follower, FollowerKind, Loadout, PartyState } from "./expeditionTypes.ts";
import { FOLLOWER_DEFS, isFollowerKind, newParty } from "./followers.ts";
import { normalizeLoadout } from "./loadout.ts";

/**
 * The party on the wire and the three hostile messages that touch it. `WorldState.party` is `serializeParty(...)` JSON (< 2 KB for four hands);
 * `parseParty` is the only reader. `parse*Msg` validate STRUCTURE only (type, finiteness, size): who may send, how far away, and whether a target
 * exists are the server's (`Followers`) to decide against the world. Nothing here throws.
 */

export const PARTY_JSON_MAX = 2048;
export const COMMAND_IDS: readonly CommandId[] = ["follow", "hold", "attack", "fetch", "retreat"];
export const commandIndex = (c: CommandId): number => COMMAND_IDS.indexOf(c);
/** `PlayerState.cmd` for a hand with no standing order. */
export const NO_COMMAND = 255;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const int = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, max) : "");

function parseFollower(raw: unknown): Follower | undefined {
  if (!isObj(raw)) return undefined;
  const kind = own(raw, "kind");
  if (!isFollowerKind(kind)) return undefined;
  const id = text(own(raw, "id"), 24);
  if (!/^[a-z0-9-]{3,24}$/.test(id)) return undefined;
  const name = text(own(raw, "name"), 32).trim();
  if (name.length === 0) return undefined;
  const d = FOLLOWER_DEFS[kind as FollowerKind];
  return {
    id, kind, name, lookSeed: int(own(raw, "lookSeed"), 0, 4294967295, 0), wage: int(own(raw, "wage"), 0, 99, d.wage), bravery: int(own(raw, "bravery"), 0, 100, d.bravery),
    loyalty: int(own(raw, "loyalty"), 0, 100, 50), morale: int(own(raw, "morale"), 0, 100, 70), wounded: int(own(raw, "wounded"), 0, 9, 0), owed: int(own(raw, "owed"), 0, 9999, 0),
  };
}

/** Hostile-safe: wrong version, non-objects, oversized text or duplicate ids give `undefined` or a trimmed party; every number is clamped; never throws. */
export function parseParty(json: unknown): PartyState | undefined {
  if (typeof json !== "string" || json.length === 0 || json.length > PARTY_JSON_MAX) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return undefined; }
  if (!isObj(raw) || own(raw, "v") !== 1) return undefined;
  const out = newParty();
  out.loadout = normalizeLoadout(own(raw, "loadout"));
  const r = own(raw, "roster");
  if (Array.isArray(r)) {
    const seen = new Set<string>();
    for (const x of r.slice(0, 16)) {
      const f = parseFollower(x);
      if (!f || seen.has(f.id) || out.roster.length >= FOLLOWER_CAP) continue;
      seen.add(f.id);
      out.roster.push(f);
    }
  }
  out.medical = int(own(raw, "medical"), 0, 99, 0);
  out.provisions = int(own(raw, "provisions"), 0, 99, 0);
  return out;
}

/** Fixed key order, so equal parties serialise to equal text (publish on change only). */
export function serializeParty(p: PartyState): string {
  return JSON.stringify({
    v: 1, loadout: { ammo: p.loadout.ammo, medical: p.loadout.medical, provisions: p.loadout.provisions, powder: p.loadout.powder, horses: p.loadout.horses, wagon: p.loadout.wagon },
    roster: p.roster.slice(0, FOLLOWER_CAP).map((f) => ({ id: f.id, kind: f.kind, name: f.name, lookSeed: f.lookSeed, wage: f.wage, bravery: f.bravery, loyalty: f.loyalty, morale: f.morale, wounded: f.wounded, owed: f.owed })),
    medical: p.medical, provisions: p.provisions,
  });
}

/** `loadoutSet` payload: `{loadout}`. Anything else gives undefined; the manifest inside is normalised, never trusted. */
export function parseLoadoutMsg(raw: unknown): Loadout | undefined {
  if (!isObj(raw)) return undefined;
  const l = own(raw, "loadout");
  return isObj(l) ? normalizeLoadout(l) : undefined;
}

/** `hire` payload: `{id: string, on: boolean}`. */
export function parseHireMsg(raw: unknown): { id: string; on: boolean } | undefined {
  if (!isObj(raw)) return undefined;
  const id = own(raw, "id");
  const on = own(raw, "on");
  if (typeof id !== "string" || !/^[a-z0-9-]{3,24}$/.test(id) || typeof on !== "boolean") return undefined;
  return { id, on };
}

/** Largest sane coordinate on any map (metres); the server also checks range from the sender and the region's bounds. */
const COORD_MAX = 2000;

/** `command` payload. `who` is a bitmask of roster indices (0 or absent = all); bits beyond the cap are stripped, a forged huge value is simply masked. */
export function parseCommandMsg(raw: unknown): CommandMsg | undefined {
  if (!isObj(raw)) return undefined;
  const intent = own(raw, "intent");
  if (typeof intent !== "string" || !(COMMAND_IDS as readonly string[]).includes(intent)) return undefined;
  const msg: CommandMsg = { intent: intent as CommandId };
  const at = own(raw, "at");
  if (at !== undefined) {
    if (!isObj(at)) return undefined;
    const x = own(at, "x");
    const z = own(at, "z");
    if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > COORD_MAX || Math.abs(z) > COORD_MAX) return undefined;
    msg.at = { x, z };
  }
  const target = own(raw, "target");
  if (target !== undefined) {
    if (typeof target !== "string" || target.length === 0 || target.length > 48) return undefined;
    msg.target = target;
  }
  const who = own(raw, "who");
  if (who !== undefined) {
    if (typeof who !== "number" || !Number.isFinite(who) || who < 0) return undefined;
    // bits that name nobody are stripped; a mask that names only nobody is a forgery, not "everyone"
    const w = Math.floor(who);
    const m = w > 0xffff ? 0 : w & ((1 << FOLLOWER_CAP) - 1);
    if (w !== 0 && m === 0) return undefined;
    msg.who = m;
  }
  return msg;
}
