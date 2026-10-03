import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { PropKind } from "../props.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES, VESPER_STOCK } from "../vesper.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * THE WINDING ENGINE (D-044, Vesper Gorge's third contract: the GDD's sabotage). The Syndicate has leased the Lower Gallery Company's winding engine, on the headframe terrace, and is
 * driving a cross-cut at the vein; when the cut breaks through (a seeded clock) the claim is filed and the gorge is the Syndicate's. Two guards stand the terrace, a third walks a beat past
 * the winding house, and the Syndicate's engineer minds the gauge. Four ways it ends, and nothing is chosen from a menu:
 *  - `engine_fouled`: a crate of the gorge's own grit (the tailings heap on the ore road) poured into the boiler's feed at the west wall, UNSEEN. A guard who sees the party on the terrace
 *    challenges first (CHALLENGE_S to clear off); leaving the terrace ends the challenge, staying raises the alarm. With the alarm up the engineer will not let a crate near his feed,
 *    until nobody is left standing to stop it.
 *  - `engine_blown`: the Company's powder keg, from its magazine by the fall, carried up and lit at the boiler (a fuse; anyone near it learns why).
 *  - `engine_bought`: the engineer's "inspection", paid from the party's purse: he finds a fault in his own engine.
 *  - `vein_struck`: the clock: the cross-cut reaches the vein.  `abandoned`: the party is down.
 * Complications (existing ids only): fog and rain narrow the guards' eyes (the runner's sight factors) and fog slows the cut; reinforcements add a guard to the yard.
 */

export const ENGINE = {
  /** The cross-cut reaches the vein this many seconds in (seeded in range); fog slows the drill. */
  cutMin: 330, cutMax: 400, fogCut: 40,
  /** A challenged party has this long to clear the terrace. */
  challengeS: 10,
  /** The beat-man walks one way in this long, then turns. */
  beatS: 40,
  /** The keg's fuse, then the settling time before the ending is called (casualties are counted in between). */
  fuseS: 6, settleS: 2,
  /** Reinforcements reach the yard this far in. */
  extraAtS: 120,
  /** Sight of the terrace's guards (clear weather; the runner narrows it in rain and fog, and for a crouching party). */
  sight: 14,
  /** The engineer's inspection fee (pounds, multiples of five). */
  priceBribe: [60, 95],
  personR: 2.4, useR: 2.6, yardR: 16,
} as const;

const GUARD_GROUPS = ["guards", "beat", "late:extra"] as const;
type GuardGroup = (typeof GUARD_GROUPS)[number];
type Count = { alive: number; routed: number; down: number; total: number };

export interface EngineState extends BaseState {
  complication: ComplicationId;
  near: { yard: number };
  /** The engineer told the party what the engine cannot stand. */
  asked: boolean;
  alarm: boolean;
  /** A guard's challenge runs out at this time (0: none). */
  challengeUntil: number;
  crews: Record<GuardGroup, Count>;
  keg: "none" | "set" | "fired"; blastAt: number;
  cutAt: number;
  beatLeg: 0 | 1; beatNext: number;
  extra: boolean;
  engineerGone: boolean;
  price: number;
  purse: number; spent: number; paid: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): EngineState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "winding_engine", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0xe9e0 + k);
  const cut = ENGINE.cutMin + (h(1) % (ENGINE.cutMax - ENGINE.cutMin + 1)) + (complication === "fog" ? ENGINE.fogCut : 0);
  const zero: Count = { alive: 0, routed: 0, down: 0, total: 0 };
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication, near: { yard: 0 }, asked: false, alarm: false, challengeUntil: 0,
    crews: { guards: { ...zero, alive: 2, total: 2 }, beat: { ...zero, alive: 1, total: 1 }, "late:extra": { ...zero } },
    keg: "none", blastAt: 0, cutAt: Math.round(cut), beatLeg: 0, beatNext: ENGINE.beatS, extra: false, engineerGone: false,
    price: rnd5(...ENGINE.priceBribe, h(2)), purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const standing = (s: EngineState): number => GUARD_GROUPS.reduce((n, g) => n + s.crews[g].alive, 0);
