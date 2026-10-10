import type { CampaignState, IncidentId, IncidentRecord, IncidentResult, RegionId, ScenarioTemplateId } from "./campaignTypes.ts";
import { NPC } from "./campaignTypes.ts";
import type { NpcSpec } from "./expeditionTypes.ts";
import { PACING } from "./pacing.ts";
import { hash3 } from "./rng.ts";
import { WEAPON } from "./weapons.ts";
import { TERMS } from "./scenarios/terms.ts";
import type { MinorPowerId, PowersState } from "./worldTypes.ts";

/**
 * INCIDENTS (D-052, docs/_notes/incidents.md): chaos DURING play. The complication (chaos.ts) is dealt as a contract starts and is part of its plan; an incident is
 * one small, separate thing that happens partway through, near the party, out of the fight's way: a wounded traveller on the path, a courier with a dispatch, a deserter
 * with his hands up. At most one per run, never the same one twice running. Everything here is pure (the server's `systems/Incidents.ts` spawns, watches and routes the
 * presses); its result rides on the contract's outcome and is committed with it.
 */
export type { IncidentId, IncidentRecord, IncidentResult };
export const INCIDENT_IDS: readonly Exclude<IncidentId, "none">[] = ["wounded_traveller", "courier", "deserter", "runaway_horse", "powder_wagon", "syndicate_collectors"];
export const INCIDENT_RESULTS: readonly IncidentResult[] = ["helped", "passed_by", "delivered", "missed", "enlisted", "turned_away", "caught", "strayed", "salvaged", "went_up", "repelled", "collected"];

export const INCIDENT = {
  /** Seconds of the run before it may happen, and how long the party must have gone without hostilities. */
  delayMinS: 45, delayMaxS: 110, calmS: 20, // (D-084: sooner, from 60..150: the road should get interesting before the contract does)
  /** How far from the party's centre it is placed (metres), and how far from any hostile it should be. */
  distMin: 22, distMax: 32, clearOfHostiles: 18,
  /** The Society's arrears the courier carries (pounds), and the trust a helped traveller earns with the region's home power. */
  courierPay: 15, helpedTrust: 4,
  /** The owner's reward for a runaway horse caught (pounds). */
  horseReward: 10,
  /** Metres from an incident's person inside which a press of USE is taken (the server's rule and the client's prompt). */
  useR: 2.6,
  /**
   * D-071: the overturned powder wagon. Its kegs spill in a ring this wide (metres) round the wreck; one of them is already fizzing on a fuse this long (seconds: time to see it, run
   * in, pick it up and throw it clear); the powder is "salvaged" when at least this many kegs are still on the road when the fuse is out, else the road "went up".
   */
  wagonKegs: 5, wagonRing: 1.7, wagonFuseS: 14, wagonSalvage: 3,
  /**
   * D-088: the Syndicate's collectors, armed (the Syndicate arrives with rifles rather than a cheque). Three of them, and their powder cart (kegs, unlit) behind them;
   * their collection bag (pounds) is the Society's when they are seen off, what they take from the purse when the contract ends first, and the grudge it costs.
   */
  collectors: 3, collectorKegs: 3, collectorBag: 20, collectorTake: 15, collectorGrudge: 4,
  /**
   * They halt this far from the party (metres), beside their cart, and read out the invoice for this long (seconds) before they open fire, unless somebody hurts one of
   * them first: the first browser run had three of them walk straight in and drop a lone player in five seconds, which ended the contract before it was a decision.
   */
  collectorStandM: 11, collectorDemandS: 10,
  /** About one run in five is quiet: the weight of "none" against each incident (D-084: 1, from 4; half the runs had nothing happen on the road, and the owner found the contracts stale). */
  noneWeight: 1, entryWeight: 1,
} as const;

/**
 * D-071: who a blast nobody set off is credited to (the overturned wagon's powder). An NPC-shaped key, so no contract reads it as the party's declaration of war; the room's war
 * rules treat it as hostile to everybody (an accident respects no side).
 */
export const ACCIDENT_OWNER = "npc:accident";

