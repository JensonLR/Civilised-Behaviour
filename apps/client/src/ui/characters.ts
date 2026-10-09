import { decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { cleanName } from "./expeditions.ts";

/**
 * D-102: the characters THIS DEVICE keeps (`cb.characters`): a name and a look each, one of them chosen. The owner: "profile persistence so people can keep their characters &
 * campaign saves ... some may have multiple game saves with different groups of people". Before, a browser held one look (`cb.look`) and one name (`cb.name`); a second
 * character overwrote the first. Each saved expedition remembers which character played it (expeditions.ts `who`), so resuming one brings its character back.
 *
 * Kept on the device only, like the expeditions list (docs/PRIVACY_DATA_MAP.md): the server sees a name and a look only as the player sends them on joining, as before.
 * Pure functions over plain values (tested as tables, hostile storage included), then thin storage wrappers. Every read validates and never throws; every write is guarded.
 * `cb.name` and `cb.look` are kept in step with the chosen character, so anything that still reads them sees the right one.
 */

export const CHARACTERS_KEY = "cb.characters";
export const CHARACTERS_VERSION = 1;
export const MAX_CHARACTERS = 8;
const MAX_RAW_CHARS = 16_384;
const LOOK_MAX = 256;

export interface Character {
  /** A short random id (the expeditions list points at it). */
  readonly id: string;
  readonly name: string;
  /** The encoded look (procedural `encodeSpec`). */
  readonly look: string;
}

export interface Roster {
  /** The chosen character's id (always one of `list`). */
  readonly current: string;
  /** In the order they were made; never empty. */
  readonly list: readonly Character[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_RE = /^[a-z0-9]{6,12}$/;

/** A look that decodes (anything else is dropped: a character is never drawn from a value the game cannot read). */
export const isLook = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= LOOK_MAX && decodeSpec(v) !== undefined;

/** A fresh id: eight lowercase letters and digits. */
export function newCharacterId(rand: () => number = Math.random): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(rand() * a.length) % a.length];
  return s;
}

/** A new character with a random look (the creator then dresses it). */
export const freshCharacter = (name = "", rand: () => number = Math.random): Character => ({
  id: newCharacterId(rand),
  name: cleanName(name),
  look: encodeSpec(generateCharacter(Math.floor(rand() * 1e9))),
});

function parseOne(v: unknown): Character | undefined {
  if (!isObj(v) || typeof v.id !== "string" || !ID_RE.test(v.id) || !isLook(v.look)) return undefined;
  return { id: v.id, name: cleanName(v.name), look: v.look };
}

/** A list of characters from anywhere (storage, a profile code): bad entries dropped alone, duplicates by id dropped, capped. */
export function parseCharacters(v: unknown): Character[] {
  if (!Array.isArray(v)) return [];
  const out: Character[] = [];
  const seen = new Set<string>();
  for (const item of v.slice(0, MAX_CHARACTERS * 4)) {
    const c = parseOne(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= MAX_CHARACTERS) break;
  }
  return out;
}

/** A stored roster, read back; undefined when there is none worth keeping (the caller then makes one). Never throws. */
export function parseRoster(raw: unknown): Roster | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_CHARS) return undefined;
  try {
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || j.v !== CHARACTERS_VERSION) return undefined;
    const list = parseCharacters(j.list);
    if (list.length === 0) return undefined;
    const current = typeof j.current === "string" && list.some((c) => c.id === j.current) ? j.current : list[0]!.id;
    return { current, list };
  } catch {
    return undefined;
  }
}

export const serializeRoster = (r: Roster): string => JSON.stringify({ v: CHARACTERS_VERSION, current: r.current, list: r.list.map((c) => ({ id: c.id, name: c.name, look: c.look })) });

export const currentCharacter = (r: Roster): Character => r.list.find((c) => c.id === r.current) ?? r.list[0]!;

/** Chooses a character (an unknown id changes nothing). */
export const selectCharacter = (r: Roster, id: string): Roster => (r.list.some((c) => c.id === id) ? { ...r, current: id } : r);

/** Adds a character and chooses it; at the cap the roster is returned unchanged. */
export const addCharacter = (r: Roster, c: Character): Roster =>
  r.list.length >= MAX_CHARACTERS || r.list.some((x) => x.id === c.id) ? r : { current: c.id, list: [...r.list, c] };

/** Changes a character's name or look (cleaned and checked as on reading). */
export function updateCharacter(r: Roster, id: string, patch: { name?: string; look?: string }): Roster {
  return {
    ...r,
    list: r.list.map((c) => (c.id !== id ? c : { ...c, ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}), ...(patch.look !== undefined && isLook(patch.look) ? { look: patch.look } : {}) })),
  };
}

/** Removes a character; the last one is never removed (there is always somebody to play). The choice moves to the first left. */
export function removeCharacter(r: Roster, id: string): Roster {
  if (r.list.length <= 1 || !r.list.some((c) => c.id === id)) return r;
  const list = r.list.filter((c) => c.id !== id);
  return { current: r.current === id ? list[0]!.id : r.current, list };
}

/** Adds characters from elsewhere (a profile code), keeping ours on a clash of ids; up to the cap. */
export function mergeCharacters(r: Roster, incoming: readonly Character[]): Roster {
  let out = r;
  for (const c of incoming) if (!out.list.some((x) => x.id === c.id)) out = { ...addCharacter(out, c), current: out.current };
  return out;
}

// ---- storage ----------------------------------------------------------------------------------------------------------------------------------

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the roster lives for this page only */
  }
}

/**
 * The device's roster. A first visit (or a browser from before D-102) makes one character from what was kept: the old single name and look, or a random look.
 */
export function loadRoster(rand: () => number = Math.random): Roster {
  const stored = parseRoster(read(CHARACTERS_KEY));
  if (stored) return stored;
  const oldLook = read("cb.look");
  const first: Character = { id: newCharacterId(rand), name: cleanName(read("cb.name") ?? ""), look: isLook(oldLook) ? oldLook : freshCharacter("", rand).look };
  const r: Roster = { current: first.id, list: [first] };
  saveRoster(r);
  return r;
}

/** Keeps the roster, and the old single-character keys in step with the chosen one. */
export function saveRoster(r: Roster): void {
  write(CHARACTERS_KEY, serializeRoster(r));
  const c = currentCharacter(r);
  write("cb.look", c.look);
  write("cb.name", c.name);
}
