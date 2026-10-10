import type { CampaignState, RegionId, ResolutionId, ScenarioTemplateId } from "./campaignTypes.ts";
import { LIMB_NAMES, type LimbId } from "./limbs.ts";
import { hash3 } from "./rng.ts";
import { TERMS, outcomeKind } from "./scenarios/terms.ts";

/**
 * D-084, THE SOCIETY'S APPETITES. The contracts played as errands: walk there, talk to him, carry that, mind the clock. The violence was there (limbs, blasts, bodies
 * thrown by powder) but nothing in the game noticed it, so nothing invited it. Three things now do, all pure and deterministic here, fed by the room from facts it already
 * has (who was hit, by whom, with what, where, whether a limb came off, how hard a blast threw them):
 *
 *  - THE GAZETTE: a dry casualty column in the corner of the screen. Only the notable gets a line (a limb, a body thrown, a keg chain, a colleague shot, a bystander,
 *    an enemy felled by an umbrella), at most one every couple of seconds, the best of each moment.
 *  - THE BUTCHER'S BILL: the run's spectacle, counted (limbs, flights and the longest, kegs and the longest chain, heads, colleagues shot), printed in the debrief
 *    and in the paper; and the Committee for Remittances, which already pays by the column-inch (D-040), pays a capped SPECTACLE SUPPLEMENT for it.
 *  - SOCIETY REQUESTS: every contract comes with one optional, ridiculous commission from one of the Society's learned bodies ("a man thrown twelve yards, for the
 *    Royal Ballistic Society"), shown as an optional objective with its progress, paid on the commit. A contract that is all talk (the mine, the market) draws from
 *    the quiet ones (not a shot fired; nobody down; done inside five minutes).
 *
 * The satire is the Society's, not the game's: an institution that rewards spectacle and calls it science. No line names a real place or people (noRealWorld.test.ts).
 */

/** How the harm was done (from the weapon, or the room's own sources). */
export type Cause = "shot" | "blade" | "brolly" | "fists" | "blast" | "horse";

/** The run's spectacle. All counts; `longestWho` is a display name (capped). */
export interface Bill {
  /** Enemies the party put down (anyone neither of the party nor a bystander). */
  foes: number;
  /** Bystanders the party put down. */
  civilians: number;
  /** Limbs off anyone not of the party (blade, shot or powder), and of those, by a sabre. */
  limbs: number;
  bladeLimbs: number;
  /** The party's own losses. */
  ownLimbs: number;
  /** Enemies the party put down with a blow to the head. */
  headshots: number;
  /** Bodies a blast threw at least `FLING_YARDS`, the longest flight, and whose. */
  flings: number;
  longest: number;
  longestWho: string;
  /** Kegs gone up, and the most in one chain. */
  kegs: number;
  chain: number;
  /** Hits by the party on the party. */
  friendly: number;
  /** Members of the party who went down. */
  partyDowns: number;
  /** Rounds the party fired. */
  shots: number;
  /** Enemies the party put down with an umbrella. */
  brolly: number;
  /** D-105: enemies the party finished with a blow while they were down on a knee or doubled over. */
  finishers: number;
}

export const newBill = (): Bill => ({ foes: 0, civilians: 0, limbs: 0, bladeLimbs: 0, ownLimbs: 0, headshots: 0, flings: 0, longest: 0, longestWho: "", kegs: 0, chain: 0, friendly: 0, partyDowns: 0, shots: 0, brolly: 0, finishers: 0 });

/** A blast that throws a body this far (yards) makes the column and counts as a flight. */
export const FLING_YARDS = 7;

/**
 * How far a body a blast threw will fly, in yards: the same launch the clients give the ragdoll (Ragdoll.ts: horizontal (1 + 3.2 power)(1 + 1.3 lift) m/s, vertical
 * 1 + 1.6 power + 5.75 lift m/s) carried to the ground. The Society's surveyor measures it; the clients see it.
 */
export function flightYards(power: number, lift: number): number {
  const p = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
  const l = Math.max(0, Math.min(1, Number.isFinite(lift) ? lift : 0));
  const h = (1 + 3.2 * p) * (1 + 1.3 * l);
  const vy = 1 + 1.6 * p + 5.75 * l;
  return Math.round(((h * 2 * vy) / 9.81) * 1.0936);
}

/** The compass point a direction (dx, dz) faces: -z is north. */
export function compassPoint(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i]!;
}

// ---- the gazette ------------------------------------------------------------------------------------------------------------------------

