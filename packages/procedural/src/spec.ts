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
  { key: "scars", max: 255, label: "Scars", group: "history", kind: "flags" } as const,
  { key: "teeth", max: 63, label: "Teeth", group: "history", kind: "flags" } as const,
  choice("eyepatch", "Eyepatch", C.EYEPATCH, "history"),
  { key: "burnt", max: 3, label: "Singed clothing", group: "history", kind: "choice", options: ["None", "Scorched", "Charred", "Ruined"] } as const,
  choice("woodenLeg", "Wooden leg", C.WOODEN_LEG, "history"),
  // Added after the first release of the wire format: old looks decode with these at 0 ("None").
  choice("neckwear", "Neckwear", C.NECKWEAR, "clothes"),
  choice("pack", "Pack", C.PACKS, "clothes"),
  choice("hipGear", "Hip gear", C.HIP_GEAR, "clothes"),
  choice("gloves", "Gloves", C.GLOVES, "clothes"),
  // ---- batch 2 (starts at index 43): faces, complexion, jewellery, decorations, trims, prosthetics ----
  choice("brows", "Eyebrows", C.BROWS, "face"),
  choice("eyeShape", "Eye shape", C.EYE_SHAPES, "face"),
  choice("eyeColor", "Eye colour", C.EYE_COLORS, "face"),
  choice("earShape", "Ear shape", C.EAR_SHAPES, "face"),
  choice("stubble", "Stubble", C.STUBBLE, "face"),
  choice("greying", "Greying", C.GREYING, "face"),
  slider("age", "Age lines", "face"),
  choice("complexion", "Complexion", C.COMPLEXION, "face"),
  choice("mark", "Skin mark", C.MARKS, "face"),
  choice("facePaint", "Face paint", C.FACE_PAINT, "face"),
  choice("tattoo", "Tattoo", C.TATTOOS, "face"),
  choice("earring", "Earring", C.EARRINGS, "face"),
  choice("ring", "Ring", C.RINGS, "clothes"),
  choice("epaulettes", "Epaulettes", C.EPAULETTES, "clothes"),
  choice("decoration", "Decoration", C.DECORATIONS, "clothes"),
  choice("coatTrim", "Coat trim", C.COAT_TRIMS, "clothes"),
  choice("trouserTrim", "Trouser detail", C.TROUSER_TRIMS, "clothes"),
  colour("shirtColor", "Shirt colour", C.SHIRT_COLORS.length),
  colour("bootColor", "Leather", C.LEATHER_COLORS.length),
  choice("hatTrim", "Hat trim", C.HAT_TRIMS, "clothes"),
  choice("hook", "Hook hand", C.HOOKS, "history"),
  // ---- batch 3 (starts at index 64): fine cosmetics ----
  choice("medalStyle", "Medal style", C.MEDAL_STYLES, "clothes"),
  choice("buckle", "Belt buckle", C.BUCKLES, "clothes"),
  choice("cuffDetail", "Cuff detail", C.CUFF_DETAILS, "clothes"),
  choice("laces", "Boot fastening", C.BOOT_LACES, "clothes"),
  choice("pocket", "Pockets", C.POCKETS, "clothes"),
  choice("hairAcc", "Hair accessory", C.HAIR_ACCESSORIES, "face"),
  choice("patchStyle", "Eyepatch style", C.EYEPATCH_STYLES, "history"),
  choice("scarStyle", "Scar style", C.SCAR_STYLES, "history"),
] as const;

/** How many fields the wire format had before the append-only additions; shorter strings from older saves still decode. */
export const LEGACY_FIELD_COUNT = 39;

/**
 * Append batches. Each batch draws its random values from its OWN stream, so adding a batch never changes who an existing seed is.
 * Fields before `LEGACY_FIELD_COUNT` use the main stream; batch 1 (neckwear ... gloves) has its stream since it was added first, batch 2 got its own.
 * To add fields: append to FIELDS, append a batch here with a new random salt (never reuse or reorder), and give the new fields odds in EXTRA_ODDS.
 */
