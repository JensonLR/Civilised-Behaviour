import { NPC, type RegionId } from "./campaignTypes.ts";

/**
 * THE NATIVE PEOPLES (D-038, docs/_notes/polish2.md section 4). The people the Society "improves" must not look like the Society: until now every villager, sentry and
 * claimant came out of the same caricature generator and the same Victorian catalogues as the players, in a different coat. This file is the CONTRACT (ids, who lives
 * where, which NPC role belongs to which people, the words each people's dress is made of); the numbers that turn a seed into a person of a people live in
 * `packages/procedural/src/peoples.ts`, and the clothes themselves are catalogue additions package C writes.
 *
 * GUARDRAILS (CLAUDE.md "fictional cultures only"; a test scans these strings and C's catalogue names):
 *  - Every people is FICTIONAL and named after nothing real. None is a recolour of a real nation's dress: no turbans, fezzes, ponchos, kimonos, top knots, kilts, saris, war paint
 *    copied from a real tradition. A garment is described by WHAT IT DOES for the people who wear it (a rain-hat, a lamp-hood, a mourning shawl), never by whom it resembles.
 *  - They differ by SILHOUETTE (proportions, hats, hems), DRESS, ORNAMENT, hair arrangement, painted marks, the colours of their own buildings and (D-067, the owner's decision,
 *    legal-approved 2026-10-04) SKIN drawn from the darker end of the palette, a band of several tones per people so no crowd is one colour; never by face shapes that echo a real
 *    people's caricature. Hair colour spans the whole palette in every people; players keep the whole skin palette, the deep tones included.
 *  - They are people with trades, rank, humour and opinions, not a uniform: every people has a working class and a grand one (`grand`), and the satire still lands on the
 *    Society, the Syndicate and the institutions. The Society's folk (players, hired hands, the Syndicate, deserters, the Society's own staff at the depot) KEEP the colonial look: the contrast is the point.
 *  - Append-only: ids and ordering are the wire of nothing yet, but tests, saves and the lineup showcase will index them.
 */

export const PEOPLE_IDS = ["mereborn", "kessarine", "marchers", "vesperine", "brinefolk", "wayfarers"] as const;
export type PeopleId = (typeof PEOPLE_IDS)[number];
export const isPeopleId = (v: unknown): v is PeopleId => typeof v === "string" && (PEOPLE_IDS as readonly string[]).includes(v);

/** The twelve cloth dyes of `PALETTE.cloth`, by index (the order villagerLooks.ts has always used). A people's dress is chosen from its own dyes: the colours of its doors and roofs. */
export const DYE = { red: 0, indigo: 1, green: 2, ochre: 3, plum: 4, charcoal: 5, stone: 6, sand: 7, olive: 8, ox: 9, teal: 10, rust: 11 } as const;
export type DyeName = keyof typeof DYE;

export interface PeopleDef {
  id: PeopleId;
  /** "the Mereborn": how the paper and the lineup showcase say it. */
  name: string;
  /** The region they are at home in, or "visitors" (the hub's mixed company: traders, sailors and pilgrims of all the others). */
  home: RegionId | "visitors";
  blurb: string;
  /** What their buildings are made of and coloured: the dress takes its dyes from here (LEVEL_PLAN.md names the same words per region). */
  architecture: string;
  /** Their dyes, commonest first (`DYE`). */
  /** D-065: the first two are the garment's (never the Society's khaki or navy: a native in sand or indigo read as an explorer at ten metres); the rest are trim, hat and wrap. */
  dyes: readonly DyeName[];
  /** What reads at 30 m: the silhouette in four words. */
  silhouette: string;
  /** The grand ones: who wears the rare, expensive version of the look (a rank, not a different people). */
  grand: string;
}

export const PEOPLE: Readonly<Record<PeopleId, PeopleDef>> = {
  mereborn: {
    id: "mereborn", name: "the Mereborn", home: "hollowmere",
    blurb: "Hill-and-river villagers who have learned that a smile is cheaper than a lawsuit and an invoice is only a sort of weather.",
    architecture: "lime-washed walls over river-stone footings, dark framing, indigo doors, teal shutters, clay-tile and scaled-shingle roofs",
    dyes: ["teal", "ochre", "rust", "olive", "indigo", "sand"],
    silhouette: "broad reed rain-hat, long smock, clogs, lime-dabbed hands",
    grand: "the Keeper of the Hours and the hall's elders, in plum and a tall tiered hat",
  },
  kessarine: {
    id: "kessarine", name: "the Kessarine", home: "kessar",
    blurb: "Coast and hill-fort folk of the Ward of the Nine Lamps: tall, lean, lamp-bearing, and professionally unsurprised by anybody's paperwork.",
    architecture: "ochre sandstone, red-tile roofs, ward-red banners and ward-blue cloth, iron lamp-brackets at every door",
    dyes: ["rust", "ochre", "indigo", "red", "sand", "stone"],
    silhouette: "tall and narrow, ankle-length lamp-robe, pointed lamp-hood, a small lamp at the belt",
    grand: "the Lamp-Wardens, in red with nine brass lamps on a chain",
  },
  marchers: {
    id: "marchers", name: "the Marchers", home: "highmark",
    blurb: "Grassland herders and highland court, the same people with different hats: strong, patient, fond of ceremony, and six years into waiting for a signature.",
    architecture: "chalk walls, verdigris roofs, gilt suns, crown-red and crown-blue cloth, grange-gold thatch and herd-bells on every post",
    dyes: ["ochre", "olive", "red", "sand", "indigo", "stone"],
    silhouette: "broad shoulders, layered herd-cloak, tall banded sheaf-hat, brass bells",
    grand: "the court, in crown blue with gilt sun discs and a tasselled long cloak",
  },
  vesperine: {
    id: "vesperine", name: "the Vesperine", home: "vesper",
    blurb: "Canyon miners and mourners of the Low Vesper Lamentation Guild: spare, dusty, funerary, and the only people in the colony who keep complete records.",
    architecture: "red-violet strata, crepe black, corrugated iron, plum guild banners, copper fittings, lamp-amber at the windows",
    dyes: ["plum", "charcoal", "stone", "rust", "sand", "ox"],
    silhouette: "spare and stooped, crepe shawl, dust-wrap over the nose, a bead for every funeral",
    grand: "the Dirge-Masters, in plum crepe with a long strand of copper memorial beads",
  },
  brinefolk: {
    id: "brinefolk", name: "the Brinefolk", home: "saltmarket",
    blurb: "Delta stilt-dwellers and the Brine Houses' factors: waders and counters of beads, who sell the tide by deed and everything else by the lot.",
    architecture: "silvered timber on stilts, pale lime, house banners in teal and ox, salt-pan white, glass floats on every rail",
    dyes: ["teal", "ox", "olive", "stone", "sand", "indigo"],
    silhouette: "short and round, wading smock, wide flat tide-hat, float-cord and net",
    grand: "the House heads, in ox and teal with a long tally-bead sash",
  },
  wayfarers: {
    id: "wayfarers", name: "the Wayfarers", home: "visitors",
    blurb: "Traders, sailors and pilgrims of all the other peoples who pass through the Society's depot: each wears their own people's dress with a travelling kit over it.",
    architecture: "none: they sleep on boats and in the tavern",
    dyes: ["olive", "rust", "ochre", "teal", "indigo", "sand"],
    silhouette: "any of the others, plus a pack, a bedroll or a trade-sample case",
    grand: "the harbour-master's guests, in a mix of two peoples' finest",
  },
};

