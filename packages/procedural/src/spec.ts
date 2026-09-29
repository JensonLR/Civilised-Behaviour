import { Rng } from "@cb/shared";
import * as C from "./catalog.ts";

/**
 * A character is a flat record of small integers so it packs into a fixed byte string, is trivially
 * validated (clamp each field to its range) and can be diffed/merged by the campaign later
 * (scars, teeth, medals are ordinary fields that events can change).
 */
export interface FieldDef {
  key: string;
  /** Inclusive maximum value. Sliders use 255. */
  max: number;
  label: string;
  group: "body" | "face" | "clothes" | "colour" | "history";
  /** UI hint: slider for continuous fields, choice for catalog fields. */
  kind: "slider" | "choice" | "flags";
  /** Option names for choice fields. */
  options?: readonly string[];
}

// Generic over the key so FieldKey stays a union of literals (CharacterSpec would collapse to an index type otherwise).
const slider = <K extends string>(key: K, label: string, group: FieldDef["group"] = "body") =>
  ({ key, max: 255, label, group, kind: "slider" }) as const satisfies FieldDef;
const choice = <K extends string>(key: K, label: string, options: readonly string[], group: FieldDef["group"]) =>
  ({ key, max: options.length - 1, label, group, kind: "choice", options }) as const satisfies FieldDef;
const colour = <K extends string>(key: K, label: string, n: number) =>
  ({ key, max: n - 1, label, group: "colour", kind: "choice" }) as const satisfies FieldDef;

/** ORDER IS THE WIRE FORMAT. Append only. */
export const FIELDS = [
  slider("height", "Height"),
  slider("headScale", "Head size"),
  slider("torsoWidth", "Torso width"),
  slider("torsoDepth", "Torso depth"),
  slider("belly", "Belly"),
  slider("shoulderWidth", "Shoulders"),
  slider("armLength", "Arm length"),
  slider("legLength", "Leg length"),
  slider("handScale", "Hands"),
  slider("footScale", "Feet"),
  slider("noseScale", "Nose size", "face"),
  slider("earScale", "Ears", "face"),
  slider("jaw", "Jaw", "face"),
  slider("posture", "Posture"),
  choice("noseStyle", "Nose", C.NOSE_STYLES, "face"),
  choice("hair", "Hair", C.HAIR_STYLES, "face"),
  choice("moustache", "Moustache", C.MOUSTACHES, "face"),
  choice("beard", "Beard", C.BEARDS, "face"),
  choice("sideburns", "Sideburns", C.SIDEBURNS, "face"),
  choice("hat", "Headwear", C.HATS, "clothes"),
  choice("jacket", "Jacket", C.JACKETS, "clothes"),
  choice("shirt", "Shirt", C.SHIRTS, "clothes"),
  choice("trousers", "Trousers", C.TROUSERS, "clothes"),
  choice("boots", "Boots", C.BOOTS, "clothes"),
  choice("belt", "Belt", C.BELTS, "clothes"),
  choice("eyewear", "Eyewear", C.EYEWEAR, "face"),
  choice("sash", "Sash", C.SASHES, "clothes"),
  { key: "medals", max: 5, label: "Medals", group: "clothes", kind: "choice", options: ["0", "1", "2", "3", "4", "5"] } as const,
  colour("skin", "Skin", C.SKIN_TONES.length),
  colour("hairColor", "Hair colour", C.HAIR_COLORS.length),
  colour("jacketColor", "Jacket colour", C.CLOTH_COLORS.length),
  colour("trousersColor", "Trouser colour", C.CLOTH_COLORS.length),
  colour("hatColor", "Hat colour", C.CLOTH_COLORS.length),
  colour("accentColor", "Metalwork", C.ACCENT_COLORS.length),
  { key: "scars", max: 31, label: "Scars", group: "history", kind: "flags" } as const,
  { key: "teeth", max: 15, label: "Teeth", group: "history", kind: "flags" } as const,
  choice("eyepatch", "Eyepatch", C.EYEPATCH, "history"),
  { key: "burnt", max: 3, label: "Singed clothing", group: "history", kind: "choice", options: ["None", "Scorched", "Charred", "Ruined"] } as const,
  choice("woodenLeg", "Wooden leg", C.WOODEN_LEG, "history"),
] as const;

