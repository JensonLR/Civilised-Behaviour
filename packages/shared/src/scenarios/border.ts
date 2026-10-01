import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { BORDER_ESCALATE_S, KESSAR_SITES, NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import { NPC_SIDE, type NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { hash3 } from "../rng.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * BORDER INCIDENT, "Marker Stone No. 4". The Stone stands in the ford. Two Ward patrol on the north bank, three Syndicate surveyors on the south, each side
 * shouting across the water. A TENSION meter (0..100) rises with time, noise and shots and falls when somebody talks. Endings: `mediated` (both sides agree to
 * a joint survey and stand down), `sided_ward` (tell the patrol the Syndicate's plan, which you must first have learnt: the patrol detains you and the
 * Syndicate leaves), `sided_syndicate` (take the surveyor's envelope, then pull the Stone: the Ward goes `alert` against YOU), `provoked` (a player shoots
 * first: the wronged side fights), `escalated` (tension 100 or BORDER_ESCALATE_S: the two sides fight each other, under `war`, while the players watch).
 */

export const BORDER = {
  escalateS: BORDER_ESCALATE_S, clashS: 45, riseRate: 0.2, noiseGain: 0.3, talkRelief: 10, surveyRelief: 25, refusalRise: 20, strayAt: 150, strayRise: 40, reinforceAt: 120, reinforceRise: 15,
  sightPatrol: 24, fogFactor: 0.5,
} as const;

export interface BorderState extends BaseState {
  complication: ComplicationId; rain: number; tension: number;
  near: { marker: number; ward: number; rival: number };
  survey: { ward: boolean; rival: boolean }; plan: boolean; envelope: boolean; hostile: boolean; stray: boolean; reinforced: boolean; escalatedAt: number;
  ward: { alive: number; routed: number; down: number; total: number }; rival: { alive: number; routed: number; down: number; total: number };
  tally: CasualtyTally; brokePromise: boolean; paid: number;
}

const NO_PLAN_LINE = "\"What plan? If you have something to tell us, tell us. If you merely suspect, the Ward has a form for suspicion, but it is longer.\" The sergeant is unmoved, and the border is no calmer.";

function init(c: CampaignState, _asking: number, seed: number): BorderState {
  return {
    phase: "approach", t: 0, resolvedAt: 0, complication: dealComplication(c, "border_incident", seed), rain: 0, tension: 10 + (hash3(seed >>> 0, int(c.day, 0, 1e6, 0), 0xb04d) % 11),
    near: { marker: 0, ward: 0, rival: 0 }, survey: { ward: false, rival: false }, plan: false, envelope: false, hostile: false, stray: false, reinforced: false, escalatedAt: -1,
    ward: { alive: 2, routed: 0, down: 0, total: 2 }, rival: { alive: 3, routed: 0, down: 0, total: 3 }, tally: zeroTally(), brokePromise: false, paid: 0,
  };
}

const phaseOf = (s: BorderState): BorderState["phase"] =>
  s.escalatedAt >= 0 ? "escalated" : s.parley ? "parley" : s.near.marker + s.near.ward + s.near.rival > 0 || s.phase === "tension" || s.phase === "parley" ? "tension" : "approach";
const fin = (s: BorderState): BorderState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s), tension: clamp(Math.round(s.tension * 10) / 10, 0, 100) });
const relieve = (s: BorderState, n: number): BorderState => ({ ...s, tension: Math.max(0, s.tension - n) });

function escalate(s: BorderState): Reduction<BorderState> {
  if (s.escalatedAt >= 0) return stay(s);
  return {
    s: { ...s, escalatedAt: s.t, phase: "escalated", parley: undefined, tension: 100 },
    fx: [{ k: "war", a: "ward", b: "rival", on: true }, { k: "order", group: "ward", order: { o: "attack", side: "rival" } }, { k: "order", group: "rival", order: { o: "attack", side: "ward" } },
      ...(s.reinforced ? [{ k: "order", group: "late:reinf", order: { o: "attack", side: "rival" } } as ScenarioFx] : []),
      say("Somebody on the north bank says something about a mother. Somebody on the south bank answers in a better accent. Both sides open fire on each other, which has been coming since the maps.")],
  };
}