/** One notable moment, as the room saw it. Names are display names; `by` "" means nobody's hand (the powder, a horse). */
export type MayhemFact =
  | { k: "sever"; victim: string; limb: LimbId; by: string; cause: Cause; party: boolean; dir: string }
  | { k: "fling"; victim: string; yards: number; by: string; party: boolean }
  | { k: "headshot"; victim: string; by: string }
  | { k: "chain"; kegs: number; by: string }
  | { k: "friendly"; victim: string; by: string }
  | { k: "civilian"; victim: string; by: string }
  | { k: "brolly"; victim: string; by: string }
  | { k: "double"; by: string; n: number }
  | { k: "finisher"; victim: string; by: string }
  | { k: "request"; id: RequestId };

/** When several land at once (a blast), the best is printed: a commission met, a chain, a limb, a flight... */
export const FACT_RANK: Readonly<Record<MayhemFact["k"], number>> = { request: 9, chain: 8, sever: 7, brolly: 7, fling: 6, finisher: 6, friendly: 5, double: 4, headshot: 3, civilian: 2 };

const GAZ: Readonly<Record<Exclude<MayhemFact["k"], "request"> | "severPowder" | "severOwn" | "flingOwn", readonly string[]>> = {
  sever: [
    "{by} has relieved {victim} of the {limb}. The {limb} was not consulted.",
    "{victim} and the {limb} have parted company, at {by}'s insistence.",
    "{by} reports a specimen for the Museum: one {limb}, late of {victim}.",
    "{victim}'s {limb} has gone on ahead, {dir}.",
    "{by} takes {victim}'s {limb} in the name of the Empire. A receipt will follow.",
  ],
  severPowder: [
    "The powder has redistributed {victim}. The {limb} was last seen heading {dir}.",
    "{victim}'s {limb} has gone on ahead, {dir}, without waiting for the rest.",
    "{victim} is short one {limb}. The powder declines to comment.",
  ],
  severOwn: [
    "{victim} has mislaid the {limb}. The Society's insurers are reading the small print.",
    "{victim} is down to three limbs and in excellent spirits, according to {victim}.",
  ],
  fling: [
    "{victim} has flown {yards} yards: a regional record for the unwilling.",
    "{victim} leaves the ground at {by}'s expense. {yards} yards, and a poor landing.",
    "The Society's surveyor measures {victim}'s flight at {yards} yards and asks for it again.",
    "{victim} has been sent {yards} yards in the general direction of London.",
  ],
  flingOwn: [
    "{victim} has been sent {yards} yards by the Society's own powder, and is reviewing the arrangement.",
    "{victim} flies {yards} yards. The Society will describe this as a reconnaissance.",
  ],
  headshot: [
    "{by} has settled the question of {victim}'s hat.",
    "{victim} has been struck in the opinions by {by}.",
    "{by} parts {victim}'s hair, permanently.",
    "{by} removes {victim}'s hat for the Empire. The head went with it.",
  ],
  chain: [
    "{Kegs} kegs went up in a ripple. The Ordnance Board will want it in writing.",
    "A chain of {kegs} kegs: {by} calls it an experiment in sequence.",
    "{Kegs} kegs in succession. The road has been rearranged and the birds have left the district.",
    "{Kegs} kegs at once: the loudest thing done in the Empire's name this week. Rule, Britannia.",
  ],
  friendly: [
    "{by} has shot {victim}. The Society notes the enthusiasm.",
    "{victim} has been downed by {by}, who describes {victim} as a colleague.",
    "{by} and {victim} have had a disagreement. {by} won it.",
    "{by} has shot {victim}, but in a very British manner, and apologised.",
  ],
  civilian: [
    "{victim}, a bystander, is entered in the ledger under 'regrettable'.",
    "{victim} was standing nearby. The Society's position is that this was {victim}'s own idea.",
  ],
  brolly: [
    "{by} has felled {victim} with an umbrella. The Umbrella Makers' Company is beside itself.",
    "{victim} has been put down by {by}'s umbrella, closed. Imagine it open.",
    "{by} fells {victim} with a British umbrella. Pall Mall is beside itself.",
  ],
  finisher: [
    "{by} has administered the coup de grâce to {victim}, with a little bow.",
    "{victim} was already on the way down. {by} saw to the rest.",
    "{by} finishes {victim} in the manner of a gentleman: from close, and without a word.",
    "{victim} has been finished off by {by}. The Society calls it tidiness.",
  ],
  double: [
    "{by} has dropped {n} in as many seconds. The Committee for Remittances leans forward.",
    "{n} down in a breath, by {by}. Somebody fetch the Gazette's artist.",
    "{Nn} down in a breath, by {by}. Rule, Britannia.",
  ],
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** A count as the column sets it: in words to twelve, figures beyond. */
const numberWord = (n: number): string => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n]! : String(n));
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (t: string, v: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
/** A display name as the column prints it (a blank one is a person all the same). */
const who = (s: string): string => (s.trim() === "" ? "a stranger" : s.trim().slice(0, 40));

/** The line the column prints for a fact; `salt` picks among the phrasings (deterministic per moment). */
export function gazetteLine(f: MayhemFact, salt: number): string {
  if (f.k === "request") return REQUESTS[f.id].met;
  const pick = (list: readonly string[]): string => list[hash3(salt >>> 0, list.length, 0x6a2) % list.length]!;
  switch (f.k) {
    case "sever": {
      const list = f.party ? GAZ.severOwn : f.cause === "blast" || f.by === "" ? GAZ.severPowder : GAZ.sever;
      return fill(pick(list), { victim: who(f.victim), by: who(f.by), limb: LIMB_NAMES[f.limb], dir: f.dir });
    }
    case "fling":
      return fill(pick(f.party || f.by === "" ? GAZ.flingOwn : GAZ.fling), { victim: who(f.victim), by: who(f.by), yards: f.yards });
    case "chain":
      return fill(pick(GAZ.chain), { kegs: numberWord(f.kegs), Kegs: capital(numberWord(f.kegs)), by: f.by === "" ? "the powder" : who(f.by) });
    case "double":
      return fill(pick(GAZ.double), { by: who(f.by), n: numberWord(f.n), Nn: capital(numberWord(f.n)) });
    default:
      return fill(pick(GAZ[f.k]), { victim: who(f.victim), by: who(f.by) });
  }
}

// ---- Society requests ------------------------------------------------------------------------------------------------------------------

export type RequestId = "flight" | "chain" | "limbs" | "fencing" | "hats" | "brolly" | "temperance" | "insurers" | "punctual";
export const REQUEST_IDS: readonly RequestId[] = ["flight", "chain", "limbs", "fencing", "hats", "brolly", "temperance", "insurers", "punctual"];

/** What a finished run looked like, for the quiet commissions (`loot` tells the Crown sold for the party's cheque from the Crown sold for want of anyone settling it). */
export interface RunEnd { resolution: ResolutionId; seconds: number; loot?: number }

interface RequestDef {
  /** Who asks, and for what, in the player's words (D-086: what counts is in the words: "armed", "not your own", "win"). */
  ask: string;
  progress: (b: Bill) => string;
  done: (b: Bill, end?: RunEnd) => boolean;
  reward: number;
  /** The gazette's line when it is met. */
  met: string;
  /** The paper's line, met. */
  paper: string;
  /** Quiet: open to the contracts that are all talk, and settled only when the run ends. */
  quiet: boolean;
  /** Powder it needs in reach (a chain of three needs three kegs; a flight needs a blast). */
  kegs: number;
}

/** D-086: a quiet commission is for a contract WON (it paid on any ending but abandonment: a border lost to the party's own first shot at ten seconds was "settled inside five minutes"). */
const won = (end?: RunEnd): boolean => end !== undefined && outcomeKind(end) === "won";

export const REQUESTS: Readonly<Record<RequestId, RequestDef>> = {
  flight: {
    ask: "Royal Ballistic Society: blow a man twelve yards", progress: (b) => (b.longest > 0 ? `best ${b.longest} yds` : ""), done: (b) => b.longest >= 12, reward: 20, quiet: false, kegs: 1,
    met: "The Royal Ballistic Society has its twelve yards, and wants to know how. £20 on account.",
    paper: "The Royal Ballistic Society thanks the expedition for a flight of {longest} yards, which it will be lecturing on.",
  },
  chain: {
    ask: "Ordnance Board: set off three powder kegs in one chain", progress: (b) => (b.chain > 0 ? `best ${b.chain}` : ""), done: (b) => b.chain >= 3, reward: 20, quiet: false, kegs: 3,
    met: "The Ordnance Board has its three-keg chain and has stopped its ears. £20 on account.",
    paper: "The Ordnance Board records a chain of {chain} kegs and has asked that the experiment not be repeated near its offices.",
  },
  limbs: {
    ask: "Museum of Comparative Anatomy: two limbs, not your own", progress: (b) => `${Math.min(b.limbs, 2)} of 2`, done: (b) => b.limbs >= 2, reward: 20, quiet: false, kegs: 0,
    met: "The Museum of Comparative Anatomy has its limbs. A receipt is in the post. £20 on account.",
    paper: "The Museum of Comparative Anatomy acknowledges {limbs} limbs from the field, labelled in the expedition's own hand.",
  },
  fencing: {
    ask: "Fencing Club's wager: take a limb off with your sabre", progress: () => "", done: (b) => b.bladeLimbs >= 1, reward: 25, quiet: false, kegs: 0,
    met: "The Fencing Club has lost its wager and pays up, with bad grace. £25 on account.",
    paper: "The Fencing Club has settled a wager on the expedition's swordsmanship, and resigned the member who proposed it.",
  },
  hats: {
    ask: "Hatters' Guild: drop three armed men with head shots", progress: (b) => `${Math.min(b.headshots, 3)} of 3`, done: (b) => b.headshots >= 3, reward: 20, quiet: false, kegs: 0,
    met: "The Hatters' Guild has its three vacancies. £20 on account.",
    paper: "The Hatters' Guild reports a brisk trade following the expedition, and sends its compliments.",
  },
  brolly: {
    ask: "Umbrella Makers: knock down an armed man with your umbrella", progress: () => "", done: (b) => b.brolly >= 1, reward: 25, quiet: false, kegs: 0,
    met: "The Umbrella Makers' Company has its testimonial. £25 on account.",
    paper: "The Umbrella Makers' Company has commissioned a print of the expedition's umbrella, closed, in action.",
  },
  temperance: {
    ask: "Temperance & Quietude League: win without firing a shot", progress: (b) => (b.shots > 0 ? "a shot was fired" : "so far, so quiet"), done: (b, end) => won(end) && b.shots === 0, reward: 25, quiet: true, kegs: 0,
    met: "The Temperance & Quietude League is satisfied, quietly. £25 on account.",
    paper: "The Temperance & Quietude League commends an expedition that fired no shot, and has printed the fact very small.",
  },
  insurers: {
    ask: "The Society's insurers: win with nobody in the party down", progress: (b) => (b.partyDowns > 0 ? "somebody went down" : "all upright"), done: (b, end) => won(end) && b.partyDowns === 0, reward: 15, quiet: true, kegs: 0,
    met: "The Society's insurers pay a bonus for an expedition still upright, and look for the catch. £15 on account.",
    paper: "The Society's insurers report an expedition that came home on its feet, a result they are investigating.",
  },
  punctual: {
    ask: "Board of Punctuality: win inside five minutes", progress: () => "", done: (_b, end) => won(end) && end!.seconds <= 300, reward: 15, quiet: true, kegs: 0,
    met: "The Board of Punctuality has its five minutes, and a little change. £15 on account.",
    paper: "The Board of Punctuality has timed the expedition and found it satisfactory, a word it uses twice a decade.",
  },
};

/**
 * Contracts that get only the quiet commissions: those where fighting loses the contract (the border, the saleroom: D-086, the Society used to ask for two limbs at a
 * border the party lost by its first shot), the mine, a rescue, where the loud ones would be met on the men the party came for, and the survey (D-096), where nobody is armed.
 */
export const quietOnly = (template: ScenarioTemplateId): boolean => TERMS[template].fighting === "forbidden" || template === "mine_rescue" || template === "triangulation";

/** The commission for a run: deterministic in (seed, day, template); never the one the last run was dealt, never one the contract forbids or has no powder for (`kegs` in reach). */
export function dealRequest(seed: number, day: number, template: ScenarioTemplateId, last?: RequestId, kegs = 3): RequestId {
  const pool = REQUEST_IDS.filter((id) => (quietOnly(template) ? REQUESTS[id].quiet : true) && REQUESTS[id].kegs <= kegs && id !== last);
  return pool[hash3(seed >>> 0, day, 0x5e1 + template.length) % pool.length]!;
}

/** The commission as the orders card shows it: the money first (it is a bonus, not the contract), then who asks and what for, then how it stands. */
export function requestLine(id: RequestId, progress = ""): string {
  const r = REQUESTS[id];
  return `£${r.reward} bonus · ${r.ask}${progress ? ` (${progress})` : ""}`;
}

// ---- the spectacle supplement, the debrief, the paper -------------------------------------------------------------------------------

/** The Committee's cap on spectacle (it pays for a story, not a war). */
export const SPECTACLE_CAP = 30;

/** What the Committee for Remittances adds for the spectacle (pounds, capped) and the line it sends; 0 and "" for a dull run. */
export function spectacle(b: Bill): { pay: number; line: string } {
  const raw = 3 * b.limbs + 2 * b.flings + (b.chain >= 3 ? 6 : b.chain >= 2 ? 3 : 0) + b.headshots + 4 * b.brolly + 2 * (b.finishers ?? 0);
  const pay = Math.min(SPECTACLE_CAP, raw);
  if (pay <= 0) return { pay: 0, line: "" };
  return { pay, line: `The Committee adds £${pay} for spectacle${pay === SPECTACLE_CAP ? ", the most it will pay for anything it has to print with a warning" : ""}. London wants more of this.` };
}

const plural = (n: number, one: string, many: string): string => `${n === 0 ? "no" : n} ${n === 1 ? one : many}`;

/** The Butcher's Bill as the debrief prints it: one line, only what happened ("" for a run with nothing to bill). */
export function billLine(b: Bill): string {
  const parts: string[] = [];
  if (b.limbs > 0) parts.push(plural(b.limbs, "limb", "limbs"));
  if (b.flings > 0) parts.push(`${plural(b.flings, "flight", "flights")} (the longest ${b.longest} yards, ${who(b.longestWho)})`);
  if (b.kegs > 0) parts.push(`${plural(b.kegs, "keg", "kegs")}${b.chain >= 2 ? ` (a chain of ${b.chain})` : ""}`);
  if (b.headshots > 0) parts.push(plural(b.headshots, "hat vacated", "hats vacated"));
  if (b.brolly > 0) parts.push(plural(b.brolly, "man umbrella'd", "men umbrella'd"));
  if ((b.finishers ?? 0) > 0) parts.push(plural(b.finishers, "coup de grâce", "coups de grâce"));
  if (b.friendly > 0) parts.push(plural(b.friendly, "colleague shot", "colleagues shot"));
  if (b.civilians > 0) parts.push(plural(b.civilians, "bystander", "bystanders"));
  if (b.ownLimbs > 0) parts.push(`${plural(b.ownLimbs, "limb", "limbs")} of our own`);
  return parts.length ? `The Butcher's Bill: ${parts.join("; ")}.` : "";
}

/** What the commit keeps for the paper (`sites.lastBill`): the bill, the commission and whether it was met, the supplement paid. */
export interface BillRecord { day: number; region: RegionId; bill: Bill; request: RequestId; met: boolean; spectacle: number }

/** The paper's spectacle story, when the record belongs to the expedition being reported and there was something to report. */
export function billStory(c: CampaignState): { head: string; body: string } | undefined {
  const r = c.sites.lastBill;
  const latest = c.history[c.history.length - 1];
  if (!r || !latest || r.day !== latest.day) return undefined;
  const b = r.bill;
  const loud = b.limbs + b.flings + b.kegs + b.headshots + b.brolly + b.friendly;
  const req = REQUESTS[r.request];
  const thanks = r.met ? fill(req.paper, { longest: b.longest, chain: b.chain, limbs: b.limbs }) : "";
  if (loud === 0 && !r.met) return undefined;
  const head = b.limbs >= 3 || b.chain >= 3 ? "BRITANNIA TRIUMPHANT: SOCIETY MEN IN SPIRITED ENGAGEMENT" : b.flings > 0 ? "LOCAL MAN ACHIEVES FLIGHT" : b.friendly > 0 ? "EXPEDITION RESOLVES INTERNAL DIFFERENCES" : loud > 0 ? "A LIVELY AFTERNOON" : "LEARNED BODIES SATISFIED";
  const facts = billLine(b).replace("The Butcher's Bill: ", "The surgeon's tally: ");
  return { head, body: `${facts}${facts && thanks ? " " : ""}${thanks}`.trim() };
}

/** Validates a saved record (an unknown request, a bad region or a malformed bill drops it: the field is optional). Never throws. */
export function parseBillRecord(raw: unknown, isRegion: (r: unknown) => r is RegionId): BillRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const request = REQUEST_IDS.find((x) => x === r.request);
  if (!request || !isRegion(r.region) || typeof r.bill !== "object" || r.bill === null) return undefined;
  const src = r.bill as Record<string, unknown>;
  const bill = newBill();
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(9999, Math.round(v))) : 0);
  for (const k of Object.keys(bill) as (keyof Bill)[]) {
    if (k === "longestWho") bill.longestWho = typeof src.longestWho === "string" ? src.longestWho.slice(0, 40) : "";
    else bill[k] = num(src[k]);
  }
  return { day: num(r.day), region: r.region, bill, request, met: r.met === true, spectacle: Math.min(SPECTACLE_CAP, num(r.spectacle)) };
}