/** Colour palettes for the colour fields (UI swatches). */
export const PALETTES: Partial<Record<string, readonly number[]>> = {
  skin: C.SKIN_TONES,
  hairColor: C.HAIR_COLORS,
  jacketColor: C.CLOTH_COLORS,
  trousersColor: C.CLOTH_COLORS,
  hatColor: C.CLOTH_COLORS,
  accentColor: C.ACCENT_COLORS,
};

export type FieldKey = (typeof FIELDS)[number]["key"];
export type CharacterSpec = { [K in FieldKey]: number };

export const SPEC_VERSION = 1;
export const SPEC_BYTES = 1 + FIELDS.length;

const FIELD_INDEX: Record<string, number> = Object.fromEntries(FIELDS.map((f, i) => [f.key, i]));
export const fieldDef = (key: FieldKey): FieldDef => FIELDS[FIELD_INDEX[key] as number] as FieldDef;
export const FIELD_KEYS: readonly FieldKey[] = FIELDS.map((f) => f.key);

const clampInt = (v: unknown, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return n < 0 ? 0 : n > max ? max : n;
};

/** Forces any object into a valid spec: unknown keys dropped, missing/NaN -> 0, everything clamped. */
export function sanitizeSpec(input: unknown): CharacterSpec {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out = {} as Record<string, number>;
  for (const f of FIELDS) out[f.key] = clampInt(src[f.key], f.max);
  return out as CharacterSpec;
}

export function defaultSpec(): CharacterSpec {
  return generateCharacter(1);
}

// ---- codec ------------------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

function b64ToBytes(s: string): Uint8Array | undefined {
  const vals: number[] = [];
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return undefined;
    vals.push(v);
  }
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const [a, b, c, d] = [vals[i] as number, vals[i + 1] ?? 0, vals[i + 2], vals[i + 3]];
    out.push((a << 2) | (b >> 4));
    if (c !== undefined) out.push(((b & 15) << 4) | (c >> 2));
    if (d !== undefined && c !== undefined) out.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(out);
}

/** Compact, URL/JSON-safe string form (~54 chars). Stable: same spec -> same string. */
export function encodeSpec(spec: CharacterSpec): string {
  const bytes = new Uint8Array(SPEC_BYTES);
  bytes[0] = SPEC_VERSION;
  FIELDS.forEach((f, i) => (bytes[i + 1] = clampInt(spec[f.key], f.max)));
  return bytesToB64(bytes);
}

/**
 * Decodes untrusted input. Returns undefined for anything malformed (wrong type/length/version/alphabet);
 * valid-shaped input with out-of-range values is clamped rather than rejected.
 */
export function decodeSpec(s: unknown): CharacterSpec | undefined {
  if (typeof s !== "string" || s.length > 128) return undefined;
  const bytes = b64ToBytes(s);
  if (!bytes || bytes.length < SPEC_BYTES || bytes[0] !== SPEC_VERSION) return undefined;
  const out = {} as Record<string, number>;
  FIELDS.forEach((f, i) => (out[f.key] = clampInt(bytes[i + 1], f.max)));
  return out as CharacterSpec;
}

/** Decode-or-fallback used by the server: never throws, always returns a valid canonical spec. */
export function specFromUntrusted(s: unknown, fallbackSeed: number): CharacterSpec {
  return decodeSpec(s) ?? generateCharacter(fallbackSeed);
}

// ---- generation ---------------------------------------------------------------------------------------

interface Archetype {
  name: string;
  /** Slider targets 0..255 (jittered), keyed by body field. */
  body: Partial<Record<FieldKey, number>>;
  hats: number[];
  moustaches: number[];
  jackets: number[];
}

/**
 * Archetypes keep random characters *coherent silhouettes* rather than uniform noise: each is a
 * recognisable caricature at gameplay distance (big-bellied colonel, lanky surveyor, ...).
 */
