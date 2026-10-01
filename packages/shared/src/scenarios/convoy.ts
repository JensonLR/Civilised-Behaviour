import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { CONVOY_DEPART_S, KESSAR_ANCHORS, KESSAR_SITES, NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import { NPC_SIDE, type NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * CONVOY AMBUSH, "The Syndicate Wagon". After CONVOY_DEPART_S a Dunmarrow-Vesk wagon (a driver, two guards, three crates) walks KESSAR_SITES.convoy.route
 * from the Syndicate camp, past the Society's powder cart and the Dry Cut, to the ford landing. The party picks a spot. Endings: `seized` (the guards are
 * down or routed and somebody INTERACTs the wagon: the crates' value comes into the purse), `burned` (a powder barrel goes up beside the wagon: nobody gets the
 * crates and the paper says "spontaneous combustion"), `tipped_off` (the Ward's ford post is told; two Ward soldiers meet the convoy at the Cut under `war`),
 * `passed` (it reaches the ford landing; the Syndicate is armed). The reducer holds every rule; the runner reports facts.
 */

export const CONVOY = {
  departS: CONVOY_DEPART_S, outriderLeadS: 20, patrolAtS: 90,
  /** A barrel counts as "beside the wagon" this close (metres). */
  burnRadius: 6,
  goalRadius: 4,
  sightOutrider: 20, sightPatrol: 22,
} as const;

/** The Ward patrol's walk across the Cut (complication `ward_patrol`): from the north bank, through the ford, to the Cut. */
export const PATROL_ROUTE: readonly { x: number; z: number }[] = [{ x: 46, z: 9 }, { x: 46, z: 20 }, { x: 44, z: 28 }, { x: 40, z: 34 }, { x: 31, z: 38 }];
const WARD_POST: readonly { x: number; z: number }[] = KESSAR_SITES.border.ward;

export interface ConvoyState extends BaseState {
  complication: ComplicationId; rain: number;
  departed: boolean; alarm: boolean; hostile: boolean; tipped: boolean; claim: boolean; witnessed: boolean; outrider: boolean; patrol: boolean;
  near: { cut: number };
  guards: { alive: number; routed: number; down: number; total: number };
  tally: CasualtyTally; brokePromise: boolean; paid: number; loot: number;
}

function init(c: CampaignState, _asking: number, seed: number): ConvoyState {
  return {
    phase: "planning", t: 0, resolvedAt: 0, complication: dealComplication(c, "convoy_ambush", seed), rain: 0,
    departed: false, alarm: false, hostile: false, tipped: false, claim: false, witnessed: false, outrider: false, patrol: false,
    near: { cut: 0 }, guards: { alive: 2, routed: 0, down: 0, total: 2 }, tally: zeroTally(), brokePromise: false, paid: 0, loot: 0,
  };
}

const defeated = (s: ConvoyState): boolean => s.guards.total > 0 && s.guards.alive === 0;
const phaseOf = (s: ConvoyState): ConvoyState["phase"] => (s.hostile ? "fighting" : s.departed ? "waiting" : "planning");
const fin = (s: ConvoyState): ConvoyState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });

function warn(s: ConvoyState, say_: string): Reduction<ConvoyState> {
  if (s.alarm) return stay(s);
  return { s: fin({ ...s, alarm: true }), fx: [{ k: "order", group: "guards", order: { o: "alert" } }, say(say_)] };
}