const total = (s: EngineState): number => GUARD_GROUPS.reduce((n, g) => n + s.crews[g].total, 0);
/** Nobody is left on the terrace to stop anything. */
const broken = (s: EngineState): boolean => total(s) > 0 && standing(s) === 0;
const affordable = (s: EngineState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const phaseOf = (s: EngineState): EngineState["phase"] =>
  s.parley ? "parley" : s.keg === "set" ? "rigging" : s.alarm ? "fighting" : s.challengeUntil > 0 ? "standoff" : s.near.yard > 0 || s.asked ? "waiting" : "approach";
const fin = (s: EngineState): EngineState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const ALERT: ScenarioFx[] = GUARD_GROUPS.map((group) => ({ k: "order", group, order: { o: "alert" } }) as ScenarioFx);

/** The terrace wakes up: first cause wins. */
function raise(s: EngineState, why: string): Reduction<EngineState> {
  if (s.alarm) return stay(fin(s));
  return { s: fin({ ...s, alarm: true, challengeUntil: 0, parley: s.parley === "engineer" ? undefined : s.parley }), fx: [...ALERT, { k: "order", group: "engineer", order: { o: "flee" } }, say(why)] };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: EngineState, e: ScenarioInput): Reduction<EngineState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      let n: EngineState = { ...s, t: s.t + dtOf(e) };
      const fx: ScenarioFx[] = [];
      // the beat: out along the terrace past the winding house, and back, while nothing is wrong
      if (!n.alarm && n.t >= n.beatNext) {
        const leg: 0 | 1 = n.beatLeg === 0 ? 1 : 0;
        n = { ...n, beatLeg: leg, beatNext: n.t + ENGINE.beatS };
        fx.push({ k: "order", group: "beat", order: { o: "march", route: leg === 1 ? "beatOut" : "beatBack" } });
      }
      if (n.complication === "reinforcements" && !n.extra && n.t >= ENGINE.extraAtS) {
        n = { ...n, extra: true, crews: { ...n.crews, "late:extra": { alive: 1, routed: 0, down: 0, total: 1 } } };
        fx.push({ k: "spawn", group: "late:extra" }, say("A fourth guard climbs up to the terrace with a rifle and a sandwich, sent by the Syndicate's agent, who has been reading the paper."));
        if (n.alarm) fx.push({ k: "order", group: "late:extra", order: { o: "alert" } });
      }
      // a challenge that ran out with the party still on the terrace
      if (n.challengeUntil > 0 && n.t >= n.challengeUntil && !n.alarm && n.near.yard === 0) n = fin({ ...n, challengeUntil: 0 });
      if (n.challengeUntil > 0 && n.t >= n.challengeUntil && !n.alarm) {
        const r = raise({ ...n, challengeUntil: 0 }, "\"Right!\" The guard's whistle goes, and the terrace is suddenly full of men who were not paid to be reasonable.");
        n = r.s;
        fx.push(...(r.fx as ScenarioFx[]));
      }
      // the keg: a fuse, a bang, then the ending once the casualties are in
      if (n.keg === "set" && n.t >= n.blastAt) {
        n = { ...n, keg: "fired" };
        fx.push({ k: "explode", at: "boiler" }, say("The keg goes. So does the boiler, in sympathy, and then the winding house's roof, out of a sense of occasion. Slate comes down on the terrace for some time."));
      }
      if (n.keg === "fired" && n.t >= n.blastAt + ENGINE.settleS) {
        return resolveWith(n, "engine_blown", {}, [...fx, say("When the steam clears there is a hole where the Syndicate's lease used to be. The cross-cut will not be reaching anything this year.")]);
      }
      // the clock (a lit fuse beats it: the cut does not break through under a burning keg)
      if (n.keg === "none" && n.t >= n.cutAt) {
        return resolveWith(n, "vein_struck", {}, [...fx, { k: "order", group: "guards", order: { o: "stand_down" } }, { k: "order", group: "beat", order: { o: "stand_down" } },
          say("A shout comes up the shaft, then a cheer, then a man with an ore sample held over his head like a prize marrow. The cross-cut is through. The Syndicate's clerk is already running for the Assay House.")]);
      }
      return { s: fin(n), fx };
    }
    case "near": {
      if (e.at !== "yard") return stay(s);
      const k = int(e.party, 0, 8, 0);
      if (s.near.yard === k) return stay(s);
      const n = fin({ ...s, near: { yard: k } });
      if (k === 0 && n.challengeUntil > 0 && !n.alarm) return { s: fin({ ...n, challengeUntil: 0 }), fx: [say("\"And stay off,\" the guard calls after you, and goes back to looking at nothing in particular.")] };
      return stay(n);
    }
    case "seen": {
      if (!(GUARD_GROUPS as readonly string[]).includes(e.group) || s.alarm || s.challengeUntil > 0) return stay(s);
      return { s: fin({ ...s, challengeUntil: s.t + ENGINE.challengeS }), fx: [say(`"Oi! You! This terrace is leased!" A Syndicate guard has seen you, and has a whistle and opinions. Be off the terrace within ${ENGINE.challengeS} seconds, or he uses the whistle.`)] };
    }
    case "hostile": {
      if (e.at !== undefined && !(GUARD_GROUPS as readonly string[]).includes(e.at) && e.at !== "engineer") return stay(s);
      return raise(s, "Shots on the headframe terrace. The guards take cover behind the Company's equipment, which the Company will be billing for.");
    }
    case "count": {
      if (!(GUARD_GROUPS as readonly string[]).includes(e.group)) return stay(s);
      const g = e.group as GuardGroup;
      const tot = int(e.total, 0, 4, s.crews[g].total);
      const alive = int(e.alive, 0, tot), routed = int(e.routed, 0, tot - alive), down = int(e.down, 0, tot - alive - routed);
      const was = broken(s);
      const n = fin({ ...s, crews: { ...s.crews, [g]: { alive, routed, down, total: tot } } });
      if (!was && broken(n) && n.alarm) return { s: n, fx: [say("Nobody is left standing on the terrace who is paid to mind the engine. The boiler's feed, at the west wall, is minding itself.")] };
      return stay(n);
    }
    case "actor": {
      if (e.id === "engineer" && e.state === "down" && !s.engineerGone) return stay(fin({ ...s, engineerGone: true, parley: s.parley === "engineer" ? undefined : s.parley }));
      return stay(s);
    }
    case "use": return use(s, e.target);
    case "talk": return e.kind === "engineer" ? talk(s, e.result, e.paid) : stay(s);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function use(s: EngineState, target: string): Reduction<EngineState> {
  if (target === "feed") {
    if (s.keg !== "none") return stay(s);
    if (s.alarm && !broken(s)) return { s, fx: [say("You come at the boiler with a crate and the engineer comes at you with a shovel. With the terrace awake, nobody is pouring anything into that feed.")] };
    return resolveWith(fin(s), "engine_fouled", {}, [{ k: "order", group: "guards", order: { o: "stand_down" } }, { k: "order", group: "beat", order: { o: "stand_down" } },
      say(s.alarm
        ? "With nobody left to stop you, the crate goes into the feed at the west wall. The engine drinks the gorge, chokes on it, and stops with a noise like a cathedral clearing its throat."
        : "The crate goes into the feed at the west wall, quietly. A minute later the engine coughs, then groans, then stops with a long, offended sigh. The engineer climbs up to look. The guards look at each other. Nobody looks at you.")]);
  }
  if (target === "keg") {
    if (s.keg !== "none") return stay(s);
    const n = fin({ ...s, keg: "set", blastAt: s.t + ENGINE.fuseS, alarm: true, challengeUntil: 0, parley: undefined });
    return { s: n, fx: [{ k: "order", group: "guards", order: { o: "flee" } }, { k: "order", group: "beat", order: { o: "flee" } }, { k: "order", group: "late:extra", order: { o: "flee" } }, { k: "order", group: "engineer", order: { o: "flee" } },
      say(`The Company's keg is wedged under the boiler and the fuse is lit. Everybody on the terrace, guards included, discovers somewhere else to be. ${ENGINE.fuseS} seconds.`)] };
  }
  return stay(s);
}