/** Each region's home power, whose trust a kindness on its roads earns (Kessar's is the Ward, kept on the campaign itself). */
export const HOME_POWER: Readonly<Record<RegionId, "ward" | MinorPowerId | undefined>> = { hollowmere: undefined, kessar: "ward", highmark: "reapers", vesper: "choir", saltmarket: "brine" };
/** A local of each region (their own people come with the role: peoples.ts `peopleForNpc`). */
const LOCAL_ROLE: Readonly<Record<RegionId, number>> = { hollowmere: NPC.DRIVER, kessar: NPC.DRIVER, highmark: NPC.HERDER, vesper: NPC.MINER, saltmarket: NPC.BARGEMAN };

const TAG: Record<ScenarioTemplateId, number> = { secure_crossing: 1, hostage_rescue: 2, convoy_ambush: 3, border_incident: 4, succession_dispute: 5, mine_rescue: 6, claim_race: 7, smuggling_run: 8, flooded_market: 9, reapers_strike: 10, winding_engine: 11, outpost_raid: 12, lost_survey: 13, great_grey: 14, counting_house: 15, triangulation: 16 };

/** The incident this run will carry ("none": a quiet run). Deterministic from the campaign seed, the day and the template; the last one is never dealt again. */
export function dealIncident(c: CampaignState, template: ScenarioTemplateId, region: RegionId, seed: number): IncidentId {
  if (region === "hollowmere" || HOME_POWER[region] === undefined) return "none";
  const last = c.sites.lastIncident?.id;
  const pool = INCIDENT_IDS.filter((id) => id !== last && (id !== "syndicate_collectors" || collectorsWelcome(template)));
  const total = INCIDENT.noneWeight + pool.length * INCIDENT.entryWeight;
  let roll = hash3(seed >>> 0, Math.max(0, Math.round(c.day)), 0x1ac1d, TAG[template]) % total;
  if (roll < INCIDENT.noneWeight) return "none";
  roll -= INCIDENT.noneWeight;
  return pool[Math.floor(roll / INCIDENT.entryWeight)]!;
}

/**
 * D-088: where the armed collectors may call. Not where fighting loses the contract (the rule says one shot loses, D-086), not where a site listens for shots (the cage,
 * the barge, the border: their gunfire would raise an alarm the party did not raise, against the stated rule), and not at the mine (a rescue).
 */
export const COLLECTORS_BARRED: ReadonlySet<ScenarioTemplateId> = new Set<ScenarioTemplateId>(["hostage_rescue", "smuggling_run", "border_incident", "mine_rescue"]);
export const collectorsWelcome = (template: ScenarioTemplateId): boolean => TERMS[template].fighting !== "forbidden" && !COLLECTORS_BARRED.has(template);

/** Seconds into the run it may fire (it then also waits for calm). */
export const incidentDelayS = (c: CampaignState, template: ScenarioTemplateId, seed: number): number =>
  INCIDENT.delayMinS + (hash3(seed >>> 0, Math.max(0, Math.round(c.day)), 0xde1a, TAG[template]) % (INCIDENT.delayMaxS - INCIDENT.delayMinS + 1));

/**
 * Is the run's incident due? `t` seconds into the run, its dealt `delay`, `calm` seconds without hostilities. D-107: a party the pacing director finds COASTING meets it
 * from `PACING.incidentMinS` instead of waiting out the delay, and none starts while the run is PRESSED (at its height or easing off).
 */
export function incidentDue(t: number, delay: number, calm: number, coasting: boolean, pressed: boolean): boolean {
  if (pressed || !(calm >= INCIDENT.calmS)) return false;
  return t >= delay || (coasting && t >= PACING.incidentMinS);
}

/**
 * Where it happens: on one of eight bearings from the party's centre, 22..32 m out, the first open spot in the bounds; of those, the one farthest from every hostile
 * (preferring any clear of them by `clearOfHostiles`). Undefined when nothing is open (it then does not happen: never in a wall).
 */
