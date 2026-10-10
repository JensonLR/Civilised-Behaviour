import { currentCharacter, loadRoster, mergeCharacters, parseCharacters, saveRoster, type Character, type Roster } from "./characters.ts";
import { listExpeditions, mergeExpeditions, parseExpeditionList, replaceExpeditions, type Expedition } from "./expeditions.ts";

/**
 * D-102, the profile code: everything this device keeps of a player in one line of text, to keep somewhere safe or to carry to another device. The owner asked for "profile
 * persistence so people can keep their characters & campaign saves"; the saves are on the server, but what lets a device resume them lives in the browser, which can lose it (a
 * cleared cache, a phone's browser tidying storage after a week away, a new machine). There are no accounts (D-039 rejected them), so the code is the backup.
 *
 * It holds the device's anonymous identity (`cb.identity`, the membership credential: whoever has the code can resume those expeditions, and the sheet says so), the characters
 * (names and looks) and the expeditions list. Nothing is sent anywhere: the player copies it, the player pastes it. Restoring checks every field as storage reading does.
 *
 * A device has one identity. Restoring a code with another identity onto a device that has expeditions of its own would leave those unable to resume here, so that needs a second
 * press, and the sheet says to copy this device's code first.
 */

export const PROFILE_PREFIX = "CB1-";
const PROFILE_VERSION = 1;
const MAX_CODE_CHARS = 64_000;
const IDENTITY_KEY = "cb.identity";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Profile {
  /** The anonymous identity (absent on a device that never played). */
  readonly identity?: string;
  readonly characters: readonly Character[];
  readonly expeditions: readonly Expedition[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isIdentity = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID_V4.test(v);

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(code)) return undefined;
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (code.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function encodeProfile(p: Profile): string {
  const body = { v: PROFILE_VERSION, ...(p.identity ? { i: p.identity.toLowerCase() } : {}), c: p.characters, e: p.expeditions };
  return PROFILE_PREFIX + toBase64Url(JSON.stringify(body));
}

/** A pasted code, read back (spaces and line breaks from a notes app are ignored). Undefined for anything that is not a profile code. Never throws. */
export function decodeProfile(text: unknown, now: number = Date.now()): Profile | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.replace(/\s+/g, "");
  if (!t.startsWith(PROFILE_PREFIX) || t.length > MAX_CODE_CHARS) return undefined;
  const json = fromBase64Url(t.slice(PROFILE_PREFIX.length));
  if (json === undefined) return undefined;
  try {
    const j: unknown = JSON.parse(json);
    if (!isObj(j) || j.v !== PROFILE_VERSION) return undefined;
    const identity = isIdentity(j.i) ? j.i.toLowerCase() : undefined;
    const characters = parseCharacters(j.c);
    const expeditions = parseExpeditionList(j.e, now);
    if (!identity && characters.length === 0) return undefined;
    return { ...(identity ? { identity } : {}), characters, expeditions };
  } catch {
    return undefined;
  }
}

export interface DeviceProfile {
  readonly identity: string | null;
  readonly roster: Roster;
  readonly list: readonly Expedition[];
}

export type RestorePlan =
  | { readonly kind: "restore"; readonly identity: string | null; readonly roster: Roster; readonly list: Expedition[]; readonly characters: number; readonly expeditions: number }
  /** The code carries other papers and this device has expeditions of its own: a second press replaces them. */
  | { readonly kind: "papers"; readonly own: number };

/**
 * What restoring a profile onto this device comes to. Same papers (or none here, or nothing played here): everything is added, ours kept on a clash. Other papers over a device
 * with its own expeditions: refused until `replace`, then the code's papers and list take over (this device's own could not be resumed with them). Characters are always added.
 */
export function planRestore(here: DeviceProfile, code: Profile, replace: boolean): RestorePlan {
  const same = !code.identity || !here.identity || code.identity === here.identity.toLowerCase() || here.list.length === 0;
  if (!same && !replace) return { kind: "papers", own: here.list.length };
  // (a device that never played holds one unnamed character with a random look: the code's characters take its place rather than sit beside it)
  const blank = here.roster.list.length === 1 && !currentCharacter(here.roster).name && here.list.length === 0 && code.characters.length > 0;
  const roster: Roster = blank ? { current: code.characters[0]!.id, list: [...code.characters] } : mergeCharacters(here.roster, code.characters);
  const list = same ? mergeExpeditions(here.list, code.expeditions) : mergeExpeditions([], code.expeditions);
  const had = new Set(same ? here.list.map((e) => e.code) : []);
  return {
    kind: "restore",
    identity: code.identity ?? here.identity,
    roster,
    list,
    characters: blank ? roster.list.length : roster.list.length - here.roster.list.length,
    expeditions: list.filter((e) => !had.has(e.code)).length,
  };
}

// ---- storage ------------------------------------------------------------------------------------------------------------------------------------

function readIdentity(): string | null {
  try {
    const t = localStorage.getItem(IDENTITY_KEY);
    return isIdentity(t) ? t : null;
  } catch {
    return null;
  }
}

/** This device's profile code (the identity, the characters and the expeditions as they stand). */
export function myProfileCode(): string {
  const identity = readIdentity();
  return encodeProfile({ ...(identity ? { identity } : {}), characters: loadRoster().list, expeditions: listExpeditions() });
}

/** Restores a pasted code here: "bad" for something that is not a code, the plan's "papers" to ask again, or what was added. Writes only on a restore. */
export function restoreProfileCode(text: string, replace: boolean): RestorePlan | { readonly kind: "bad" } {
  const code = decodeProfile(text);
  if (!code) return { kind: "bad" };
  const plan = planRestore({ identity: readIdentity(), roster: loadRoster(), list: listExpeditions() }, code, replace);
  if (plan.kind !== "restore") return plan;
  try {
    if (plan.identity) localStorage.setItem(IDENTITY_KEY, plan.identity);
  } catch {
    /* storage blocked: nothing here survives the page anyway */
  }
  saveRoster(plan.roster);
  replaceExpeditions(plan.list);
  return plan;
}
