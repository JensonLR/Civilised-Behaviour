import { CAMP } from "./camp.ts";
import type { RegionId, ScenarioTemplateId } from "./campaignTypes.ts";
import { KESSAR_ANCHORS, KESSAR_SITES } from "./campaignTypes.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_SITES, highmarkPlan } from "./highmark.ts";
import { hqPins } from "./hqRoute.ts";
import { HILL, JETTY } from "./landscape.ts";
import { KESSAR_OUTPOST, OUTPOST_SITES } from "./outpost.ts";
import { RAID_SITES } from "./scenarios/outpostRaid.ts";
import { SALTMARKET_ANCHORS, SALTMARKET_SITES, SALTMARKET_SPOTS, SALTMARKET_SURVEY } from "./saltmarket.ts";
import { SITES } from "./village.ts";
import { VESPER_ANCHORS, VESPER_SITES, VESPER_STOCK } from "./vesper.ts";

/**
 * What the heading strip points at, per region (the playtest found Hollowmere's camp, observatory, map room and dock on the strip in every shore).
 * Two kinds: the region's fixed PLACES (a handful each, from the same anchors the worlds are built from), and the OBJECTIVE mark: the place the first
 * unfinished objective of the running contract is about, so "where do I go?" is answered by turning until the goal sits under the notch. Pure data, no DOM.
 */

/** The strip's icon shapes (drawn by the client: shapes, never colours). */
export type MarkIcon = "camp" | "village" | "observatory" | "map" | "dock" | "fort" | "bar" | "court" | "mine" | "hall" | "reeds" | "tent" | "goal";

export interface PlaceMark {
  id: string;
  icon: MarkIcon;
  label: string;
  x: number;
  z: number;
}

const villageCentre = (): { x: number; z: number } => {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const s of SITES) {
    if (s.kind === "stall") continue;
    x += s.x;
    z += s.z;
    n++;
  }
  return { x: x / n, z: z / n };
};

const cache = new Map<RegionId, readonly PlaceMark[]>();

/** The region's fixed places, in a stable order (the landing first everywhere but the hub). */
export function regionMarks(region: RegionId): readonly PlaceMark[] {
  const hit = cache.get(region);
  if (hit) return hit;
  let out: PlaceMark[];
  switch (region) {
    case "kessar": {
      const A = KESSAR_ANCHORS;
      out = [
        { id: "landing", icon: "dock", label: "Landing", x: A.landing.x, z: A.landing.z },
        { id: "bar", icon: "bar", label: "Toll bar", x: A.tollBar.x, z: A.tollBar.z },
        { id: "fort", icon: "fort", label: "Hill fort", x: A.fort.gate.x, z: A.fort.gate.z },
        { id: "syndicate", icon: "tent", label: "Syndicate camp", x: A.rivalCamp.x, z: A.rivalCamp.z },
      ];
      break;
    }
    case "highmark": {
      const A = HIGHMARK_ANCHORS;
      out = [
        { id: "landing", icon: "dock", label: "Reed Landing", x: A.landing.x, z: A.landing.z },
        { id: "stones", icon: "bar", label: "Waiting Stones", x: A.waitingStones.x, z: A.waitingStones.z },
        { id: "gate", icon: "fort", label: "Capital gate", x: A.capital.gate.x, z: A.capital.gate.z },
        { id: "court", icon: "court", label: "Court", x: A.capital.court.x, z: A.capital.court.z },
      ];
      break;
    }
    case "vesper": {
      const A = VESPER_ANCHORS;
      out = [
        { id: "landing", icon: "dock", label: "Staithe Landing", x: A.landing.x, z: A.landing.z },
        { id: "cloister", icon: "court", label: "Long Cloister", x: A.cloister.x, z: A.cloister.z },
        { id: "assay", icon: "hall", label: "Assay House", x: A.assay.x, z: A.assay.z },
        { id: "gallery", icon: "mine", label: "Lower Gallery", x: A.adit.x, z: A.adit.z },
      ];
      break;
    }
    case "saltmarket": {
      const A = SALTMARKET_ANCHORS;
      out = [
        { id: "landing", icon: "dock", label: "Quay", x: A.landing.x, z: A.landing.z },
        { id: "customs", icon: "bar", label: "Customs House", x: A.customs.x, z: A.customs.z },
        { id: "exchange", icon: "hall", label: "Exchange", x: A.exchange.x, z: A.exchange.z },
        { id: "cove", icon: "reeds", label: "Reed cove", x: A.cove.x, z: A.cove.z },
      ];
      break;
    }
    default: {
      const v = villageCentre();
      out = [
        { id: "camp", icon: "camp", label: "Camp", x: CAMP.fire.x, z: CAMP.fire.z },
        { id: "village", icon: "village", label: "Hollowmere", x: v.x, z: v.z },
        { id: "observatory", icon: "observatory", label: "Observatory", x: HILL.x, z: HILL.z },
        ...hqPins(CAMP.mapTable).map((p): PlaceMark => ({ ...p, icon: p.id === "map" ? "map" : "dock" })),
      ];
    }
  }
  // D-056: the Society's foundation, wherever the region has one (the crates' destination: the playtest bots walked to it by its coordinates; a person needs the strip to find it)
  const post = OUTPOST_SITES[region];
  if (post) out = [...out, { id: "post", icon: "camp", label: "Society's post", x: post.site.x, z: post.site.z }];
  cache.set(region, out);
  return out;
}