export function placeIncident(party: { x: number; z: number }, hostiles: readonly { x: number; z: number }[], open: (x: number, z: number) => boolean, bounds: number, seed: number): { x: number; z: number } | undefined {
  let best: { x: number; z: number } | undefined;
  let bestScore = -1;
  const turn = (hash3(seed >>> 0, 0x91ace, 0) % 8) * (Math.PI / 4);
  for (let b = 0; b < 8; b++) {
    const a = turn + (b * Math.PI) / 4;
    for (const d of [INCIDENT.distMin, (INCIDENT.distMin + INCIDENT.distMax) / 2, INCIDENT.distMax]) {
      const x = party.x + Math.sin(a) * d;
      const z = party.z + Math.cos(a) * d;
      if (Math.hypot(x, z) > bounds - 4 || !open(x, z)) continue; // (a region is a disc: REGIONS[r].bounds)
      let near = Infinity;
      for (const h of hostiles) near = Math.min(near, Math.hypot(h.x - x, h.z - z));
      const score = Math.min(near, 200);
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
      break; // (the nearest open distance on this bearing stands for it)
    }
  }
  return best;
}

/**
 * Where an incident's kegs lie: `n` round `at` on a ring of radius `ring`, the first at bearing `turn`. Each stands on open ground (`open`): where the ring meets a
 * wall, a tree or the water, its keg slides along the ring (a quarter and a half radian either way) to the nearest open spot clear of the others, or is left out
 * (a keg is never spawned half inside a wall: the physics would fling it out). Deterministic.
 */
export function kegRing(at: { x: number; z: number }, n: number, ring: number, turn: number, open: (x: number, z: number) => boolean): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = turn + (k / n) * Math.PI * 2;
    for (const da of [0, 0.25, -0.25, 0.5, -0.5]) {
      const x = at.x + Math.cos(a + da) * ring, z = at.z + Math.sin(a + da) * ring;
      if (!open(x, z) || out.some((p) => Math.hypot(p.x - x, p.z - z) < KEG_GAP)) continue;
      out.push({ x, z });
      break;
    }
  }
  return out;
}
/** True when the whole ring of radius `ring` round `at` is open ground (sixteen bearings): room for a spill of kegs, every one where it falls. */
export function ringOpen(at: { x: number; z: number }, ring: number, open: (x: number, z: number) => boolean): boolean {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (!open(at.x + Math.cos(a) * ring, at.z + Math.sin(a) * ring)) return false;
  }
  return true;
}
/** The least distance between two spilled kegs' middles (m): a keg is 0.64 across. */
const KEG_GAP = 0.7;

/** The people of an incident (group "incident"). The wounded traveller is spawned standing and the server lays them down. */
export function incidentRoster(id: IncidentId, at: { x: number; z: number }, region: RegionId, seed: number, party = 4): NpcSpec[] {
  const look = (k: number): number => hash3(seed >>> 0, k, 0x1c1d) >>> 0;
  const base = { faction: "ward" as const, side: "neutral" as const, group: "incident", post: { x: at.x, z: at.z }, weapon: WEAPON.FISTS, skill: 10, bravery: 20, brain: "civil" as const };
  const pick = (names: readonly string[], k: number): string => names[hash3(seed >>> 0, k, 0xa11e) % names.length]!;
  switch (id) {
    case "wounded_traveller":
      return [{ ...base, id: "incident-traveller", role: LOCAL_ROLE[region], lookSeed: look(1), name: pick(TRAVELLER_NAMES, 1) }];
    case "courier":
      return [{ ...base, id: "incident-courier", role: NPC.DRIVER, lookSeed: look(2), name: pick(COURIER_NAMES, 2) }];
    case "deserter":
      return [{ ...base, id: "incident-deserter", role: NPC.DESERTER, lookSeed: look(3), name: pick(DESERTER_NAMES, 3) }];
    case "runaway_horse":
      return []; // (no person: the incident is a horse, spawned by the server's mounts; see `horseName`)
    case "powder_wagon":
      return []; // (no person: the incident is the Syndicate's kegs, spilled by the server; see `wagonName`)
    case "syndicate_collectors": {
      // three armed men on the Syndicate's side, in a loose line abreast; the server orders them at the party
      const arms = [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.BLUNDERBUSS] as const;
      // (one more than the party standing, two to three: a lone player meets two)
      return Array.from({ length: Math.max(2, Math.min(INCIDENT.collectors, party + 1)) }, (_, i) => ({
        ...base, id: `incident-collector-${i}`, faction: "rival" as const, side: "rival" as const, role: NPC.RIVAL_GUARD, brain: "garrison" as const, weapon: arms[i % arms.length]!,
        skill: 28, bravery: 35, lookSeed: look(10 + i), name: pick(COLLECTOR_NAMES, 10 + i * 7), post: { x: at.x + (i - 1) * 1.6, z: at.z },
      }));
    }
    default:
      return [];
  }
}

