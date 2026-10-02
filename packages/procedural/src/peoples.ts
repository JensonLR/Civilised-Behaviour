import { DYE, PEOPLE, Rng, resolvePeople, type PeopleId } from "@cb/shared";
import * as C from "./catalog.ts";
import { sanitizeSpec, type CharacterSpec } from "./spec.ts";

/**
 * NATIVE PEOPLES, the generator side (D-038, docs/_notes/polish2.md section 4; the ids and the guardrails are `@cb/shared` `peoples.ts`). A people is a PARAMETER OVERLAY on the
 * caricature generator, never a second generator: `applyPeople(spec, people, seed)` takes any seeded character and re-draws the parts that make a silhouette (the body's proportion
 * ranges, headwear, outer garment, neckwear, hair, painted marks, ornament, dyes) from the people's own tables, and removes the colonial uniform (top hats, epaulettes, medals,
 * monocles ...) which would make them read as the Society in fancy dress. Skin tone, eye colour and hair colour are NEVER touched: they span the whole palette in every people.
 *
 * STATE OF THIS FILE: a working first-pass contract (stub-grade data, callable today). Package C owns it: tune the ranges by looking at the lineup (`?showcase=peoples`), append the
 * catalogue additions listed in `PEOPLE_CATALOG_ADDITIONS` to `catalog.ts` (append-only, the wire format), build their geometry, and flip `PEOPLE_ADDITIONS_LANDED`. Names that are not in
 * the catalogue yet are skipped, so the overlay degrades to the existing options until they land.
 */

export type Range = readonly [lo: number, hi: number];
/** The sliders a people may pin to a range (0..255): body proportions, face scale, posture, age. */
export type SliderKey = "height" | "headScale" | "torsoWidth" | "torsoDepth" | "belly" | "shoulderWidth" | "armLength" | "legLength" | "handScale" | "footScale" | "noseScale" | "earScale" | "jaw" | "posture" | "age";
/** The choice fields a people draws by NAME (so reordering a catalogue cannot change a look; "None" is a name). */
export type TagField = "hat" | "jacket" | "shirt" | "trousers" | "boots" | "belt" | "sash" | "neckwear" | "pack" | "hipGear" | "gloves" | "hair" | "hairAcc" | "facePaint" | "earring" | "coatTrim" | "hatTrim" | "trouserTrim" | "moustache" | "beard";
export type Weighted = readonly (readonly [name: string, weight: number])[];

export interface PeopleOverlay {
  id: Exclude<PeopleId, "wayfarers">;
  /** Slider ranges, 0..255: the person's value is drawn inside the range (replacing the archetype's). Unlisted sliders keep the generator's draw. */
  body: Partial<Record<SliderKey, Range>>;
  /** Weighted names per choice field. A listed field is ALWAYS re-drawn from its table. */
  pick: Partial<Record<TagField, Weighted>>;
  /** Chance (0..1) that the "grand" variant of the people appears in a crowd of the people: it uses `grandPick` over `pick`. */
  grandOdds: number;
  grandPick: Partial<Record<TagField, Weighted>>;
}

const w = (...pairs: (readonly [string, number])[]): Weighted => pairs;

/**
 * Colonial-coded options natives never wear (the Society's uniforms and affectations) PLUS options that echo a real people's dress (the catalogue has a fez, a poncho and a top knot
 * from before D-038: they stay for the creator, never for a native). `applyPeople` replaces any of them the generator drew.
 */