function reduce(s: ConvoyState, e: ScenarioInput): Reduction<ConvoyState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: ConvoyState = { ...s, t: s.t + dt };
      const fx: ScenarioFx[] = [];
      if (s.complication === "outriders" && !n.outrider && n.t >= CONVOY.departS - CONVOY.outriderLeadS) {
        n = { ...n, outrider: true };
        fx.push({ k: "spawn", group: "late:outrider" }, { k: "order", group: "late:outrider", order: { o: "march", route: "convoy" } });
      }
      if (s.complication === "ward_patrol" && !n.patrol && n.t >= CONVOY.patrolAtS) {
        n = { ...n, patrol: true };
        fx.push({ k: "spawn", group: "late:patrol" }, { k: "order", group: "late:patrol", order: { o: "march", route: "patrol" } }, say("A Ward patrol is crossing the Cut. They have notebooks. They are writing down the weather."));
      }
      if (!n.departed && n.t >= CONVOY.departS) {
        n = { ...n, departed: true };
        fx.push({ k: "order", group: "guards", order: { o: "march", route: "convoy" } }, { k: "order", group: "driver", order: { o: "march", route: "convoy" } }, ...(n.hostile ? [] : [{ k: "wagon", op: "go" } as ScenarioFx]),
          say("The Syndicate wagon has left its camp. Three crates, two guards, one driver, and a flag about the whole affair."));
      }
      return { s: fin(n), fx };
    }
    case "weather": return stay({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 });
    case "near": {
      if (e.at !== "cut") return stay(s);
      const n = int(e.party, 0, 8, 0);
      return s.near.cut === n ? stay(s) : stay({ ...s, near: { cut: n } });
    }
    case "seen": {
      if (e.group === "late:outrider") return warn(s, "The Syndicate scout has seen you, and rides back along the line shouting 'Gentlemen!' The guards have unslung things.");
      if (e.group === "late:patrol" && s.hostile && !s.witnessed) return { s: { ...s, witnessed: true }, fx: [say("The Ward patrol has watched the whole thing and is taking notes.")] };
      return stay(s);
    }
    case "hostile": {
      const at = e.at;
      if (at === "late:patrol" || at === "ward_post") {
        // you fired on the Ward: they were witnesses and now they are parties
        return { s: { ...s, brokePromise: true, witnessed: true }, fx: [{ k: "order", group: at, order: { o: "alert" } }, say("You have fired on a Ward picket. The Ward writes that down with some force.")] };
      }
      if (s.hostile) return stay(s);
      const n = fin({ ...s, hostile: true, alarm: true, parley: undefined });
      return { s: n, fx: [{ k: "order", group: "guards", order: { o: "alert" } }, { k: "order", group: "driver", order: { o: "flee" } }, { k: "wagon", op: "halt" }, say("The wagon lurches to a stop. The driver abandons the reins and, with some dignity, the wagon.")] };
    }
    case "count": {
      if (e.group !== "guards") return stay(s);
      const total = int(e.total, 0, 4, s.guards.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      const n: ConvoyState = { ...s, guards: { alive, routed, down, total } };
      if (n.tipped && defeated(n)) {
        return resolveWith(n, "tipped_off", {}, [{ k: "wagon", op: "halt" }, { k: "war", a: "ward", b: "rival", on: false }, say("The Ward pickets have cleared the Cut. The wagon is the Ward's now, and so is the paperwork. The Society is thanked, quietly, for a tip it did not strictly give.")]);
      }
      return stay(fin(n));
    }
    case "talk": {
      if (e.kind !== "ford_post") return stay(s);
      if (e.result === "open") {
        if (s.parley || s.tipped) return s.tipped ? { s, fx: [say("The picket has already gone. There is only tea and a note: 'Back by dusk.'")] } : stay(s);
        return { s: { ...s, parley: "ford_post" }, fx: [{ k: "parley", kind: "ford_post", price: 0 }] };
      }
      if (s.parley !== "ford_post") return stay(s);
      if (e.result === "close") return stay({ ...s, parley: undefined });
      if (e.result === "hostile") return stay({ ...s, parley: undefined, brokePromise: true });
      if (e.result === "tip") {
        const cut = KESSAR_SITES.convoy.cut;
        return {
          s: { ...s, parley: undefined, tipped: true },
          fx: [{ k: "war", a: "ward", b: "rival", on: true }, { k: "order", group: "ward_post", order: { o: "guard", x: cut.x, z: cut.z, r: 6 } }, say("The picket marches for the Cut with the air of men who were told, but not by you.")],
        };
      }
      return stay(s);
    }
    case "use": {
      if (e.target !== "wagon") return stay(s);
      if (!defeated(s)) return { s, fx: [say("Two armed men are still standing on the wagon's account. They have been paid not to move it.")] };
      if (s.claim) return stay(s);
      return { s: { ...s, claim: true }, fx: [{ k: "wagon", op: "seize" }] };
    }
    case "prop": {
      if (e.what === "seized" && e.at === "wagon") {
        if (!s.claim || !defeated(s)) return stay(s);
        const loot = int(e.n, 0, 999, 0);
        return resolveWith(s, "seized", { loot }, [say(`The crates are yours: £${loot} of the Syndicate's cargo, and no receipt. The wagon-horse regards you with the pity of a creature that has seen a lot of owners.`)]);
      }
      if (e.what === "destroyed" && e.at === "barrel") {
        if (int(e.n, 0, 9999, 9999) > CONVOY.burnRadius) return stay(s);
        return resolveWith(s, "burned", {}, [{ k: "explode", at: "wagon" }, { k: "wagon", op: "wreck" }, say("A barrel goes up beside the wagon, and so does the wagon. The paper will say nobody did it, and the paper will be technically correct.")]);
      }
      return stay(s);
    }
    case "actor": {
      if (e.id === "wagon" && e.state === "arrived") {
        return resolveWith(s, "passed", {}, [{ k: "war", a: "ward", b: "rival", on: false }, say("The wagon rolls up to the ford landing, unmolested, and the Syndicate's flag goes up on its tailgate. Nobody has stopped it.")]);
      }
      return stay(s);
    }
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function leave(s: ConvoyState): ReturnType<TemplateDef<ConvoyState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  return !s.departed && tallyEmpty(s.tally) && !s.hostile && !s.tipped ? undefined : "passed";
}