/** The row ids of the people a press of USE is for (the traveller is revived the ordinary way). */
export const INCIDENT_USE_IDS: Readonly<Record<string, Exclude<IncidentId, "none">>> = { "incident-courier": "courier", "incident-deserter": "deserter" };

/** What happened to it. `revived`, `use` and `shot` come from the server; `end` is the contract ending (or the party sailing) before the party acted. */
export type IncidentEvent = { t: "revived" } | { t: "use"; room: boolean } | { t: "shot" } | { t: "end" } | { t: "mounted" } | { t: "kegs"; left: number } | { t: "broken" };

/** The result an event settles, or undefined (it goes on). `room` on `use`: whether the roster has room for the deserter. */
export function incidentStep(id: Exclude<IncidentId, "none">, e: IncidentEvent): IncidentResult | undefined {
  switch (id) {
    case "wounded_traveller":
      return e.t === "revived" ? "helped" : e.t === "shot" || e.t === "end" ? "passed_by" : undefined;
    case "courier":
      return e.t === "use" ? "delivered" : e.t === "shot" || e.t === "end" ? "missed" : undefined;
    case "deserter":
      return e.t === "use" ? (e.room ? "enlisted" : "turned_away") : e.t === "shot" || e.t === "end" ? "turned_away" : undefined;
    case "runaway_horse":
      return e.t === "mounted" ? "caught" : e.t === "end" ? "strayed" : undefined;
    case "powder_wagon":
      // (`kegs` is told once no fuse burns among them: how many are still on the road. A contract ending with the fuse still lit leaves the road to its fate)
      return e.t === "kegs" ? (e.left >= INCIDENT.wagonSalvage ? "salvaged" : "went_up") : e.t === "end" ? "went_up" : undefined;
    case "syndicate_collectors":
      // seen off (every collector down or running) before the contract ends, or still collecting when it does
      return e.t === "broken" ? "repelled" : e.t === "end" ? "collected" : undefined;
  }
}

/** The campaign and the powers after an incident (pure): the courier's arrears, a helped traveller's goodwill with the home power, and the record for the paper. */
export function applyIncident(c: CampaignState, p: PowersState, r: IncidentRecord): { c: CampaignState; p: PowersState } {
  let nc: CampaignState = { ...c, sites: { ...c.sites, lastIncident: { ...r } } };
  let np = p;
  if (r.result === "delivered") nc = { ...nc, purse: Math.min(99999, nc.purse + INCIDENT.courierPay) };
  if (r.result === "caught") nc = { ...nc, purse: Math.min(99999, nc.purse + INCIDENT.horseReward) };
  if (r.result === "repelled") {
    nc = { ...nc, purse: Math.min(99999, nc.purse + INCIDENT.collectorBag) };
    np = { ...np, rival: { ...np.rival, grudge: Math.min(100, np.rival.grudge + INCIDENT.collectorGrudge) } };
  }
  if (r.result === "collected") nc = { ...nc, purse: Math.max(0, nc.purse - INCIDENT.collectorTake) };
  if (r.result === "helped") {
    const home = HOME_POWER[r.region];
    if (home === "ward") nc = { ...nc, factions: { ...nc.factions, ward: { ...nc.factions.ward, trust: Math.min(100, nc.factions.ward.trust + INCIDENT.helpedTrust) } } };
    else if (home) np = { ...np, minor: { ...np.minor, [home]: { ...np.minor[home], trust: Math.min(100, np.minor[home].trust + INCIDENT.helpedTrust) } } };
  }
  return { c: nc, p: np };
}