export const COLONIAL_CODED: Partial<Record<TagField | "epaulettes" | "decoration" | "eyewear" | "sideburns", readonly string[]>> = {
  // (D-041: the owner's "the people we colonise should not look like us" was still unmet: natives wore the Society's caps, waistcoats, collars, breeches, riding boots, gloves and
  // whiskers under their own hats. Everything a Victorian gentleman's outfitter sold is now the Society's alone.)
  hat: ["Top Hat", "Bowler", "Pith Helmet", "Shako", "Bicorne", "Plumed Helmet", "Boater", "Fez", "Veiled Pith", "Tricorn", "Kepi", "Deerstalker", "Topee", "Busby", "Peaked Cap", "Flat Cap", "Slouch Hat", "Wide-Awake", "Sou'wester", "Nightcap"],
  jacket: ["Frock Coat", "Tunic", "Greatcoat", "Hunting Jacket", "Poncho", "Smoking Jacket", "Naval Reefer", "Norfolk Jacket", "Waistcoat"],
  shirt: ["Striped", "Checked", "Wing Collar", "Ruffled Jabot"],
  trousers: ["Striped", "Breeches", "Plus-Fours", "Jodhpurs"],
  boots: ["Tall Riding", "Spats", "Spurred", "Puttees", "Wellingtons", "Hobnailed"],
  gloves: ["White Cotton", "Leather", "Gauntlets"],
  sideburns: ["Mutton Chops", "Flourishing", "Bushy Wings", "Piccadilly Weepers", "Sculpted Points"],
  neckwear: ["Cravat", "Bow Tie", "Ascot", "Ruff"],
  hair: ["Top Knot", "Pompadour"],
  moustache: ["Handlebar", "Walrus", "Imperial", "Waxed Tips", "Soup Strainer", "Cavalry", "Magnificent Fringe", "Lampshade", "Toothbrush", "Pencil"],
  epaulettes: ["Plain", "Fringed", "Bullion", "Shoulder Cords"],
  decoration: ["Ribbon Bars", "Order Star", "Regimental Badge", "Rosette"],
  eyewear: ["Monocle", "Pince-nez", "Left Monocle", "Corded Pince-nez", "Green Visor"],
  hipGear: ["Sabre", "Holster", "Watch Chain", "Pocket Watch"],
  belt: ["Cross Belts", "Ammunition Belt"],
  sash: ["Order Ribbon", "Diagonal", "Cross Sashes"],
};

/**
 * The catalogue additions package C appends (END of each list only; the order is the wire format) and builds. Exact names, so tests, the lineup and LEVEL_PLAN's per-region dress notes
 * can refer to them. Each is described by what it does for the people who wear it. `PEOPLE_ADDITIONS_LANDED` is false until `catalog.ts` has them all.
 */
export const PEOPLE_CATALOG_ADDITIONS = {
  HATS: ["Reed Brim", "Lamp Hood", "Sheaf Hat", "Tide Hat", "Dust Wrap", "Tiered Hat", "Bell Crown", "Net Cap"],
  JACKETS: ["Stone Smock", "Lamp Robe", "Herd Cloak", "Crepe Shawl", "Wading Smock", "Court Cloak"],
  NECKWEAR: ["Bead Strings", "Bell Collar", "Float Cord", "Lamp Chain", "Memorial Beads"],
  FACE_PAINT: ["Lime Dabs", "Lamp Soot Line", "Grange Stripes", "Ash Brow", "Tide Lines"],
  HAIR_STYLES: ["Draped Fall", "Braid Crown", "Salt Locks", "Wrapped Plait", "Shoulder Curtain", "Tied Tail"],
  HAIR_ACCESSORIES: ["Copper Rings", "Bone Pins", "Glass Beads", "Herd Tags"],
  HIP_GEAR: ["Small Lamp", "Herd Bell", "Tally Cord", "Net Bag"],
  BOOTS: ["Reed Sandals", "Mud Pattens"],
} as const;
export type AdditionKey = keyof typeof PEOPLE_CATALOG_ADDITIONS;
/** Flipped by package C when every name above is in the catalogue AND has geometry (the audit test then requires it). */
export const PEOPLE_ADDITIONS_LANDED = true as boolean;

const FIELD_LIST: Record<TagField, readonly string[]> = {
  hat: C.HATS, jacket: C.JACKETS, shirt: C.SHIRTS, trousers: C.TROUSERS, boots: C.BOOTS, belt: C.BELTS, sash: C.SASHES, neckwear: C.NECKWEAR, pack: C.PACKS, hipGear: C.HIP_GEAR,
  gloves: C.GLOVES, hair: C.HAIR_STYLES, hairAcc: C.HAIR_ACCESSORIES, facePaint: C.FACE_PAINT, earring: C.EARRINGS, coatTrim: C.COAT_TRIMS, hatTrim: C.HAT_TRIMS, trouserTrim: C.TROUSER_TRIMS,
  moustache: C.MOUSTACHES, beard: C.BEARDS,
};