function reduce(s: BorderState, e: ScenarioInput): Reduction<BorderState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: BorderState = { ...s, t: s.t + dt };
      const fx: ScenarioFx[] = [];
      if (n.escalatedAt >= 0) {
        if (n.t - n.escalatedAt >= BORDER.clashS) return resolveWith(n, "escalated", {}, [say("The firing dies down because somebody has run out of something. The two sides glare across a ford that is now mostly spent brass.")]);
        return { s: n, fx };
      }
      n.tension += BORDER.riseRate * dt;
      if (s.complication === "stray_shot" && !n.stray && n.t >= BORDER.strayAt) {
        n = { ...n, stray: true, tension: n.tension + BORDER.strayRise };
        fx.push(say("A shot goes off on the south bank. Everyone swears it was not theirs, and meant it afterwards."));
      }
      if (s.complication === "reinforcements" && !n.reinforced && n.t >= BORDER.reinforceAt) {
        n = { ...n, reinforced: true, tension: n.tension + BORDER.reinforceRise };
        fx.push({ k: "spawn", group: "late:reinf" }, say("Two more Ward riflemen come down to the north bank, with a flag on a stick and a look of destiny."));
      }
      if (n.tension >= 100 || n.t >= BORDER.escalateS) {
        const r = escalate(n);
        return { s: r.s, fx: [...fx, ...r.fx] };
      }
      return { s: fin(n), fx };
    }
    case "weather": return stay({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 });
    case "near": {
      const at = e.at;
      if (at !== "marker" && at !== "ward" && at !== "rival") return stay(s);
      const n = int(e.party, 0, 8, 0);
      return s.near[at] === n ? stay(s) : stay(fin({ ...s, near: { ...s.near, [at]: n } }));
    }
    case "noise": {
      if (s.escalatedAt >= 0) return stay(s);
      const level = clamp(Number.isFinite(e.level) ? e.level : 0, 0, 100);
      if (level < 1) return stay(s);
      const n = fin({ ...s, tension: s.tension + level * BORDER.noiseGain });
      if (n.tension >= 100) return escalate(n);
      return stay(n);
    }
    case "hostile": {
      if (s.escalatedAt >= 0) return stay(s);
      // a player shot first: the side that was shot fights (the other is told to hold its fire); the border does not get to be a conversation any more
      const wronged = e.at === "ward" || e.at === "late:reinf" ? "ward" : e.at === "rival" ? "rival" : undefined;
      if (wronged === undefined) return stay(s);
      const other = wronged === "ward" ? "rival" : "ward";
      return resolveWith({ ...s, hostile: true, brokePromise: s.brokePromise || s.parley !== undefined }, "provoked", {}, [
        { k: "order", group: wronged, order: { o: "attack", side: "party" } }, { k: "order", group: other, order: { o: "hold_fire" } },
        say(wronged === "ward" ? "You have fired on the Ward's patrol. The Ward's patrol would like a word, and it is the one with a lead tail." : "You have fired on the Syndicate's surveyors. They have a lawyer, and he has a rifle."),
      ]);
    }
    case "count": {
      if (e.group !== "ward" && e.group !== "rival") return stay(s);
      const total = int(e.total, 0, 8, 0);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      const n = { ...s, [e.group]: { alive, routed, down, total } } as BorderState;
      if (n.escalatedAt >= 0 && ((n.ward.total > 0 && n.ward.alive === 0) || (n.rival.total > 0 && n.rival.alive === 0))) {
        return resolveWith(n, "escalated", {}, [say("One side of the Stone has stopped shooting, permanently. The other is unsure what to do with its hands.")]);
      }
      return stay(n);
    }
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "talk": {
      if (e.kind !== "ward_post" && e.kind !== "surveyor") return stay(s);
      if (e.result === "open") {
        if (s.escalatedAt >= 0) return { s, fx: [say("Nobody is listening any more. They are shooting.")] };
        if (s.parley) return stay(s);
        return { s: fin(relieve({ ...s, parley: e.kind }, BORDER.talkRelief)), fx: [{ k: "parley", kind: e.kind, price: 0 }] };
      }
      if (s.parley !== e.kind) return stay(s);
      const closed = { ...s, parley: undefined };
      switch (e.result) {
        case "close": return stay(fin(closed));
        case "hostile": return stay(fin({ ...closed, tension: s.tension + BORDER.refusalRise, brokePromise: true }));
        case "learn": return stay({ ...s, plan: true });
        case "survey": {
          const survey = { ...s.survey, [e.kind === "ward_post" ? "ward" : "rival"]: true };
          const n = fin(relieve({ ...closed, survey }, BORDER.surveyRelief));
          if (survey.ward && survey.rival) {
            return resolveWith(n, "mediated", {}, [
              { k: "order", group: "ward", order: { o: "stand_down" } }, { k: "order", group: "rival", order: { o: "stand_down" } }, { k: "war", a: "ward", b: "rival", on: false },
              say("Both sides sign. The Ward's copy is the third one; the Syndicate's copy is the other third one. Nobody will ever know who got the stone, which is the best result of the year."),
            ]);
          }
          return { s: n, fx: [say(survey.ward ? "The Ward patrol has agreed to a joint survey. Now the Syndicate." : "The Syndicate has agreed to a joint survey. Now the Ward patrol.")] };
        }
        case "tell": {
          if (e.kind !== "ward_post") return stay(s);
          if (!s.plan) return { s: fin({ ...closed, tension: s.tension + 5 }), fx: [say(NO_PLAN_LINE)] };
          return resolveWith(closed, "sided_ward", {}, [
            { k: "order", group: "rival", order: { o: "flee" } }, { k: "order", group: "ward", order: { o: "stand_down" } },
            say("The patrol detains you very politely as witnesses, and then at length. Across the water, the Syndicate decides it has urgent business elsewhere."),
          ]);
        }
        case "envelope": {
          if (e.kind !== "surveyor" || !s.plan) return stay(fin(closed));
          return { s: fin({ ...closed, envelope: true }), fx: [say("The envelope is in your coat. The Stone is in the ford. The Ward is on the bank. This will not take long.")] };
        }
        default: return stay(s);
      }
    }
    case "use": {
      if (e.target !== "marker" || s.near.marker < 1 || s.escalatedAt >= 0) return stay(s);
      if (!s.envelope) return { s, fx: [say("Marker Stone No. 4 weighs as much as a Committee and has about as much give. Somebody would have to be paying you.")] };
      return resolveWith(s, "sided_syndicate", {}, [
        { k: "order", group: "ward", order: { o: "alert" } }, { k: "order", group: "rival", order: { o: "stand_down" } },
        say("You pull Marker Stone No. 4 out of the ford. A surveyor writes the time down with a smile. A Ward patrol raises its rifles with a different expression: at you."),
      ]);
    }
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function leave(s: BorderState): ReturnType<TemplateDef<BorderState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  return s.phase === "approach" && tallyEmpty(s.tally) && !s.hostile && !s.parley ? undefined : "escalated";
}