/** One home people per region; the hub (Hollowmere) belongs to the Mereborn, and its visitors to the Wayfarers. */
export const PEOPLE_OF_REGION: Readonly<Record<RegionId, PeopleId>> = { hollowmere: "mereborn", kessar: "kessarine", highmark: "marchers", vesper: "vesperine", saltmarket: "brinefolk" };
export const peopleOfRegion = (r: RegionId): PeopleId => PEOPLE_OF_REGION[r];

/**
 * The Wayfarers are a mix: a wayfarer's own look is one of these peoples' (chosen by seed) with a travelling kit. Never includes `wayfarers` itself, and never the Society.
 */
export const WAYFARER_MIX: readonly PeopleId[] = ["mereborn", "kessarine", "marchers", "vesperine", "brinefolk"];

/** "colonial" = the Society's own folk keep the colonial caricature look (no people overlay at all). */
export type PeopleChoice = PeopleId | "colonial";

/**
 * HOOK 1: which people an NPC ROLE (`NPC.*`) belongs to in a region. `undefined` = colonial (the Syndicate's guards and surveyors, deserters, the Society's hired rifles and surgeons,
 * the foreman of a company mine). Local labour (drivers, porters, hostages taken from a village) are the region's own people. A new NPC role must be added here (the test enumerates `NPC`).
 */
export function peopleForNpc(role: number, region: RegionId): PeopleId | undefined {
  switch (role) {
    case NPC.SENTRY:
    case NPC.WARDEN:
      return "kessarine";
    case NPC.CHAMBERLAIN:
    case NPC.CLAIMANT:
    case NPC.COURT_GUARD:
    case NPC.HERDER:
      return "marchers";
    case NPC.MINER:
    case NPC.MOURNER:
      return "vesperine";
    case NPC.CUSTOMS:
    case NPC.BARGEMAN:
    case NPC.FACTOR:
      return "brinefolk";
    case NPC.DRIVER:
    case NPC.PORTER:
    case NPC.HOSTAGE:
      return PEOPLE_OF_REGION[region];
    default:
      return undefined; // NONE, RIVAL_GUARD, RIVAL_SURVEYOR, RAIDER, DESERTER, HIRED_RIFLE, SURGEON, FOREMAN: the Society, the Syndicate, the Company
  }
}

/**
 * HOOK 2: Hollowmere's villagers by TRADE (`Villager.title`). The Society's depot staff stay colonial, the passing trade are Wayfarers, everyone else is Mereborn. Children and elders
 * follow their trade/household. `folkSpec` (villagerLooks.ts) reads this.
 */
export const VILLAGER_PEOPLE: Readonly<Record<string, PeopleChoice>> = {
  "Warden of the Gate": "mereborn", Miller: "mereborn", "Smith & Farrier": "mereborn", "Keeper of the Hours": "mereborn", Ferryman: "wayfarers", "Pear Merchant": "wayfarers",
  Baker: "mereborn", "Retired Everything": "colonial", Clockkeeper: "mereborn", "Registrar of Non-Events": "colonial", "Tea Merchant": "wayfarers", Fisher: "mereborn",
  Fishmonger: "mereborn", Gardener: "mereborn", Beekeeper: "mereborn", Laundress: "mereborn", Lamplighter: "mereborn", "Gentleman of Leisure": "colonial", "Night Watch": "mereborn",
};
export const peopleForVillager = (title: string): PeopleChoice => VILLAGER_PEOPLE[title] ?? "mereborn";

/**
 * HOOK 3: the picked people of a person at a seed: a wayfarer resolves to one of the mix, anyone else to themselves. Pure; the SAME answer on the server (NPC looks) and in the
 * client (villagers), so a person is who they are for everybody.
 */
export function resolvePeople(p: PeopleId, seed: number): Exclude<PeopleId, "wayfarers"> {
  if (p !== "wayfarers") return p;
  const h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return WAYFARER_MIX[h % WAYFARER_MIX.length] as Exclude<PeopleId, "wayfarers">;
}