// ---- copy (authored; registered in docs/AI_CONTENT_REGISTER.md) ------------------------------------------------------------------------------------------------

const TRAVELLER_NAMES = ["Old Tamsin Rook", "Bettany Quill", "Ezer Hollin", "Mag Fennick", "Tobiah Drane"] as const;
const COURIER_NAMES = ["Runner Pell", "Runner Abernathy", "Runner Quist", "Runner Lugg"] as const;
const HORSE_NAMES = ["a mare called Patience", "a gelding called Mr. Pemberton", "a cob called Second Opinion", "a horse called Arrears"] as const;   // (no colours: the coat is drawn from the seed, and a telegram calling a dun "piebald" was the first look's)
const WAGON_NAMES = ["the Syndicate's Number Four wagon", "a Syndicate wagon marked FRAGILE, DO NOT", "a wagon of the Syndicate's Blasting Department", "the Syndicate's improvement wagon"] as const;
/** The powder wagon's name for the notices (it has no row: it is kegs). */
export const wagonName = (seed: number): string => WAGON_NAMES[hash3(seed >>> 0, 5, 0xa11e) % WAGON_NAMES.length]!;
/** The runaway horse's name for the notices (it has no row of its own: it is a mount). */
export const horseName = (seed: number): string => HORSE_NAMES[hash3(seed >>> 0, 4, 0xa11e) % HORSE_NAMES.length]!;
const DESERTER_NAMES = ["Private Ambrose Teal", "Corporal Silas Venn", "Drummer Kit Marlow"] as const;   // (a roster name is at most 32 characters: partyState.ts)
const COLLECTOR_NAMES = ["Collector Mordaunt Vesk", "Assessor Prue Dunmarrow", "Bailiff Jem Hartigan", "Improver Silas Crane", "Recoverer Abel Thwaite", "Collector Lettice Mow"] as const;
const BAND_NAMES = ["Three Syndicate debt collectors", "The Syndicate's Recovery Department", "A Syndicate assessment party", "Three Syndicate bailiffs"] as const;
/** The collectors' name for the notices (the band, not a man). */
export const bandName = (seed: number): string => BAND_NAMES[hash3(seed >>> 0, 6, 0xa11e) % BAND_NAMES.length]!;

/** The notice when it begins (`%n` = the person's name). */
export const INCIDENT_OPEN: Record<Exclude<IncidentId, "none">, string> = {
  wounded_traveller: "Someone is lying by the path: %n, hurt and alone. Reviving them costs a minute you may not have.",
  courier: "%n is coming at a trot with a satchel marked SOCIETY - URGENT - ARREARS. Meet him and take it.",
  deserter: "%n, late of the colours, is walking towards you with his hands up and his rifle left somewhere sensible. He wants a word.",
  runaway_horse: "A saddled horse, %n, is loose and grazing where it should not. Somebody, somewhere, is offering a reward, loudly. Catch it: get in the saddle.",
  powder_wagon: "%n has gone over on the road and spilled its kegs. One of them is fizzing. Throw it clear and the rest are yours; dawdle and the road gets rearranged.",
  syndicate_collectors: "%n want the arrears: an invoice read by their powder cart, then rifles.",
};
/** What the USE prompt reads at their side (the traveller is revived the ordinary way). */
export const INCIDENT_PROMPT: Record<Exclude<IncidentId, "none">, string> = { wounded_traveller: "Revive %n", courier: "Take the dispatch from %n", deserter: "Hear %n out", runaway_horse: "Mount", powder_wagon: "Pick up keg", syndicate_collectors: "Pick up keg" };
/** The notice when it settles. */
export const INCIDENT_DONE: Record<IncidentResult, string> = {
  helped: "%n is on their feet, thanks you twice, and will tell everyone on this road. Word of it reaches the right ears.",
  passed_by: "%n is left where they lay. Somebody will remember which party walked past.",
  delivered: `The dispatch is a cheque: the Society's arrears, £${INCIDENT.courierPay}, with a note asking you to spend it slowly.`,
  missed: "The courier did not reach you. The Society will assume you were busy, which is not a compliment.",
  enlisted: "%n signs on for nothing but rations and a clean record. He knows which end of a rifle to hold, and now so do you.",
  turned_away: "%n goes his own way, which was, in fairness, always the plan.",
  caught: `You have caught %n. The owner's reward, £${INCIDENT.horseReward}, is sent on with a note about your seat.`,
  strayed: "%n wanders off to be somebody else's good deed.",
  salvaged: "The fizzing keg went off well clear of %n. The rest of its powder now belongs to the Society, by right of not having exploded.",
  went_up: "%n went up, kegs and all. The road has a new pond in it, and the Syndicate has your name on an invoice.",
  repelled: `%n are seen off. Their collection bag, £${INCIDENT.collectorBag} of other people's arrears, is the Society's now, by right of being the ones still standing.`,
  collected: `%n leave with £${INCIDENT.collectorTake} of the Society's money and a receipt nobody remembers signing.`,
};
/** The regions' names as the paper prints them (the same as `REGIONS[r].name`; a test holds them together: regions.ts pulls in every world builder, the paper should not). */
export const REGION_NAME: Readonly<Record<RegionId, string>> = { hollowmere: "Hollowmere Depot", kessar: "Kessar Reach", highmark: "Highmark", vesper: "Vesper Gorge", saltmarket: "Saltmarket Delta" };

