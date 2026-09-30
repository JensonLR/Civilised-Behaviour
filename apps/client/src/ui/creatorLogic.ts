import { Rng } from "@cb/shared";
import * as K from "@cb/procedural";
import {
  FIELDS,
  HISTORY_KEYS,
  LEGACY_FIELD_COUNT,
  SPEC_BYTES,
  applyClientAppearance,
  decodeSpec,
  encodeSpec,
  generateCharacter,
  rerollAppearance,
  sanitizeSpec,
  type CharacterSpec,
  type FieldDef,
  type FieldKey,
} from "@cb/procedural";

/**
 * The pure half of the character creator (no DOM, so it is testable): the undo ring, look codes with plain-words validation, randomising a section, and the
 * curated archetype presets. `CharacterCreator.ts` is only the form around these.
 */

// ---- undo / redo -------------------------------------------------------------------------------------------------------------------------------

/** How many earlier looks the creator remembers. */
export const HISTORY_LIMIT = 20;
/** Edits to the same control within this many milliseconds are one step (dragging a slider is one undo, not sixty). */
export const COALESCE_MS = 700;

export const sameSpec = (a: CharacterSpec, b: CharacterSpec): boolean => encodeSpec(a) === encodeSpec(b);

/** A ring of the last `limit` looks with redo. Recording a new look drops anything that was undone. */
export class SpecHistory {
  private readonly past: CharacterSpec[] = [];
  private future: CharacterSpec[] = [];
  private now: CharacterSpec;
  private lastGroup: string | undefined;
  private lastAt = -Infinity;

  constructor(
    initial: CharacterSpec,
    private readonly limit = HISTORY_LIMIT,
  ) {
    this.now = { ...initial };
  }

