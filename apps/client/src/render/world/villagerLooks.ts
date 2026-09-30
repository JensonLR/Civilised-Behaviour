import * as K from "@cb/procedural";
import { generateCharacter, sanitizeSpec, type CharacterSpec, type FieldKey } from "@cb/procedural";
import { hash3, type Villager } from "@cb/shared";

/**
 * How Hollowmere's people dress. Every villager starts from `generateCharacter` (so bodies, noses and ears come out as the game's usual caricatures) and
 * then puts on the costume of their trade, chosen by name from the shared catalogs (so a reordered list cannot break a look), in the village's own
 * dyes: indigo, teal, ochre, sand, olive and rust (the colours of its doors, shutters and roofs), with a red or a green where a trade wants one.
 * The costume speaks of the work (a veiled pith helmet for the bees, an eyeshade for the registrar, pushed-up goggles at the forge, a sou'wester and
 * wellingtons on the pond); nothing speaks of anybody's ancestry. Skin tones are spread evenly over the eight of the palette by seat in the roster,
 * not by trade, and no costume is drawn from a real people's dress (no fezs, ponchos, top knots or turbans in the catalogue picks).
 */

type Pick = string | number | readonly (string | number)[];
type Costume = Partial<Record<FieldKey, Pick>>;

const LISTS: Partial<Record<FieldKey, readonly string[]>> = {
  hat: K.HATS,
  jacket: K.JACKETS,
  shirt: K.SHIRTS,
  trousers: K.TROUSERS,
  boots: K.BOOTS,
  belt: K.BELTS,
  eyewear: K.EYEWEAR,
  sash: K.SASHES,
  neckwear: K.NECKWEAR,
  pack: K.PACKS,
  hipGear: K.HIP_GEAR,
  gloves: K.GLOVES,
  hair: K.HAIR_STYLES,
  moustache: K.MOUSTACHES,
  beard: K.BEARDS,
  sideburns: K.SIDEBURNS,
  pocket: K.POCKETS,
  hatTrim: K.HAT_TRIMS,
  coatTrim: K.COAT_TRIMS,
  brows: K.BROWS,
  greying: K.GREYING,
  complexion: K.COMPLEXION,
  stubble: K.STUBBLE,
  hairAcc: K.HAIR_ACCESSORIES,
  epaulettes: K.EPAULETTES,
  decoration: K.DECORATIONS,
  cuffDetail: K.CUFF_DETAILS,
  trouserTrim: K.TROUSER_TRIMS,
};

// cloth dyes by index (PALETTE.cloth)
const RED = 0;
const INDIGO = 1;
const GREEN = 2;
const OCHRE = 3;
const PLUM = 4;
const CHARCOAL = 5;
const STONE = 6;
const SAND = 7;
const OLIVE = 8;
const OX = 9;
const TEAL = 10;
const RUST = 11;
// shirt cloth: 0 cream, 1 linen, then the twelve dyes
const CREAM = 0;
const LINEN = 1;
const shirtDye = (dye: number): number => 2 + dye;