function view(s: BorderState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "mediated" || res === "sided_ward" || res === "sided_syndicate";
  const objectives: ObjectiveView[] = [
    { id: "reach", text: "Reach Marker Stone No. 4 in the ford", done: s.phase !== "approach" },
    { id: "talk", text: `Talk to both sides (${(s.survey.ward ? 1 : 0) + (s.survey.rival ? 1 : 0)} of 2 agree to a joint survey)`, done: s.survey.ward && s.survey.rival },
    { id: "settle", text: res === "provoked" ? "Lost: somebody fired first" : res === "escalated" ? "Lost: the border went to war" : "Settle the border, by whatever means", done: won },
  ];
  if (s.envelope && res === undefined) objectives.push({ id: "stone", text: "Pull Marker Stone No. 4 (INTERACT at the Stone)", done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Sail home from the landing dock", done: false });
  const HINT: Record<string, string> = {
    approach: "Marker Stone No. 4 stands in the ford. A Ward patrol is on the north bank and Syndicate surveyors on the south. Both are armed with rifles, rulers and grievances.",
    tension: `Both sides are shouting across the water. The tension is ${Math.round(s.tension)} of 100. Talk lowers it. Shooting does not.`,
    parley: "Somebody is listening. Choose your words with a ruler.",
    escalated: "The two sides are shooting at each other. You are not the target. For now.",
  };
  const DONE: Record<string, string> = {
    mediated: "Peace, by signature. Sail home from the dock.",
    sided_ward: "The Ward is pleased and the Syndicate is gone. You are being detained, courteously. Sail home when released.",
    sided_syndicate: "The Stone is out of the ford. The Ward has opinions. Sail home from the dock.",
    provoked: "You fired first. The border is not impressed. Sail home from the dock.",
    escalated: "The ford is spent and the border is on the map in a worse place. Sail home from the dock.",
    abandoned: "The expedition is down. The border keeps its own counsel. Sail home and explain.",
  };
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  const ch = COMPLICATION_HINT[s.complication];
  if (res === undefined && ch) hint += ` ${ch}`;
  const remain = res !== undefined ? 0 : s.escalatedAt >= 0 ? BORDER.clashS - (s.t - s.escalatedAt) : BORDER.escalateS - s.t;
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(s.escalatedAt >= 0 ? "The shooting stops" : "The border loses patience", remain, now), template: "border_incident", title: "Marker Stone No. 4" };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: BorderState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return { scenario: "border_incident", resolution: s.resolution, toll: 0, paid: 0, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt), complication: s.complication };
}