  get current(): CharacterSpec {
    return { ...this.now };
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** How many looks can be stepped back to. */
  get depth(): number {
    return this.past.length;
  }

  /**
   * Records a new look. `group` names the control that made the change and `at` the time (ms): consecutive changes from the same control within `COALESCE_MS`
   * replace each other instead of piling up. Returns false when nothing changed.
   */
  record(spec: CharacterSpec, group?: string, at = 0): boolean {
    if (sameSpec(spec, this.now)) return false;
    const merge = group !== undefined && group === this.lastGroup && at - this.lastAt <= COALESCE_MS && this.past.length > 0;
    if (!merge) {
      this.past.push(this.now);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.now = { ...spec };
    this.future = [];
    this.lastGroup = group;
    this.lastAt = at;
    return true;
  }

  undo(): CharacterSpec | undefined {
    const prev = this.past.pop();
    if (!prev) return undefined;
    this.future.push(this.now);
    this.now = prev;
    this.lastGroup = undefined;
    return { ...prev };
  }

  redo(): CharacterSpec | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(this.now);
    this.now = next;
    this.lastGroup = undefined;
    return { ...next };
  }
}

// ---- look codes -------------------------------------------------------------------------------------------------------------------------------

/** Base-64 characters (no padding) for n bytes. */
const charsFor = (bytes: number): number => Math.ceil((bytes * 8) / 6);
export const CODE_MIN_CHARS = charsFor(1 + LEGACY_FIELD_COUNT);
export const CODE_MAX_CHARS = charsFor(SPEC_BYTES);

export type ParsedLook = { ok: true; spec: CharacterSpec; note?: string } | { ok: false; error: string };

/**
 * Reads a pasted look code and says, in words, what is wrong with it. Tolerates the things people really paste: spaces and line breaks around it, quotes, and a
 * `look=` prefix. Values out of range are clamped (a note says so); a code from before newer options were added reads with those options off.
 */
export function parseLookCode(input: unknown): ParsedLook {
  if (typeof input !== "string") return { ok: false, error: "There is nothing to paste: copy a look code first." };
  let text = input.trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "");
  const q = text.match(/(?:^|[?&#])look=([^&#\s]+)/);
  if (q) text = q[1]!;
  if (text.length === 0) return { ok: false, error: "There is nothing to paste: copy a look code first." };
  if (/\s/.test(text)) return { ok: false, error: "A look code has no spaces or line breaks in it: check that all of it, and only it, was copied." };
  const bad = text.search(/[^A-Za-z0-9_-]/);
  if (bad >= 0) return { ok: false, error: `The character "${text[bad]}" (number ${bad + 1}) cannot be part of a look code, which is made only of letters, digits, dashes and underscores.` };
  if (text.length > 128) return { ok: false, error: `That is far too long for a look code (${text.length} characters; a look is about ${CODE_MAX_CHARS}).` };
  if (text.length < CODE_MIN_CHARS) return { ok: false, error: `That code is ${CODE_MIN_CHARS - text.length} characters short of a whole look: part of it was probably cut off when it was copied.` };
  if (text[0] !== "A") return { ok: false, error: "This look was written by a different version of the game and cannot be read by this one." };
  const spec = decodeSpec(text);
  if (!spec) return { ok: false, error: "That does not look like a look code from this game." };
  const canonical = encodeSpec(spec);
  if (text.length > CODE_MAX_CHARS) return { ok: true, spec, note: "The code was longer than a look needs: the extra was ignored." };
  if (text.length < CODE_MAX_CHARS) return { ok: true, spec, note: "An older look: the options added since are set to none." };
  if (canonical !== text) return { ok: true, spec, note: "Some values were out of range and have been adjusted." };
  return { ok: true, spec };
}

/** A pasted look applied to the current one: appearance from the paste, campaign history (scars, teeth, a wooden leg...) from the character. */
export function applyPasted(current: CharacterSpec, pasted: CharacterSpec): CharacterSpec {
  return applyClientAppearance(current, pasted);
}

// ---- randomising ------------------------------------------------------------------------------------------------------------------------------

/** Fields that stay rare when shuffled: a crowd of face-painted, tattooed, hook-handed people is not the joke. Chance that the field is set at all. */
const RARE: Readonly<Record<string, number>> = {
  facePaint: 0.12, tattoo: 0.15, mark: 0.25, earring: 0.25, ring: 0.3, epaulettes: 0.35, decoration: 0.4, coatTrim: 0.5, trouserTrim: 0.5, hatTrim: 0.45,
  neckwear: 0.6, pack: 0.5, hipGear: 0.5, gloves: 0.4, eyewear: 0.35, moustache: 0.7, beard: 0.5, sideburns: 0.6, belt: 0.6, sash: 0.3, medals: 0.4, stubble: 0.5, greying: 0.35,
  complexion: 0.6, hat: 0.8,
};

const hashKey = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** New random values for some fields (a section, one control), leaving every other field, and the campaign's history, untouched. Deterministic in (spec, keys, seed). */
export function randomiseKeys(spec: CharacterSpec, keys: readonly string[], seed: number): CharacterSpec {
  const out = { ...spec } as Record<string, number>;
  for (const key of keys) {
    const f = (FIELDS as readonly FieldDef[]).find((x) => x.key === key);
    if (!f || (HISTORY_KEYS as readonly string[]).includes(key)) continue;
    const rng = new Rng((seed ^ hashKey(key)) >>> 0);
    if (f.kind === "slider") out[key] = rng.int(f.key === "age" ? 0 : 30, f.key === "age" ? 200 : 225);
    else if (f.kind === "choice") {
      const odds = RARE[key];
      out[key] = odds !== undefined && !rng.chance(odds) ? 0 : rng.int(odds !== undefined ? 1 : 0, f.max);
    }
  }
  return sanitizeSpec(out);
}

/** A whole new random appearance (history kept), from a seed. */
export const randomiseAll = (spec: CharacterSpec, seed: number): CharacterSpec => rerollAppearance(spec, seed);

// ---- presets ---------------------------------------------------------------------------------------------------------------------------------------

export interface Preset {
  name: string;
  blurb: string;
  spec: CharacterSpec;
}

/** Index of an option by its catalog name (a preset written against names survives the catalog growing; a renamed option fails the test, loudly). */
const at = (list: readonly string[], name: string): number => {
  const i = list.indexOf(name);
  if (i < 0) throw new Error(`preset: no option "${name}" in [${list.join(", ")}]`);
  return i;
};

function make(name: string, blurb: string, seed: number, archetype: number, over: Partial<Record<FieldKey, number>>): Preset {
  const base = generateCharacter(seed, archetype) as unknown as Record<string, number>;
  // a curated person starts from a plain slate: whatever the seed happened to give them is only kept where the preset says nothing
  const clean: Record<string, number> = { ...base, hat: 0, hatTrim: 0, coatTrim: 0, trouserTrim: 0, decoration: 0, epaulettes: 0, medals: 0, sash: 0, belt: 0, neckwear: 0, pack: 0, hipGear: 0, gloves: 0, ring: 0, earring: 0, eyewear: 0, tattoo: 0, facePaint: 0, mark: 0, moustache: 0, beard: 0, sideburns: 0, stubble: 0, greying: 0, complexion: 0, age: 60 };
  return { name, blurb, spec: sanitizeSpec({ ...clean, ...over, scars: 0, teeth: 0, eyepatch: 0, burnt: 0, woodenLeg: 0, hook: 0 }) };
}

/** Eight curated archetypes: each a complete, deliberate look (the six body archetypes, dressed, plus a captain and a botanist). */
export const PRESETS: readonly Preset[] = [
  make("Portly Colonel", "Braid, brass and a moustache that has seen off three governors.", 11, 0, {
    hat: at(K.HATS, "Shako"), hatColor: 1, jacket: at(K.JACKETS, "Tunic"), jacketColor: 0, trousers: at(K.TROUSERS, "Striped"), trousersColor: 1, boots: at(K.BOOTS, "Tall Riding"), bootColor: 1,
    belt: at(K.BELTS, "Leather"), sash: at(K.SASHES, "Diagonal"), medals: 4, decoration: at(K.DECORATIONS, "Order Star"), epaulettes: at(K.EPAULETTES, "Bullion"),
    moustache: at(K.MOUSTACHES, "Walrus"), sideburns: at(K.SIDEBURNS, "Mutton Chops"), hairColor: 6, greying: at(K.GREYING, "Silver"), brows: at(K.BROWS, "Bushy"),
    complexion: at(K.COMPLEXION, "Ruddy Cheeks"), noseStyle: at(K.NOSE_STYLES, "Ruddy Lump"), gloves: at(K.GLOVES, "White Cotton"), hipGear: at(K.HIP_GEAR, "Sabre"), accentColor: 0, age: 150, hair: at(K.HAIR_STYLES, "Bald"),
  }),
  make("Lanky Surveyor", "Measures everything, twice, and is still surprised.", 21, 1, {
    hat: at(K.HATS, "Slouch Hat"), hatColor: 7, jacket: at(K.JACKETS, "Norfolk Jacket"), jacketColor: 8, shirt: at(K.SHIRTS, "Checked"), trousers: at(K.TROUSERS, "Plus-Fours"), trousersColor: 6,
    boots: at(K.BOOTS, "Puttees"), bootColor: 2, eyewear: at(K.EYEWEAR, "Spectacles"), pack: at(K.PACKS, "Satchel"), hipGear: at(K.HIP_GEAR, "Field Glasses"), neckwear: at(K.NECKWEAR, "Neckerchief"),
    moustache: at(K.MOUSTACHES, "Toothbrush"), sideburns: at(K.SIDEBURNS, "Short"), brows: at(K.BROWS, "Thin Arched"), trouserTrim: at(K.TROUSER_TRIMS, "Knee Patches"), complexion: at(K.COMPLEXION, "Freckled"), hair: at(K.HAIR_STYLES, "Side Part"), hairColor: 5,
  }),
  make("Stout Sergeant", "Has never once been wrong, according to the Sergeant.", 31, 2, {
    hat: at(K.HATS, "Peaked Cap"), hatColor: 5, jacket: at(K.JACKETS, "Greatcoat"), jacketColor: 1, belt: at(K.BELTS, "Cross Belts"), moustache: at(K.MOUSTACHES, "Handlebar"), hairColor: 5,
    boots: at(K.BOOTS, "Hobnailed"), bootColor: 1, gloves: at(K.GLOVES, "Leather"), decoration: at(K.DECORATIONS, "Regimental Badge"), epaulettes: at(K.EPAULETTES, "Plain"),
    hipGear: at(K.HIP_GEAR, "Holster"), pack: at(K.PACKS, "Rifle"), brows: at(K.BROWS, "Heavy Flat"), stubble: at(K.STUBBLE, "Rough"), trousers: at(K.TROUSERS, "Plain"), trousersColor: 5, hair: at(K.HAIR_STYLES, "Slicked"),
  }),
  make("Dainty Aristocrat", "Travels light: one trunk per servant.", 41, 3, {
    hat: at(K.HATS, "Top Hat"), hatColor: 5, jacket: at(K.JACKETS, "Frock Coat"), jacketColor: 4, shirt: at(K.SHIRTS, "Wing Collar"), neckwear: at(K.NECKWEAR, "Bow Tie"), eyewear: at(K.EYEWEAR, "Monocle"),
    moustache: at(K.MOUSTACHES, "Waxed Tips"), trousers: at(K.TROUSERS, "Striped"), trousersColor: 6, boots: at(K.BOOTS, "Spats"), bootColor: 1, gloves: at(K.GLOVES, "White Cotton"),
    ring: at(K.RINGS, "Signet and Gem"), coatTrim: at(K.COAT_TRIMS, "Contrast Cuffs"), hair: at(K.HAIR_STYLES, "Slicked"), hairColor: 0, pack: at(K.PACKS, "Umbrella"), brows: at(K.BROWS, "Thin Arched"), eyeShape: at(K.EYE_SHAPES, "Hooded"), age: 40,
    hatTrim: at(K.HAT_TRIMS, "Ribbon Tails"), hipGear: at(K.HIP_GEAR, "Pocket Watch"),
  }),
  make("Wiry Scout", "Was here before the map, and will be here after.", 51, 4, {
    hat: at(K.HATS, "Wide-Awake"), hatColor: 8, hatTrim: at(K.HAT_TRIMS, "Feather"), jacket: at(K.JACKETS, "Hunting Jacket"), jacketColor: 2, trousers: at(K.TROUSERS, "Jodhpurs"), trousersColor: 7,
    boots: at(K.BOOTS, "Spurred"), bootColor: 2, belt: at(K.BELTS, "Ammunition Belt"), pack: at(K.PACKS, "Bedroll"), hipGear: at(K.HIP_GEAR, "Machete"), neckwear: at(K.NECKWEAR, "Scarf"),
    beard: at(K.BEARDS, "Goatee"), complexion: at(K.COMPLEXION, "Sun Spots"), stubble: at(K.STUBBLE, "Unshaven"), gloves: at(K.GLOVES, "Fingerless"), trouserTrim: at(K.TROUSER_TRIMS, "Muddy Knees"), hair: at(K.HAIR_STYLES, "Wild Tufts"), hairColor: 2,
  }),
  make("Enormous Clerk", "Files the expedition; the expedition, alas, is not filed back.", 61, 5, {
    hat: at(K.HATS, "Bowler"), hatColor: 5, jacket: at(K.JACKETS, "Waistcoat"), jacketColor: 4, shirt: at(K.SHIRTS, "Striped"), neckwear: at(K.NECKWEAR, "Cravat"), eyewear: at(K.EYEWEAR, "Half-Moons"),
    trousers: at(K.TROUSERS, "Baggy"), trousersColor: 6, boots: at(K.BOOTS, "Ankle"), bootColor: 1, sideburns: at(K.SIDEBURNS, "Bushy Wings"), hair: at(K.HAIR_STYLES, "Comb-Over"), hairColor: 1,
    moustache: at(K.MOUSTACHES, "Toothbrush"), complexion: at(K.COMPLEXION, "Freckled"), ring: at(K.RINGS, "Wedding Band"), eyeShape: at(K.EYE_SHAPES, "Bagged"), hipGear: at(K.HIP_GEAR, "Pocket Watch"), pack: at(K.PACKS, "Satchel"),
  }),
  make("Naval Captain", "Commands the river, the dinner table and the weather.", 71, 2, {
    hat: at(K.HATS, "Bicorne"), hatColor: 1, jacket: at(K.JACKETS, "Naval Reefer"), jacketColor: 1, beard: at(K.BEARDS, "Sea Captain"), hairColor: 7, greying: at(K.GREYING, "Silver"),
    boots: at(K.BOOTS, "Tall Riding"), bootColor: 1, decoration: at(K.DECORATIONS, "Ribbon Bars"), epaulettes: at(K.EPAULETTES, "Fringed"), hipGear: at(K.HIP_GEAR, "Field Glasses"), gloves: at(K.GLOVES, "White Cotton"),
    trousers: at(K.TROUSERS, "Plain"), trousersColor: 1, belt: at(K.BELTS, "Leather"), brows: at(K.BROWS, "Bushy"), age: 200, hair: at(K.HAIR_STYLES, "Long Lank"), complexion: at(K.COMPLEXION, "Sun Spots"),
  }),
  make("Veiled Botanist", "Believes every plant is a subordinate, or a rival.", 81, 1, {
    hat: at(K.HATS, "Veiled Pith"), hatColor: 7, jacket: at(K.JACKETS, "Cape"), jacketColor: 10, eyewear: at(K.EYEWEAR, "Spectacles"), pack: at(K.PACKS, "Specimen Case"), neckwear: at(K.NECKWEAR, "Ascot"),
    boots: at(K.BOOTS, "Wellingtons"), bootColor: 1, trousers: at(K.TROUSERS, "Plain"), trousersColor: 8, gloves: at(K.GLOVES, "Leather"), hair: at(K.HAIR_STYLES, "Plait"), hairColor: 2,
    hipGear: at(K.HIP_GEAR, "Coiled Rope"), brows: at(K.BROWS, "Natural"), complexion: at(K.COMPLEXION, "Freckled"), trouserTrim: at(K.TROUSER_TRIMS, "Muddy Knees"),
  }),
];

/** A preset put on the current character: the look from the preset, the campaign's history from the character. */
export const applyPreset = (current: CharacterSpec, preset: Preset): CharacterSpec => applyClientAppearance(current, preset.spec);

// ---- sections ------------------------------------------------------------------------------------------------------------------------------------

export type Tab = "types" | "body" | "face" | "clothes" | "colour";

/** Headings inside a tab: which fields sit under which. Order here is the order on screen. A field with no entry lands in the last section of its tab. */
export const SECTIONS: Record<Exclude<Tab, "types">, { title: string; keys: readonly string[] }[]> = {
  body: [
    { title: "Height and build", keys: ["height", "headScale", "torsoWidth", "torsoDepth", "belly", "shoulderWidth"] },
    { title: "Limbs and bearing", keys: ["armLength", "legLength", "handScale", "footScale", "posture"] },
  ],
  face: [
    { title: "Features", keys: ["noseScale", "earScale", "jaw", "noseStyle", "earShape", "brows", "eyeShape", "eyeColor"] },
    { title: "Hair and whiskers", keys: ["hair", "greying", "moustache", "beard", "sideburns", "stubble"] },
    { title: "Complexion and marks", keys: ["age", "complexion", "mark", "facePaint", "tattoo"] },
    { title: "Worn on the face", keys: ["eyewear", "earring"] },
  ],
  clothes: [
    { title: "Headwear", keys: ["hat", "hatTrim"] },
    { title: "Coat and shirt", keys: ["jacket", "coatTrim", "shirt", "neckwear", "epaulettes", "decoration", "medals", "sash", "gloves", "ring"] },
    { title: "Trousers and boots", keys: ["trousers", "trouserTrim", "boots", "belt"] },
    { title: "Gear", keys: ["pack", "hipGear"] },
  ],
  colour: [
    { title: "Skin and hair", keys: ["skin", "hairColor"] },
    { title: "Cloth", keys: ["jacketColor", "trousersColor", "hatColor", "shirtColor"] },
    { title: "Leather and metal", keys: ["bootColor", "accentColor"] },
  ],
};

/** The tab a field belongs to (the spec's own group, with the history group hidden). */
export const tabOfGroup = (group: FieldDef["group"]): Exclude<Tab, "types"> | undefined => (group === "history" ? undefined : group);

/** The fields of a tab in section order (catalog order inside a section). */
export function fieldsOfTab(tab: Exclude<Tab, "types">): { section: number; field: FieldDef }[] {
  const order = SECTIONS[tab];
  const out: { section: number; field: FieldDef }[] = [];
  for (const f of FIELDS as readonly FieldDef[]) {
    if (tabOfGroup(f.group) !== tab) continue;
    const i = order.findIndex((s) => s.keys.includes(f.key));
    out.push({ section: i < 0 ? order.length - 1 : i, field: f });
  }
  return out.sort((a, b) => a.section - b.section);
}

// ---- the preview poses ------------------------------------------------------------------------------------------------------------------------------

export const POSES = [
  { id: "turntable", label: "Turntable" },
  { id: "walk", label: "Walk" },
  { id: "idle", label: "Idle" },
  { id: "pain", label: "Pain" },
  { id: "triumph", label: "Triumph" },
] as const;
export type PoseId = (typeof POSES)[number]["id"];
/** The DOM event the creator raises on `window` when the pose is picked (the preview listens; neither knows the other). */
export const POSE_EVENT = "cb:creator-pose";