/** What each trade wears. Arrays are alternatives (one is drawn from the person's look seed); numbers are catalog or dye indices. */
const COSTUMES: Record<string, Costume> = {
  "Warden of the Gate": { hat: "Peaked Cap", jacket: "Greatcoat", belt: "Cross Belts", pack: "Rifle", moustache: ["Walrus", "Cavalry", "Handlebar"], jacketColor: INDIGO, trousersColor: CHARCOAL, hatColor: INDIGO, shirt: "Plain", shirtColor: CREAM, boots: "Hobnailed", medals: 1, epaulettes: "Plain", gloves: "White Cotton" },
  Miller: { hat: "Flat Cap", jacket: "Waistcoat", shirt: "Work Shirt", shirtColor: CREAM, jacketColor: SAND, trousersColor: STONE, hatColor: SAND, boots: "Clogs", beard: ["None", "Chin Puff"], pocket: "Breast Pocket", neckwear: "Neckerchief" },
  "Smith & Farrier": { hat: "None", jacket: "Shirt Sleeves", shirt: "Work Shirt", shirtColor: shirtDye(RUST), trousersColor: CHARCOAL, boots: "Hobnailed", gloves: "Gauntlets", eyewear: "Pushed-Up Goggles", beard: ["Full", "Mutton Beard"], hair: ["Slicked", "Wild Tufts"], belt: "Leather", hipGear: "None" },
  "Keeper of the Hours": { hat: "Top Hat", jacket: "Frock Coat", shirt: "Wing Collar", shirtColor: CREAM, jacketColor: PLUM, trousersColor: CHARCOAL, hatColor: PLUM, sash: "Order Ribbon", medals: 3, medalStyle: 1, neckwear: "Ascot", hipGear: "Pocket Watch", boots: "Spats", eyewear: "Half-Moons", moustache: "Imperial", decoration: "Order Star" },
  Ferryman: { hat: "Sou'wester", jacket: "Naval Reefer", shirt: "Striped", shirtColor: LINEN, jacketColor: INDIGO, trousersColor: OLIVE, hatColor: OCHRE, boots: "Wellingtons", beard: "Sea Captain", moustache: "None", neckwear: "Scarf", hipGear: "Coiled Rope" },
  "Pear Merchant": { hat: "Boater", jacket: "Waistcoat", shirt: "Striped", shirtColor: CREAM, jacketColor: GREEN, trousersColor: STONE, hatColor: SAND, boots: "Ankle", neckwear: "Bow Tie", moustache: ["Toothbrush", "Pencil"], hatTrim: "Ribbon Tails" },
  Baker: { hat: "Flat Cap", jacket: "Shirt Sleeves", shirt: "Collarless", shirtColor: LINEN, trousersColor: STONE, hatColor: STONE, boots: "Clogs", neckwear: "Neckerchief", beard: "None", moustache: "None", pocket: "Flap Pockets", hair: ["Curls", "Pompadour", "Side Part"] },
  "Retired Everything": { hat: "Slouch Hat", jacket: "Smoking Jacket", shirt: "Plain", shirtColor: CREAM, jacketColor: OX, trousersColor: CHARCOAL, hatColor: CHARCOAL, boots: "Slippers", eyewear: "Spectacles", neckwear: "Muffler", greying: "Silver", hair: ["Thin Wisps", "Receding", "Bald"], beard: ["Wizard", "None"], age: 230, posture: 40 },
  Clockkeeper: { hat: "Kepi", jacket: "Waistcoat", shirt: "Wing Collar", shirtColor: CREAM, jacketColor: TEAL, trousersColor: CHARCOAL, hatColor: TEAL, eyewear: "Jeweller's Loupe", hipGear: "Watch Chain", boots: "Ankle", pocket: "Pens and Pencils", moustache: "Waxed Tips", cuffDetail: "Gold Links" },
  "Registrar of Non-Events": { hat: "Bowler", jacket: "Frock Coat", shirt: "Wing Collar", shirtColor: CREAM, jacketColor: CHARCOAL, trousersColor: CHARCOAL, hatColor: CHARCOAL, eyewear: "Green Visor", pocket: "Pens and Pencils", neckwear: "Cravat", boots: "Spats", moustache: ["Pencil", "Toothbrush"], hipGear: "Pocket Watch" },
  "Tea Merchant": { hat: "Wide-Awake", jacket: "Cape", shirt: "Plain", shirtColor: LINEN, jacketColor: OCHRE, trousersColor: OLIVE, hatColor: OCHRE, boots: "Slippers", eyewear: "Spectacles", greying: "Streaked", hair: ["Plait", "Thin Wisps"], neckwear: "Muffler", posture: 60, age: 200 },
  Fisher: { hat: "Flat Cap", jacket: "Norfolk Jacket", shirt: "Checked", shirtColor: LINEN, jacketColor: OLIVE, trousersColor: STONE, hatColor: OLIVE, boots: "Wellingtons", pack: "Satchel", hipGear: "Canteen", beard: ["Mutton Beard", "None"], stubble: "Rough" },
  Fishmonger: { hat: "Sou'wester", jacket: "Waistcoat", shirt: "Work Shirt", shirtColor: CREAM, jacketColor: INDIGO, trousersColor: OLIVE, hatColor: OCHRE, boots: "Wellingtons", neckwear: "Scarf", hair: ["Long Lank", "Ponytail", "Curls"], beard: "None", moustache: "None" },
  Gardener: { hat: "Wide-Awake", jacket: "Tunic", shirt: "Work Shirt", shirtColor: LINEN, jacketColor: OLIVE, trousersColor: STONE, hatColor: SAND, boots: "Wellingtons", gloves: "Leather", pack: "Satchel", trousers: "Baggy", trouserTrim: "Knee Patches" },
  Beekeeper: { hat: "Veiled Pith", jacket: "Hunting Jacket", shirt: "Plain", shirtColor: CREAM, jacketColor: SAND, trousersColor: SAND, hatColor: SAND, gloves: "White Cotton", boots: "Puttees", beard: "None", moustache: "None", pack: "None" },
  Laundress: { hat: "None", jacket: "Tunic", shirt: "Collarless", shirtColor: CREAM, jacketColor: TEAL, trousersColor: INDIGO, boots: "Clogs", hair: ["Plait", "Ponytail", "Curls"], hairAcc: "Silk Flower", neckwear: "Scarf", beard: "None", moustache: "None", gloves: "Fingerless", trousers: "Baggy" },
  Lamplighter: { hat: "Bowler", jacket: "Frock Coat", shirt: "Plain", shirtColor: LINEN, jacketColor: CHARCOAL, trousersColor: CHARCOAL, hatColor: CHARCOAL, neckwear: "Scarf", boots: "Ankle", pack: "None", moustache: "Horseshoe", hipGear: "Field Glasses", gloves: "Leather" },
  "Gentleman of Leisure": { hat: "Boater", jacket: "Frock Coat", shirt: "Ruffled Jabot", shirtColor: CREAM, jacketColor: RUST, trousersColor: STONE, hatColor: SAND, boots: "Spats", pack: "Umbrella", greying: "Silver", moustache: "Magnificent Fringe", eyewear: "Monocle", age: 220, posture: 90, neckwear: "Cravat", medals: 2 },
  "Night Watch": { hat: "Nightcap", jacket: "Greatcoat", shirt: "Plain", shirtColor: LINEN, jacketColor: OX, trousersColor: OLIVE, hatColor: RED, boots: "Hobnailed", neckwear: "Muffler", hipGear: "Cartridge Pouches", moustache: "Lampshade", beard: "None", pack: "None" },
};