function view(s: ConvoyState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "seized" || res === "tipped_off" || res === "burned";
  const objectives: ObjectiveView[] = [
    { id: "pick", text: "Pick your ground (the Dry Cut is the best of it)", done: s.near.cut > 0 || s.departed },
    { id: "stop", text: res === "passed" ? "Lost: the wagon reached the ford" : "Stop the Syndicate wagon before it reaches the ford", done: won },
  ];
  if (res === undefined && s.hostile) objectives.push({ id: "guards", text: `Break the guards (${s.guards.total - s.guards.alive} of ${s.guards.total})`, done: defeated(s), optional: true });
  if (res === undefined && defeated(s)) objectives.push({ id: "take", text: "Take the wagon (INTERACT) or put it to the torch", done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Sail home from the landing dock", done: false });
  const HINT: Record<string, string> = {
    planning: "A Dunmarrow-Vesk wagon will leave its camp shortly and walk the south-bank track to the ford. The Society's powder cart is on the way. So is the Dry Cut, which is a very good place for an accident.",
    waiting: "The wagon is under way. Stop it at the Cut: shoot the guards, light the powder, or tell the Ward's ford post and let them do the paperwork.",
    fighting: "The ambush is on. Break the guards, then take the wagon, or put it to the torch.",
  };
  const DONE: Record<string, string> = {
    seized: "Wagon seized. The crates are yours until somebody checks the manifest. Sail home from the dock.",
    tipped_off: "The Ward's pickets cleared the Cut. Nobody on your side fired a shot. Sail home from the dock.",
    burned: "The wagon has been reclassified as a bonfire. Sail home from the dock.",
    passed: "The wagon reached the ford landing. The Syndicate is armed and delighted. Sail home from the dock.",
    abandoned: "The expedition is down. The wagon rolls on. Sail home and explain.",
  };
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  const ch = COMPLICATION_HINT[s.complication];
  if (res === undefined && ch) hint += ` ${ch}`;
  const remain = res !== undefined ? 0 : s.departed ? 0 : CONVOY.departS - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer("The wagon leaves camp", remain, now), template: "convoy_ambush", title: "The Syndicate Wagon" };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: ConvoyState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  const o: ScenarioOutcome = {
    scenario: "convoy_ambush", resolution: s.resolution, toll: 0, paid: 0, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise || (s.witnessed && s.hostile),
    seconds: Math.round(s.resolvedAt), complication: s.complication,
  };
  if (s.loot > 0) o.loot = s.loot;
  return o;
}

const GUARD_NAMES = ["Enforcer Roddy Vesk-Pym", "Enforcer Hilda Marrowgate"] as const;
const GUARD_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.BLUNDERBUSS];