/** First-pass overlays: ranges and tables chosen from the existing catalogue plus the additions above (skipped until they exist). Package C tunes these by eye. */
export const PEOPLE_OVERLAYS: Readonly<Record<Exclude<PeopleId, "wayfarers">, PeopleOverlay>> = {
  mereborn: {
    id: "mereborn",
    body: { height: [90, 190], torsoWidth: [110, 220], belly: [60, 190], headScale: [90, 190], shoulderWidth: [90, 180], handScale: [120, 220], footScale: [100, 190] },
    pick: {
      hat: w(["Reed Brim", 7], ["None", 2]),
      jacket: w(["Stone Smock", 7], ["Shirt Sleeves", 1], ["Cape", 1]),
      boots: w(["Clogs", 4], ["Reed Sandals", 3], ["Slippers", 1]),
      shirt: w(["Collarless", 3], ["Work Shirt", 2]),
      neckwear: w(["None", 4], ["Neckerchief", 3], ["Scarf", 2]),
      facePaint: w(["None", 7], ["Lime Dabs", 3]),
      hair: w(["Plait", 2], ["Curls", 2], ["Bowl Cut", 1], ["Side Part", 2], ["Mop Top", 1], ["Draped Fall", 1], ["Receding", 1]),
      belt: w(["Rope", 3], ["Leather", 2], ["None", 2]),
      hipGear: w(["Coiled Rope", 2], ["Net Bag", 2], ["Canteen", 1], ["None", 3]),
    },
    grandOdds: 0.1,
    grandPick: { hat: w(["Tiered Hat", 1]), jacket: w(["Court Cloak", 1]), sash: w(["Waist", 1]) },
  },
  kessarine: {
    id: "kessarine",
    body: { height: [175, 255], torsoWidth: [40, 120], torsoDepth: [60, 130], belly: [0, 90], headScale: [50, 130], shoulderWidth: [60, 140], legLength: [150, 255], armLength: [140, 230], handScale: [110, 200], posture: [150, 255] },
    pick: {
      hat: w(["Lamp Hood", 7], ["None", 1]),
      jacket: w(["Lamp Robe", 7], ["Cape", 1]),
      boots: w(["Slippers", 3], ["Reed Sandals", 2], ["Ankle", 1]),
      shirt: w(["Collarless", 3], ["Plain", 1]),
      neckwear: w(["Lamp Chain", 3], ["Scarf", 2], ["None", 2]),
      facePaint: w(["None", 5], ["Lamp Soot Line", 4]),
      hipGear: w(["Small Lamp", 6], ["Canteen", 1]),
      hair: w(["Slicked", 2], ["Draped Fall", 2], ["Tied Tail", 2], ["Long Lank", 1], ["Plait", 1]),
      belt: w(["Leather", 3], ["Rope", 2]),
    },
    grandOdds: 0.18,
    grandPick: { jacket: w(["Lamp Robe", 1]), neckwear: w(["Lamp Chain", 1]), hat: w(["Lamp Hood", 1]) },
  },
  marchers: {
    id: "marchers",
    body: { height: [110, 220], torsoWidth: [150, 255], torsoDepth: [120, 220], belly: [60, 200], shoulderWidth: [170, 255], armLength: [110, 200], handScale: [170, 255], footScale: [140, 230], headScale: [80, 170], posture: [120, 230] },
    pick: {
      hat: w(["Sheaf Hat", 7], ["None", 1]),
      jacket: w(["Herd Cloak", 7], ["Cape", 1]),
      boots: w(["Reed Sandals", 3], ["Clogs", 2], ["Mud Pattens", 1], ["Ankle", 1]),
      shirt: w(["Work Shirt", 3], ["Collarless", 2]),
      neckwear: w(["Bell Collar", 3], ["Bead Strings", 2], ["Scarf", 2], ["None", 1]),
      hair: w(["Braid Crown", 3], ["Plait", 2], ["Shaggy Mane", 2], ["Curls", 1], ["Shoulder Curtain", 1]),
      hairAcc: w(["Herd Tags", 3], ["Glass Beads", 2], ["None", 3]),
      hipGear: w(["Herd Bell", 4], ["Coiled Rope", 2], ["Canteen", 1]),
      facePaint: w(["None", 6], ["Grange Stripes", 3]),
      belt: w(["Leather", 3], ["Cummerbund", 1], ["Rope", 2]),
    },
    grandOdds: 0.16,
    grandPick: { jacket: w(["Court Cloak", 1]), hat: w(["Bell Crown", 1]), neckwear: w(["Bead Strings", 1]), sash: w(["Tasselled Waist", 1]) },
  },
  vesperine: {
    id: "vesperine",
    body: { height: [80, 190], torsoWidth: [30, 110], torsoDepth: [60, 130], belly: [0, 70], headScale: [100, 200], shoulderWidth: [40, 120], armLength: [140, 230], posture: [20, 110], age: [90, 230], jaw: [90, 200] },
    pick: {
      hat: w(["Dust Wrap", 7], ["None", 1]),
      jacket: w(["Crepe Shawl", 7], ["Cape", 1]),
      boots: w(["Ankle", 3], ["Mud Pattens", 2], ["Reed Sandals", 1]),
      shirt: w(["Collarless", 3], ["Plain", 1]),
      neckwear: w(["Memorial Beads", 4], ["Muffler", 2], ["None", 2]),
      facePaint: w(["Ash Brow", 4], ["None", 4], ["Soot Smudges", 2]),
      hair: w(["Wrapped Plait", 3], ["Draped Fall", 2], ["Long Lank", 2], ["Thin Wisps", 1], ["Monk Fringe", 1]),
      hairAcc: w(["Copper Rings", 3], ["Bone Pins", 2], ["None", 3]),
      gloves: w(["None", 5], ["Fingerless", 2]),
    },
    grandOdds: 0.14,
    grandPick: { neckwear: w(["Memorial Beads", 1]), jacket: w(["Crepe Shawl", 1]), hat: w(["Tiered Hat", 1]) },
  },
  brinefolk: {
    id: "brinefolk",
    body: { height: [20, 120], torsoWidth: [150, 255], torsoDepth: [140, 230], belly: [140, 255], headScale: [100, 200], shoulderWidth: [90, 170], legLength: [10, 100], armLength: [60, 140], footScale: [150, 255], handScale: [110, 210] },
    pick: {
      hat: w(["Tide Hat", 6], ["Net Cap", 3], ["None", 1]),
      jacket: w(["Wading Smock", 7], ["Shirt Sleeves", 1]),
      boots: w(["Mud Pattens", 4], ["Reed Sandals", 2]),
      shirt: w(["Work Shirt", 3], ["Collarless", 2]),
      neckwear: w(["Float Cord", 4], ["Bead Strings", 2], ["None", 2]),
      facePaint: w(["Tide Lines", 4], ["None", 5]),
      hair: w(["Salt Locks", 4], ["Tied Tail", 2], ["Curls", 1], ["Shaggy Mane", 1]),
      hipGear: w(["Net Bag", 3], ["Tally Cord", 3], ["Coiled Rope", 1]),
      trousers: w(["Tropical Shorts", 3], ["Baggy", 3], ["Plain", 1]),
    },
    grandOdds: 0.2,
    grandPick: { hipGear: w(["Tally Cord", 1]), neckwear: w(["Bead Strings", 1]), jacket: w(["Court Cloak", 1]) },
  },
};