const CHILDREN: Costume = { hat: ["Flat Cap", "None", "None", "Slouch Hat"], jacket: ["Shirt Sleeves", "Waistcoat", "Tunic"], shirt: ["Plain", "Checked", "Work Shirt"], trousers: ["Baggy", "Tropical Shorts", "Plain"], boots: ["Clogs", "Ankle"], hair: ["Mop Top", "Bowl Cut", "Ponytail", "Curls", "Wild Tufts"], beard: "None", moustache: "None", sideburns: "None", complexion: ["Freckled", "Heavily Freckled", "Clear"], eyewear: "None", neckwear: ["None", "Scarf"], greying: "None", stubble: "Clean-Shaven" };

/** The dyes an outfit may change by, so two people in the same trade do not match: a step along the local palette. */
const LOCAL_DYES = [INDIGO, TEAL, OCHRE, SAND, OLIVE, RUST, GREEN, STONE];

function resolve(field: FieldKey, pick: Pick, h: number): number {
  const one = Array.isArray(pick) ? pick[h % pick.length]! : (pick as string | number);
  if (typeof one === "number") return one;
  const list = LISTS[field];
  const i = list ? list.indexOf(one) : -1;
  if (i < 0) throw new Error(`villagerLooks: no "${one}" in the ${field} catalogue`);
  return i;
}