export const FIELD_BATCHES: readonly { start: number; salt: number }[] = [
  { start: LEGACY_FIELD_COUNT, salt: 0x51ed270b },
  { start: 43, salt: 0x7f4a7c15 },
  { start: 64, salt: 0x3c1e9b47 },
];

/**
 * How many options each choice field had before later releases appended more. Generation draws from THIS range (so the random stream and the
 * result for old seeds are unchanged) and the newer options reach generated characters through the novelty stream below.
 */
const FROZEN_OPTIONS: Readonly<Record<string, number>> = {
  noseStyle: 6, hair: 10, moustache: 10, beard: 8, sideburns: 4, hat: 11, jacket: 6, shirt: 4, trousers: 4, boots: 4, belt: 3, eyewear: 5, sash: 3,
  neckwear: 4, pack: 5, hipGear: 5, gloves: 3,
};
/**
 * Where the NATIVE-PEOPLES options start in each list (D-038): `applyPeople` draws them for the fictional peoples; the generic generator (the Society's folk, the creator's dice) never
 * does, so adding them changed nobody who already existed.
 */
export const NATIVE_FROM: Readonly<Record<string, number>> = { hat: 21, jacket: 11, neckwear: 9, facePaint: 7, hair: 17, hairAcc: 6, hipGear: 10, boots: 9 };
/** Chance that a generated character picks one of the options appended later, per field. */
const NOVELTY_ODDS: Readonly<Record<string, number>> = { hat: 0.34, hair: 0.34, jacket: 0.3, moustache: 0.25, beard: 0.25, boots: 0.3, eyewear: 0.3, trousers: 0.25 };
/** Chance that a batch field is set at all (default 0.4). Rare vanity (tattoos, face paint) stays rare so a crowd reads as a crowd. */
const EXTRA_ODDS: Readonly<Record<string, number>> = {
  eyeColor: 0.5, earShape: 0.25, stubble: 0.5, greying: 0.3, complexion: 0.5, mark: 0.14, facePaint: 0.06, tattoo: 0.1, earring: 0.13, ring: 0.16,
  epaulettes: 0.18, decoration: 0.22, coatTrim: 0.3, trouserTrim: 0.3, shirtColor: 0.45, bootColor: 0.6, hatTrim: 0.28, hook: 0, brows: 0.6, eyeShape: 0.6,
  medalStyle: 0.5, buckle: 0.4, cuffDetail: 0.3, laces: 0.35, pocket: 0.35, hairAcc: 0.1, patchStyle: 0, scarStyle: 0,
};