function roster(_c: CampaignState, seed: number, s: ConvoyState): NpcSpec[] {
  const R = KESSAR_SITES.convoy.route[0]!;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, faction: NpcSpec["faction"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction, side: NPC_SIDE[role]!, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  for (let i = 0; i < 2; i++) out.push(mk(`guard-${i}`, NPC.RIVAL_GUARD, "rival", "guards", { x: R.x + (i === 0 ? -2 : 2), z: R.z + (i === 0 ? 0 : 1.5) }, GUARD_ARMS[i]!, GUARD_NAMES[i]!, 55 + 6 * i, 55, "garrison", i));
  // the driver walks the route like the guards (the Cast's civil brain stands still): unarmed, neutral, and he runs when the shooting starts
  out.push(mk("driver-0", NPC.DRIVER, "rival", "driver", { x: R.x, z: R.z - 2.5 }, WEAPON.FISTS, "Carter Obadiah Plume", 5, 15, "garrison", 2));
  WARD_POST.forEach((p, i) => out.push(mk(`post-${i}`, NPC.SENTRY, "ward", "ward_post", p, i === 0 ? WEAPON.RIFLE : WEAPON.PISTOL, i === 0 ? "Picket Corporal Dunstan Aldous" : "Picket Mabel Quenby", 48, 55, "garrison", 3 + i)));
  if (s.complication === "outriders") out.push(mk("outrider-0", NPC.RIVAL_GUARD, "rival", "late:outrider", { x: R.x - 6, z: R.z - 2 }, WEAPON.PISTOL, "Scout Fitzwilliam Hale-Dunmarrow", 62, 50, "garrison", 5));
  if (s.complication === "ward_patrol") {
    const P = PATROL_ROUTE[0]!;
    out.push(mk("patrol-0", NPC.SENTRY, "ward", "late:patrol", { x: P.x - 1, z: P.z }, WEAPON.RIFLE, "Patrol-Sergeant Hettie Rook", 50, 55, "garrison", 6));
    out.push(mk("patrol-1", NPC.SENTRY, "ward", "late:patrol", { x: P.x + 1, z: P.z }, WEAPON.RIFLE, "Patroller Wilmot Brandish", 46, 50, "garrison", 7));
  }
  return out;
}

const route = KESSAR_SITES.convoy.route;
const observe: ObserveSpec = {
  near: [{ id: "cut", x: KESSAR_SITES.convoy.cut.x, z: KESSAR_SITES.convoy.cut.z, r: 16 }],
  use: [
    { id: "ford_post", npc: "post-0", r: 2.4, talk: "ford_post", carry: "none" },
    { id: "wagon", mount: true, r: 3.4, carry: "none" },
  ],
  count: [{ group: "guards" }],
  seen: [{ group: "late:outrider", sight: CONVOY.sightOutrider }, { group: "late:patrol", sight: CONVOY.sightPatrol }],
  actors: [{ id: "wagon", goal: { x: route[route.length - 1]!.x, z: route[route.length - 1]!.z, r: CONVOY.goalRadius } }],
  hostileGroups: ["guards", "driver", "late:outrider", "late:patrol", "ward_post"],
};

export const convoyTemplate: TemplateDef<ConvoyState> = {
  id: "convoy_ambush", title: "The Syndicate Wagon",
  brief: "A Dunmarrow-Vesk wagon crosses the south bank to the ford at a walking pace and an unwise distance from its escort. Take it, burn it, report it to the Ward, or watch it pass and read about it afterwards.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { convoy: route, patrol: PATROL_ROUTE },
  wagon: { at: { x: route[0]!.x + 2, z: route[0]!.z, yaw: 0 }, crates: 3, route: "convoy" },
  props: [{ id: "barrel", kind: PropKind.BARREL, x: KESSAR_SITES.convoy.cut.x + 2.4, z: KESSAR_SITES.convoy.cut.z - 2.6 }],
  sites: { wagon: route[0]!, cut: KESSAR_SITES.convoy.cut, ford: KESSAR_ANCHORS.ford },
};