/** The look of a villager: deterministic in the roster entry. */
export function folkSpec(v: Villager): CharacterSpec {
  const base = { ...generateCharacter(v.lookSeed, v.archetype) };
  const spec = base as Record<FieldKey, number>;
  const costume = { eyewear: "None", ...(v.age === "child" ? CHILDREN : (COSTUMES[v.title] ?? {})) } as Costume;
  // (no top knots: a hairstyle of a real people's; the generator may draw one)
  if (spec.hair === K.HAIR_STYLES.indexOf("Top Knot")) spec.hair = [3, 7, 9, 1][hash3(v.lookSeed, 8, 8) % 4]!;
  // history is the campaign's business: villagers have none
  for (const key of ["scars", "teeth", "eyepatch", "burnt", "woodenLeg", "hook", "patchStyle", "scarStyle", "tattoo", "facePaint"] as const) spec[key] = 0;
  spec.medals = 0;
  spec.medalStyle = 0;
  // skin tones spread evenly over the roster by seat (eight tones, twenty-two people), whatever the trade
  spec.skin = (v.id * 3 + (v.lookSeed & 7)) % K.SKIN_TONES.length;
  let n = 0;
  for (const [field, pick] of Object.entries(costume) as [FieldKey, Pick][]) spec[field] = resolve(field, pick, hash3(v.lookSeed, n++, 0x77));
  if (spec.hair === K.HAIR_STYLES.indexOf("Top Knot")) spec.hair = 3;
  // the local palette: the same trade in a different year's dye (only where the costume does not fix one)
  const jitter = hash3(v.lookSeed, 0x1c, 0x5) % LOCAL_DYES.length;
  if (!("jacketColor" in costume)) spec.jacketColor = LOCAL_DYES[jitter]!;
  if (!("trousersColor" in costume)) spec.trousersColor = LOCAL_DYES[(jitter + 3) % LOCAL_DYES.length]!;
  if (!("hatColor" in costume)) spec.hatColor = LOCAL_DYES[(jitter + 5) % LOCAL_DYES.length]!;
  if (spec.hatColor === spec.jacketColor) spec.hatColor = LOCAL_DYES[(LOCAL_DYES.indexOf(spec.hatColor) + 2) % LOCAL_DYES.length]!;
  if (v.age === "child") {
    // small bodies with big heads and short legs (the root is scaled down on top of this)
    spec.height = 30 + (hash3(v.lookSeed, 1, 1) % 40);
    spec.headScale = 190 + (hash3(v.lookSeed, 2, 1) % 50);
    spec.torsoWidth = 80 + (hash3(v.lookSeed, 3, 1) % 40);
    spec.torsoDepth = 90;
    spec.belly = 30 + (hash3(v.lookSeed, 4, 1) % 40);
    spec.legLength = 90 + (hash3(v.lookSeed, 5, 1) % 50);
    spec.armLength = 100;
    spec.age = 0;
    spec.posture = 200;
    spec.hairColor = [0, 1, 2, 3, 4, 5, 9][hash3(v.lookSeed, 9, 4) % 7]!;
    spec.noseScale = 40 + (hash3(v.lookSeed, 6, 1) % 60);
    spec.earScale = 150;
  } else if (v.age === "elder") {
    spec.hairColor = 6 + (hash3(v.lookSeed, 9, 2) % 2); // grey or white
    spec.greying = spec.greying === 0 ? 3 : spec.greying;
    spec.age = Math.max(spec.age, 200);
    spec.posture = Math.min(spec.posture, 80);
  } else {
    spec.age = Math.min(spec.age, 150);
    // (white hair is for the old; the adults take the darker, browner, redder ones)
    if (spec.hairColor === 6 || spec.hairColor === 7) spec.hairColor = [0, 1, 2, 3, 5, 9][hash3(v.lookSeed, 9, 3) % 6]!;
  }
  return sanitizeSpec(spec);
}

/** Which of the roster's people wear what, for tests and for the lineup showcase. */
export const COSTUME_TITLES: readonly string[] = Object.keys(COSTUMES);