function paidOk(s: EngineState, paid: number): boolean {
  return Number.isFinite(paid) && paid >= Math.round(s.price * 0.75) && paid <= Math.round(s.price * 1.25) && affordable(s, paid);
}

function talk(s: EngineState, result: string, paid: number): Reduction<EngineState> {
  if (result === "open") {
    if (s.parley || s.engineerGone || s.keg !== "none") return stay(s);
    if (s.alarm) return { s, fx: [say("The engineer has gone up into the winding house and pulled the ladder after him. He is not taking visitors.")] };
    return { s: fin({ ...s, parley: "engineer" }), fx: [{ k: "parley", kind: "engineer", price: s.price }] };
  }
  if (s.parley !== "engineer") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin({ ...s, asked: true }));
    case "hostile": return raise({ ...s, parley: undefined }, "The engineer's shout brings the terrace running.");
    case "paid": {
      if (!paidOk(s, paid)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid });
      return resolveWith(n, "engine_bought", {}, [{ k: "order", group: "guards", order: { o: "stand_down" } }, { k: "order", group: "beat", order: { o: "stand_down" } },
        say("The engine stops, with a clunk that will take a week and a fitter from the coast to put right. The engineer writes CRACKED FLYWHEEL in the log, signs it, and takes the rest of the afternoon off.")]);
    }
    default: return stay(s);
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: EngineState): ReturnType<TemplateDef<EngineState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  if (s.keg !== "none") return "engine_blown";
  const nothing = tallyEmpty(s.tally) && !s.alarm && s.paid === 0 && !s.parley && s.challengeUntil === 0;
  return nothing ? undefined : "vein_struck";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  approach: "The Syndicate has leased the Company's winding engine on the headframe terrace and is driving a cross-cut at the vein. When it breaks through, the gorge is theirs. Go up the ore road to the terrace and have a look at the engine.",
  waiting: "Two guards stand the terrace and a third walks a beat past the winding house. The engineer minds the gauge, and may be persuaded to mind it less. Crouch to keep out of their eyes.",
  standoff: "A guard has challenged you. Clear off the terrace before he blows his whistle, and come back another way.",
  parley: "The engineer is listening, and calculating.",
  rigging: "The fuse is lit. Whatever else you meant to do on the terrace, you now mean to do it somewhere else.",
  fighting: "The terrace is awake. Break the guards and the engine's feed is yours, or bring the Company's powder.",
};
const DONE: Record<string, string> = {
  engine_fouled: "The Syndicate's engine is full of the gorge and will not turn again this season. Take the ore barge home from Staithe Landing.",
  engine_blown: "The winding house has fewer walls than it had this morning, and the cross-cut is buried. Take the ore barge home.",
  engine_bought: "The engine has a cracked flywheel, according to the man you paid, who is now the Syndicate's leading authority on cracked flywheels. Take the ore barge home.",
  vein_struck: "The cross-cut broke through and the Syndicate has the vein. The Company will collect the rent on its engine regardless. Take the ore barge home.",
  abandoned: "The expedition is down. The engine thumps on. Take the barge home and explain.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  fog: "Fog in the gorge: the guards see less, and the drill bites slower.",
  rain: "Rain on the terrace: the guards keep their hats down and their eyes on their boots.",
  reinforcements: "The Syndicate's agent has sent for another guard; he will be on the terrace before long.",
};