const rangeAt = (r: Range, u: number): number => Math.round(r[0] + (r[1] - r[0]) * u);

/** The catalogue list behind a COLONIAL_CODED field. */
export const codedList = (f: string): readonly string[] =>
  f === "epaulettes" ? C.EPAULETTES : f === "decoration" ? C.DECORATIONS : f === "eyewear" ? C.EYEWEAR : f === "sideburns" ? C.SIDEBURNS : FIELD_LIST[f as TagField];
/** What replaces a colonial pick where the field's first option is not "nothing" (boots[0] is the riding boot). */
const REPLACE: Readonly<Record<string, string>> = { hair: "Curls", boots: "Reed Sandals", gloves: "None", sideburns: "None" };

/** A name from a weighted table that exists in the catalogue (additions not yet landed are skipped); undefined if none does. */
function drawName(table: Weighted, list: readonly string[], rng: Rng): string | undefined {
  const live = table.filter(([n]) => list.includes(n));
  const total = live.reduce((s, [, k]) => s + k, 0);
  if (total <= 0) return undefined;
  let t = rng.range(0, total);
  for (const [n, k] of live) {
    t -= k;
    if (t <= 0) return n;
  }
  return live[live.length - 1]![0];
}

/**
 * Re-draws `spec` as a person of `people` (a wayfarer is resolved to one of the mix by `seed`, and then wears a travelling kit). Deterministic in (spec, people, seed); touches no skin, eye or
 * hair colour; never touches history (scars, teeth, patch, burns, legs, hook). Dyes come from the people's own dye list.
 */