const WARD_NAMES = ["Patrol-Sergeant Hettie Rook", "Patroller Wilmot Brandish"] as const;
const RIVAL_NAMES = ["Surveyor Ansel Quire-Dunmarrow", "Enforcer Roddy Vesk-Pym", "Enforcer Hilda Marrowgate"] as const;
const WARD_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.RIFLE];
const RIVAL_ARMS: readonly WeaponId[] = [WEAPON.UMBRELLA, WEAPON.RIFLE, WEAPON.PISTOL];

function roster(_c: CampaignState, seed: number, s: BorderState): NpcSpec[] {
  const B = KESSAR_SITES.border;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, faction: NpcSpec["faction"], group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, i: number): NpcSpec => ({
    id, role, faction, side: NPC_SIDE[role]!, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain: "garrison",
  });
  for (let i = 0; i < 2; i++) out.push(mk(`ward-${i}`, NPC.SENTRY, "ward", "ward", B.ward[i]!, WARD_ARMS[i]!, WARD_NAMES[i]!, 50, 55, i));
  for (let i = 0; i < 3; i++) out.push(mk(`rival-${i}`, i === 0 ? NPC.RIVAL_SURVEYOR : NPC.RIVAL_GUARD, "rival", "rival", B.rival[i]!, RIVAL_ARMS[i]!, RIVAL_NAMES[i]!, i === 0 ? 30 : 58, i === 0 ? 30 : 55, 2 + i));
  if (s.complication === "reinforcements") {
    out.push(mk("reinf-0", NPC.SENTRY, "ward", "late:reinf", { x: B.ward[0]!.x - 3, z: B.ward[0]!.z - 4 }, WEAPON.RIFLE, "Rifleman Dorcas Pettigrew", 48, 50, 5));
    out.push(mk("reinf-1", NPC.SENTRY, "ward", "late:reinf", { x: B.ward[1]!.x + 3, z: B.ward[1]!.z - 4 }, WEAPON.RIFLE, "Rifleman Alaric Dunn", 48, 50, 6));
  }
  return out;
}

const observe: ObserveSpec = {
  near: [
    { id: "marker", x: KESSAR_SITES.border.marker.x, z: KESSAR_SITES.border.marker.z, r: 3.2 },
    { id: "ward", x: KESSAR_SITES.border.ward[0]!.x, z: KESSAR_SITES.border.ward[0]!.z, r: 10 },
    { id: "rival", x: KESSAR_SITES.border.rival[1]!.x, z: KESSAR_SITES.border.rival[1]!.z, r: 10 },
  ],
  use: [
    { id: "ward_post", npc: "ward-0", r: 2.4, talk: "ward_post", carry: "none" },
    { id: "surveyor", npc: "rival-0", r: 2.4, talk: "surveyor", carry: "none" },
    { id: "marker", at: KESSAR_SITES.border.marker, r: 3.2, carry: "none" },
  ],
  count: [{ group: "ward" }, { group: "rival" }],
  seen: [],
  noise: { x: KESSAR_SITES.border.marker.x, z: KESSAR_SITES.border.marker.z },
  actors: [],
  hostileGroups: ["ward", "rival", "late:reinf"],
};

export const borderTemplate: TemplateDef<BorderState> = {
  id: "border_incident", title: "Marker Stone No. 4",
  brief: "The border runs through a ford, and both sides have brought lawyers with rifles. Keep the peace, sell it, or start the war, and mind the Stone.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { marker: KESSAR_SITES.border.marker },
};