export const ARCHETYPES: readonly Archetype[] = [
  { name: "Portly Colonel", body: { height: 120, headScale: 170, torsoWidth: 220, torsoDepth: 210, belly: 250, shoulderWidth: 150, armLength: 90, legLength: 40, handScale: 150, footScale: 200, noseScale: 190 }, hats: [5, 4, 3], moustaches: [1, 2, 7], jackets: [2, 4, 1] },
  { name: "Lanky Surveyor", body: { height: 250, headScale: 90, torsoWidth: 60, torsoDepth: 70, belly: 30, shoulderWidth: 80, armLength: 230, legLength: 250, handScale: 170, footScale: 180, noseScale: 200 }, hats: [3, 6, 2], moustaches: [3, 4, 0], jackets: [5, 3, 0] },
  { name: "Stout Sergeant", body: { height: 100, headScale: 130, torsoWidth: 230, torsoDepth: 190, belly: 170, shoulderWidth: 230, armLength: 110, legLength: 60, handScale: 210, footScale: 210, noseScale: 120 }, hats: [7, 4, 2], moustaches: [2, 6, 4], jackets: [2, 4] },
  { name: "Dainty Aristocrat", body: { height: 170, headScale: 200, torsoWidth: 90, torsoDepth: 80, belly: 60, shoulderWidth: 70, armLength: 150, legLength: 200, handScale: 60, footScale: 70, noseScale: 230 }, hats: [1, 2, 5], moustaches: [3, 5, 0], jackets: [1, 3] },
  { name: "Wiry Scout", body: { height: 150, headScale: 110, torsoWidth: 80, torsoDepth: 90, belly: 20, shoulderWidth: 120, armLength: 190, legLength: 170, handScale: 200, footScale: 130, noseScale: 90 }, hats: [6, 2, 0], moustaches: [4, 0, 3], jackets: [5, 0, 3] },
  { name: "Enormous Clerk", body: { height: 190, headScale: 240, torsoWidth: 200, torsoDepth: 240, belly: 210, shoulderWidth: 60, armLength: 60, legLength: 70, handScale: 90, footScale: 110, noseScale: 110 }, hats: [2, 1, 0], moustaches: [0, 3, 7], jackets: [3, 1] },
];

/** Deterministic character from a seed: same seed, same person, forever (safe for NPCs and previews). */
export function generateCharacter(seed: number, archetype?: number): CharacterSpec {
  const rng = new Rng(seed ^ 0x6d2b79f5);
  const a = ARCHETYPES[archetype ?? rng.int(0, ARCHETYPES.length - 1)] as Archetype;
  const spec = {} as Record<string, number>;
  for (const f of FIELDS) {
    if (f.kind === "slider") {
      const base = a.body[f.key as FieldKey];
      spec[f.key] = base === undefined ? rng.int(40, 215) : clampInt(base + rng.range(-28, 28), 255);
    } else {
      spec[f.key] = rng.int(0, f.max);
    }
  }
  spec.hat = rng.pick(a.hats);
  spec.moustache = rng.pick(a.moustaches);
  spec.jacket = rng.pick(a.jackets);
  // Sensible defaults for history: fresh recruits are unmarked; the campaign adds these.
  spec.scars = 0;
  spec.teeth = 0;
  spec.eyepatch = 0;
  spec.burnt = 0;
  spec.woodenLeg = 0;
  spec.medals = rng.chance(0.5) ? rng.int(0, 3) : 0;
  spec.posture = clampInt(rng.range(70, 200), 255);
  // Avoid clashing hat/jacket colours by construction: hat and jacket palette indices differ.
  if (spec.hatColor === spec.jacketColor) spec.hatColor = ((spec.hatColor as number) + 5) % C.CLOTH_COLORS.length;
  if (spec.trousersColor === spec.jacketColor) spec.trousersColor = ((spec.trousersColor as number) + 3) % C.CLOTH_COLORS.length;
  return sanitizeSpec(spec);
}

/**
 * Fields the CAMPAIGN owns (they record what happened to the character). Clients may never set them:
 * otherwise anyone could claim a veteran's scars or a wooden leg. The server keeps its own copy.
 */
export const HISTORY_KEYS = ["scars", "teeth", "eyepatch", "burnt", "woodenLeg"] as const satisfies readonly FieldKey[];

/** Applies a client-submitted look on top of the server's record: appearance from the client, history from the server. */
export function applyClientAppearance(current: CharacterSpec, incoming: CharacterSpec): CharacterSpec {
  const out = { ...incoming };
  for (const k of HISTORY_KEYS) out[k] = current[k];
  return out;
}

/** Randomise while keeping campaign history (scars, teeth...) intact: used by the creator's dice button. */
export function rerollAppearance(spec: CharacterSpec, seed: number): CharacterSpec {
  const fresh = generateCharacter(seed);
  return { ...fresh, scars: spec.scars, teeth: spec.teeth, eyepatch: spec.eyepatch, burnt: spec.burnt, woodenLeg: spec.woodenLeg };
}