export function applyPeople(spec: CharacterSpec, people: PeopleId, seed: number): CharacterSpec {
  const wayfarer = people === "wayfarers";
  const id = resolvePeople(people, seed);
  const o = PEOPLE_OVERLAYS[id];
  const rng = new Rng((seed ^ 0x5eed7001) >>> 0);
  const out = { ...spec } as Record<string, number>;
  for (const [k, r] of Object.entries(o.body) as [SliderKey, Range][]) out[k] = rangeAt(r, rng.range(0, 1));
  const grand = rng.chance(o.grandOdds);
  for (const f of Object.keys(o.pick) as TagField[]) {
    const table = (grand ? o.grandPick[f] : undefined) ?? o.pick[f]!;
    const list = FIELD_LIST[f];
    const name = drawName(table, list, rng);
    if (name !== undefined) out[f] = list.indexOf(name);
  }
  // every native wears at least one piece of its own people's dress that reads at ten metres (hat, garment, neckwear or hair): the signature garment (the most-drawn native one of the table) if the draws gave none
  const own = new Set<string>(Object.values(PEOPLE_CATALOG_ADDITIONS).flat() as string[]);
  const wornOwn = ((["hat", "jacket", "neckwear", "hair"]) as TagField[]).some((f) => own.has(FIELD_LIST[f][out[f] ?? 0] ?? "")); // (what reads at ten metres)
  if (!wornOwn) {
    const sig = o.pick.jacket?.find(([n]) => own.has(n) && C.JACKETS.includes(n as never));
    if (sig) out.jacket = (C.JACKETS as readonly string[]).indexOf(sig[0]);
  }
  // the colonial uniform and the borrowed dress never survive (a field whose first option is itself colonial is replaced by a native one)
  for (const [f, names] of Object.entries(COLONIAL_CODED) as [string, readonly string[]][]) {
    const list = codedList(f);
    const cur = list[out[f] ?? 0];
    if (cur !== undefined && names.includes(cur)) out[f] = Math.max(0, list.indexOf(REPLACE[f] ?? list[0]!));
  }
  out.medals = 0;
  out.medalStyle = 0;
  // no spectacles, naturalist's gear or gilt trim: the Society's affectations (a trade may put a tool back: villagerLooks.ts `NATIVE_KEEP`)
  out.eyewear = 0;
  if (!wayfarer) out.pack = 0;
  if ([1, 3, 4].includes(out.hatTrim ?? 0)) out.hatTrim = 0; // (goggles on the brim, a badge, a cockade)
  if ([1, 4].includes(out.coatTrim ?? 0)) out.coatTrim = 0; // (frogging, gold braid)
  if (out.cuffDetail === 2) out.cuffDetail = 0; // (gold links)
  if (out.pocket === 4) out.pocket = 0; // (pens and pencils)
  if (out.buckle === 4) out.buckle = 0; // (a crest plate)
  // dress in the people's own dyes
  const dyes: number[] = PEOPLE[id].dyes.map((d) => DYE[d]);
  const dye = (i: number): number => dyes[i % dyes.length]!;
  out.jacketColor = dye(rng.int(0, 2));
  out.trousersColor = dye(rng.int(1, 4));
  out.hatColor = dye(rng.int(0, 5));
  if (out.hatColor === out.jacketColor) out.hatColor = dye(dyes.indexOf(out.hatColor) + 2);
  out.shirtColor = 2 + dye(rng.int(2, 5));
  if (wayfarer) {
    // the travelling kit over their people's dress
    const pack = drawName(w(["Bedroll", 3], ["Satchel", 3], ["Rucksack", 2], ["Specimen Case", 1], ["Tin Trunk", 1]), C.PACKS, rng);
    if (pack) out.pack = (C.PACKS as readonly string[]).indexOf(pack);
  }
  return sanitizeSpec(out);
}