/** Where "home" is: the region's landing (the boat), or the hub's dock. */
const landing = (region: RegionId): { x: number; z: number } =>
  region === "kessar" ? KESSAR_ANCHORS.landing : region === "highmark" ? HIGHMARK_ANCHORS.landing : region === "vesper" ? VESPER_ANCHORS.landing : region === "saltmarket" ? SALTMARKET_ANCHORS.landing : { x: JETTY.x0, z: JETTY.z0 };

type Spot = { label: string; x: number; z: number } | "home";
const at = (label: string, p: { x: number; z: number }): Spot => ({ label, x: p.x, z: p.z });
const throne = (): { x: number; z: number } => {
  const t = highmarkPlan().throne;
  return { x: t.x, z: t.z + t.hz + 0.9 };
};

/**
 * Each contract's objectives (by the ids their views use) and the place each is about. An objective that has no single place (a moving patrol, "the
 * yard has taken sides") is absent and the strip skips it. "home" is the region's landing.
 */
export const OBJECTIVE_SPOTS: Readonly<Record<ScenarioTemplateId, Readonly<Record<string, Spot>>>> = {
  secure_crossing: {
    reach: at("Toll bar", KESSAR_ANCHORS.tollBar), secure: at("The Warden", KESSAR_ANCHORS.wardenPost), rout: at("Toll bar", KESSAR_ANCHORS.tollBar),
    clear: at("The bridge", KESSAR_ANCHORS.pier), home: "home",
  },
  hostage_rescue: {
    find: at("Hangman's Orchard", KESSAR_SITES.hostage.lookout), free: at("The cage", KESSAR_SITES.hostage.cage), break: at("The cage", KESSAR_SITES.hostage.cage),
    explain: at("The colour-sergeant", KESSAR_SITES.hostage.posts[0]), dock: "home", home: "home",
  },
  convoy_ambush: {
    pick: at("Dry Cut", KESSAR_SITES.convoy.cut), stop: at("Dry Cut", KESSAR_SITES.convoy.cut), guards: at("Dry Cut", KESSAR_SITES.convoy.cut),
    take: at("Dry Cut", KESSAR_SITES.convoy.cut), home: "home",
  },
  border_incident: {
    reach: at("Marker Stone", KESSAR_SITES.border.marker), talk: at("Marker Stone", KESSAR_SITES.border.marker), settle: at("Marker Stone", KESSAR_SITES.border.marker),
    stone: at("Marker Stone", KESSAR_SITES.border.marker), witness: at("Marker Stone", KESSAR_SITES.border.marker), home: "home",
  },
  succession_dispute: {
    court: at("Court", HIGHMARK_ANCHORS.capital.court), form: at("Chamberlain", HIGHMARK_SITES.chamberlain), heir: at("Claimants", HIGHMARK_ANCHORS.capital.court),
    grange: at("The Grange", HIGHMARK_SITES.grange[0]!), chair: at("Vacant Chair", throne()), cheque: at("Syndicate envoy", HIGHMARK_SITES.envoy),
    break: at("Court", HIGHMARK_ANCHORS.capital.court), sit: at("Vacant Chair", throne()), home: "home",
  },
  reapers_strike: {
    line: at("Picket line", HIGHMARK_SITES.strike.foreperson), bushel: at("Granary scale", HIGHMARK_SITES.strike.scale), steward: at("The Steward", HIGHMARK_SITES.strike.steward),
    compact: at("The Foreperson", HIGHMARK_SITES.strike.foreperson), settle: at("The Foreperson", HIGHMARK_SITES.strike.foreperson), breakers: at("The barley", HIGHMARK_SITES.strike.barley), home: "home",
  },
  mine_rescue: {
    approach: at("Lower Gallery", VESPER_ANCHORS.adit), timber: at("The fall", VESPER_STOCK.dig), dig: at("The fall", VESPER_STOCK.dig),
    foreman: at("Foreman", VESPER_SITES.foreman), guild: at("Dirge-Master", VESPER_SITES.dirgeMaster), miners: at("The fall", VESPER_STOCK.dig),
    keg: at("The fall", VESPER_STOCK.dig), home: "home",
  },
  claim_race: {
    ground: at("Pegging ground", VESPER_ANCHORS.pegging), file: at("Assay House", VESPER_ANCHORS.assay), claim: at("Assay House", VESPER_ANCHORS.assay), home: "home",
    ...Object.fromEntries(VESPER_SITES.claimPegs.map((p, i) => [`peg-${i}`, at(`Peg ${i + 1}`, p)])),
  },
  winding_engine: {
    yard: at("Headframe terrace", VESPER_SITES.engine.yard), stop: at("Winding engine", VESPER_SITES.engine.boiler), feed: at("Tailings heap", VESPER_SITES.engine.grit[0]!),
    keg: at("Company magazine", VESPER_STOCK.keg), fuse: at("Winding engine", VESPER_SITES.engine.boiler), challenge: at("Headframe terrace", VESPER_SITES.engine.yard),
    guards: at("Headframe terrace", VESPER_SITES.engine.yard), home: "home",
  },
  outpost_raid: {
    post: at("The Society's post", KESSAR_OUTPOST.site), defend: at("The post's yard", KESSAR_OUTPOST.site), captain: at("The raiders' muster", RAID_SITES.muster),
    break: at("The post's yard", KESSAR_OUTPOST.site), yard: at("The post's yard", KESSAR_OUTPOST.site), home: "home",
  },
  smuggling_run: {
    cove: at("Reed cove", SALTMARKET_ANCHORS.cove), carry: at("Drop-house", SALTMARKET_SPOTS.dropDoor), reeve: at("Tide-Reeve", SALTMARKET_SITES.tideReeve),
    lamp: at("Cove lantern", SALTMARKET_SPOTS.lantern), land: at("Drop-house", SALTMARKET_SPOTS.dropDoor), break: at("Customs House", SALTMARKET_ANCHORS.customs), home: "home",
  },
  flooded_market: {
    hall: at("Exchange", SALTMARKET_ANCHORS.exchange), bid: at("Auctioneer", SALTMARKET_SITES.auctioneer), paddles: at("Exchange", SALTMARKET_ANCHORS.exchange),
    pool: at("House-Heads", SALTMARKET_SITES.houseHeads[0]!), lot: at("Exchange", SALTMARKET_ANCHORS.exchange), home: "home",
  },
  great_grey: {   // D-094: the barley (where the beast is found), its herd (where it is driven), the Master (the licence), the agent's pen (once agreed)
    barley: at("Reapers' barley", HIGHMARK_SITES.strike.barley), out: at("The herd", HIGHMARK_SITES.hunt.fold), licence: at("Master of the Hunt", HIGHMARK_SITES.hunt.master),
    pen: at("Menagerie pen", HIGHMARK_SITES.hunt.pen), home: "home",
  },
  lost_survey: {   // D-093: the strip follows the surveyor's trail (the objective's id names the next mark), then the house, then the quay
    peg: at("Survey peg", SALTMARKET_SURVEY.peg), pump: at("Windpump", SALTMARKET_SURVEY.pumpMark), house: at("Reed-cutter's house", SALTMARKET_SURVEY.house),
    books: at("The Collector", SALTMARKET_SURVEY.collector), quay: at("The quay", SALTMARKET_SURVEY.quay), home: "home",
  },
};

/**
 * The objective mark for a contract's view: the first unfinished, NOT optional objective that has a place (optional side-goals never steal the strip),
 * falling back to the first unfinished optional one with a place. Undefined when nothing is left that has a place.
 */
export function objectiveMark(region: RegionId, view: { template: ScenarioTemplateId; phase?: string; objectives: readonly { id: string; done: boolean; optional?: boolean }[] } | undefined): PlaceMark | undefined {
  if (!view) return undefined;
  // a settled contract's unfinished objectives are moot: the flag points the way home (it used to stay on the last objective after the contract ended)
  if (view.phase === "resolved") return { id: "goal", icon: "goal", label: "Boat home", ...landing(region) };
  const spots = OBJECTIVE_SPOTS[view.template];
  if (!spots) return undefined;
  let fallback: PlaceMark | undefined;
  for (const o of view.objectives) {
    if (o.done) continue;
    const s = spots[o.id];
    if (!s) continue;
    const m: PlaceMark = s === "home" ? { id: "goal", icon: "goal", label: "Boat home", ...landing(region) } : { id: "goal", icon: "goal", label: s.label, x: s.x, z: s.z };
    if (!o.optional) return m;
    fallback ??= m;
  }
  return fallback;
}