function view(s: EngineState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "engine_fouled" || res === "engine_blown" || res === "engine_bought";
  const objectives: ObjectiveView[] = [
    { id: "yard", text: "Go up to the headframe terrace and look at the engine", done: s.near.yard > 0 || s.phase !== "approach" },
    { id: "stop", text: res === "vein_struck" ? "Lost: the cross-cut struck the vein" : res === "abandoned" ? "Lost: the expedition went down" : "Stop the cross-cut before it reaches the vein", done: won },
  ];
  if (res === undefined && (s.asked || s.near.yard > 0) && s.keg === "none") {
    objectives.push({ id: "feed", text: s.alarm && !broken(s) ? "The boiler's feed is watched now: break the guards first" : "Carry grit from the tailings heap to the boiler, unseen", done: false, optional: true });
  }
  if (res === undefined && s.asked && s.keg === "none") objectives.push({ id: "keg", text: "Or fetch the Company's powder keg from its magazine", done: false, optional: true });
  if (res === undefined && s.keg !== "none") objectives.push({ id: "fuse", text: s.keg === "set" ? "The fuse is lit. Get clear." : "The powder has gone off", done: s.keg === "fired", optional: true });
  if (res === undefined && s.challengeUntil > 0) objectives.push({ id: "challenge", text: "A guard has challenged you: clear off the terrace", done: false, optional: true });
  if (res === undefined && s.alarm && s.keg === "none") objectives.push({ id: "guards", text: `Down or rout the terrace guards (${total(s) - standing(s)} of ${total(s)})`, done: broken(s), optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the ore barge home from Staithe Landing", done: false });

  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  if (res === undefined && s.asked && s.keg === "none") hint += " (The engineer: \"She drinks whatever is poured into her feed, at the west wall, and she has no stomach for grit.\")";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  const clock: [string, number] = s.challengeUntil > 0 && !s.alarm ? ["The guard's whistle", s.challengeUntil - s.t] : s.keg === "set" ? ["The fuse", s.blastAt - s.t] : ["The cross-cut reaches the vein", s.cutAt - s.t];
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(clock[0], res !== undefined ? 0 : clock[1], now), template: "winding_engine", title: "The Winding Engine" };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: EngineState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "winding_engine", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "vesper",
  };
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

/** The terrace's people: two posted guards, the beat-man, the engineer, and (complication) a fourth guard held back. 5 rows. */
function roster(_c: CampaignState, seed: number, s: EngineState): NpcSpec[] {
  const S = VESPER_SITES, E = VESPER_SITES.engine;
  const mk = (id: string, role: number, group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction: "rival", side: "rival", group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role ^ 0xe9e0), name, skill, bravery, brain,
  });
  const out: NpcSpec[] = [
    mk("guard-0", NPC.RIVAL_GUARD, "guards", S.guards[0]!, WEAPON.RIFLE, "Guard Ezra Coldwell-Vesk", 44 + (hash3(seed >>> 0, 0, 0xe91) % 12), 50, "garrison", 0),
    mk("guard-1", NPC.RIVAL_GUARD, "guards", S.guards[1]!, WEAPON.BLUNDERBUSS, "Guard Prudence Hatchard", 40 + (hash3(seed >>> 0, 1, 0xe91) % 12), 50, "garrison", 1),
    mk("beat-0", NPC.RIVAL_GUARD, "beat", E.beat[0]!, WEAPON.PISTOL, "Beat-Guard Silas Moot", 40, 45, "garrison", 2),
    mk("engineer", NPC.RIVAL_SURVEYOR, "engineer", E.engineer, WEAPON.FISTS, "Engineer Lucius Brack-Dunmarrow, of the Syndicate", 10, 20, "civil", 3),
  ];
  if (s.complication === "reinforcements") out.push(mk("extra-0", NPC.RIVAL_GUARD, "late:extra", S.guards[2]!, WEAPON.RIFLE, "Guard Tobias Wenlock (sent for)", 46, 55, "garrison", 4));
  return out;
}