/** Colour palettes for the colour fields (UI swatches). */
export const PALETTES: Partial<Record<string, readonly number[]>> = {
  skin: C.SKIN_TONES,
  hairColor: C.HAIR_COLORS,
  jacketColor: C.CLOTH_COLORS,
  trousersColor: C.CLOTH_COLORS,
  hatColor: C.CLOTH_COLORS,
  accentColor: C.ACCENT_COLORS,
  shirtColor: C.SHIRT_COLORS,
  bootColor: C.LEATHER_COLORS,
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
  if (!bytes || bytes.length < 1 + LEGACY_FIELD_COUNT || bytes[0] !== SPEC_VERSION) return undefined;
  const out = {} as Record<string, number>;
  FIELDS.forEach((f, i) => (out[f.key] = clampInt(bytes[i + 1], f.max))); // (missing trailing bytes clamp to 0)
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
  // Fields added later draw from their own streams (one per batch) so old seeds keep their people.
  const streams = FIELD_BATCHES.map((b) => new Rng(seed ^ b.salt));
  FIELDS.forEach((f, i) => {
    if (i >= LEGACY_FIELD_COUNT) {
      let batch = 0;
      FIELD_BATCHES.forEach((b, k) => i >= b.start && (batch = k));
      const st = streams[batch] as Rng;
      const frozen = FROZEN_OPTIONS[f.key];
      const nativeFrom = NATIVE_FROM[f.key];
      const max = frozen !== undefined ? frozen - 1 : nativeFrom !== undefined ? nativeFrom - 1 : f.max;
      if (batch === 0) spec[f.key] = st.chance(0.55) ? 0 : st.int(1, max); // batch 1 keeps its original odds
      else if (f.key === "age") spec[f.key] = st.chance(EXTRA_ODDS[f.key] ?? 0.6) ? st.int(40, 230) : st.int(0, 60);
      else spec[f.key] = st.chance(EXTRA_ODDS[f.key] ?? 0.4) ? st.int(1, max) : 0;
      return;
    }
    if (f.kind === "slider") {
      const base = a.body[f.key as FieldKey];
      spec[f.key] = base === undefined ? rng.int(40, 215) : clampInt(base + rng.range(-28, 28), 255);
    } else {
      spec[f.key] = rng.int(0, FROZEN_OPTIONS[f.key] !== undefined ? FROZEN_OPTIONS[f.key]! - 1 : f.max);
    }
  });
  spec.hat = rng.pick(a.hats);
  spec.moustache = rng.pick(a.moustaches);
  spec.jacket = rng.pick(a.jackets);
  // Sensible defaults for history: fresh recruits are unmarked; the campaign adds these.
  spec.scars = 0;
  spec.teeth = 0;
  spec.eyepatch = 0;
  spec.burnt = 0;
  spec.woodenLeg = 0;
  spec.hook = 0;
  spec.patchStyle = 0;
  spec.scarStyle = 0;
  spec.medals = rng.chance(0.5) ? rng.int(0, 3) : 0;
  spec.posture = clampInt(rng.range(70, 200), 255);
  // Avoid clashing hat/jacket colours by construction: hat and jacket palette indices differ.
  if (spec.hatColor === spec.jacketColor) spec.hatColor = ((spec.hatColor as number) + 5) % C.CLOTH_COLORS.length;
  if (spec.trousersColor === spec.jacketColor) spec.trousersColor = ((spec.trousersColor as number) + 3) % C.CLOTH_COLORS.length;
  // Options appended after the first release reach generated people through their own stream (a fraction of characters get one).
  const novelty = new Rng(seed ^ 0x2545f491);
  for (const f of FIELDS) {
    const frozen = FROZEN_OPTIONS[f.key];
    if (frozen === undefined || f.max < frozen) continue;
    if (novelty.chance(NOVELTY_ODDS[f.key] ?? 0.2)) spec[f.key] = novelty.int(frozen, (NATIVE_FROM[f.key] ?? f.max + 1) - 1);
  }
  return sanitizeSpec(spec);
}

/**
 * Fields the CAMPAIGN owns (they record what happened to the character). Clients may never set them:
 * otherwise anyone could claim a veteran's scars or a wooden leg. The server keeps its own copy.
 */
export const HISTORY_KEYS = ["scars", "teeth", "eyepatch", "burnt", "woodenLeg", "hook", "patchStyle", "scarStyle"] as const satisfies readonly FieldKey[];

/** Applies a client-submitted look on top of the server's record: appearance from the client, history from the server. */
export function applyClientAppearance(current: CharacterSpec, incoming: CharacterSpec): CharacterSpec {
  const out = { ...incoming };
  for (const k of HISTORY_KEYS) out[k] = current[k];
  return out;
}

/** Randomise while keeping campaign history (scars, teeth...) intact: used by the creator's dice button. */
export function rerollAppearance(spec: CharacterSpec, seed: number): CharacterSpec {
  const fresh = generateCharacter(seed);
  return { ...fresh, scars: spec.scars, teeth: spec.teeth, eyepatch: spec.eyepatch, burnt: spec.burnt, woodenLeg: spec.woodenLeg, hook: spec.hook, patchStyle: spec.patchStyle, scarStyle: spec.scarStyle };
}