/** The paper's story about the last incident, when it belongs to the expedition being reported (`day`: the latest history entry's), else undefined. */
export function incidentStory(c: CampaignState): { head: string; body: string } | undefined {
  const r = c.sites.lastIncident;
  const latest = c.history[c.history.length - 1];
  if (!r || !latest || r.day !== latest.day) return undefined;
  const t = INCIDENT_PAPER[r.result];
  return { head: t.head, body: t.body.replace("%r", REGION_NAME[r.region]) };
}

/** The paper's line about the last incident (`%r` = the region's name). */
export const INCIDENT_PAPER: Record<IncidentResult, { head: string; body: string }> = {
  helped: { head: "SOCIETY PARTY STOPS FOR STRANGER", body: "On the road in %r an expedition paused to revive a traveller, an event local opinion is still trying to fit into its view of us." },
  passed_by: { head: "TRAVELLER LEFT BY THE ROAD", body: "In %r a wounded local was passed by a Society party in a hurry. The Society regrets the hurry." },
  delivered: { head: "ARREARS PAID IN THE FIELD", body: "A Society runner found his party in %r and paid what was owed, setting a precedent the accounts office is keen not to repeat." },
  missed: { head: "COURIER RETURNS UNOPENED", body: "A satchel of the Society's arrears toured %r and came home. It has been entered as a saving." },
  enlisted: { head: "DESERTER FINDS NEW EMPLOYER", body: "A soldier who left his post in %r has taken another, with a Society party, on terms described as 'rations and amnesia'." },
  turned_away: { head: "VOLUNTEER DECLINED", body: "A man offering his rifle to a Society party in %r was sent on his way. He is believed to be offering it elsewhere." },
  caught: { head: "SOCIETY RETURNS A HORSE", body: "A Society party in %r caught a runaway horse and returned it to its owner, who counted its legs twice before paying." },
  strayed: { head: "HORSE AT LARGE", body: "A horse seen grazing near a Society party in %r remains at large. The party is understood to have been busy." },
  salvaged: { head: "SOCIETY RESCUES SYNDICATE POWDER", body: "A Syndicate powder wagon overturned in %r, and a Society party took its cargo. The party calls it salvage. The Syndicate calls it theft." },
  went_up: { head: "POWDER WAGON REARRANGES THE ROAD", body: "An overturned powder wagon in %r exploded in the presence of a Society party. The crater is being surveyed; the Society has offered to name it." },
  repelled: { head: "SYNDICATE COLLECTORS REPULSED", body: "In %r the Syndicate's debt collectors came for a Society party with rifles drawn. They left without the money, and some without the use of their legs." },
  collected: { head: "SOCIETY SETTLES DISPUTED ACCOUNT", body: "In %r a Society party paid the Syndicate's collectors, who were armed and therefore, in the accounting sense, correct." },
};