const E0 = VESPER_SITES.engine;
const observe: ObserveSpec = {
  near: [{ id: "yard", x: E0.yard.x, z: E0.yard.z, r: ENGINE.yardR }],
  use: [
    { id: "engineer", npc: "engineer", r: ENGINE.personR, talk: "engineer", carry: "none" },
    { id: "feed", at: E0.boiler, r: ENGINE.useR, carry: "crate", consume: true },
    { id: "keg", at: E0.boiler, r: ENGINE.useR, carry: "barrel", consume: true },
  ],
  count: [{ group: "guards" }, { group: "beat" }, { group: "late:extra" }],
  seen: [{ group: "guards", sight: ENGINE.sight }, { group: "beat", sight: ENGINE.sight }, { group: "late:extra", sight: ENGINE.sight }],
  actors: [{ id: "engineer" }],
  hostileGroups: ["guards", "beat", "late:extra", "engineer"],
};

export const windingEngineTemplate: TemplateDef<EngineState> = {
  id: "winding_engine", title: "The Winding Engine",
  brief: "The Company has leased its winding engine to the Syndicate, which it calls diversification, and the Syndicate is driving a cross-cut at the vein with it. When it breaks through, the gorge's best ore is theirs. Foul the boiler with grit while the guards look away, blow it up with the Company's own powder, pay the engineer to discover a fault, or watch it strike.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { beatOut: [E0.beat[0]!, E0.beat[1]!], beatBack: [E0.beat[1]!, E0.beat[0]!] },
  props: [
    ...E0.grit.map((p, i) => ({ id: `grit${i}`, kind: PropKind.CRATE as number, x: p.x, z: p.z })),
    { id: "keg", kind: PropKind.BARREL as number, x: VESPER_STOCK.keg.x, z: VESPER_STOCK.keg.z },
  ],
  sites: { boiler: E0.boiler, yard: E0.yard, headframe: VESPER_ANCHORS.headframe },
};
