import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { HOSTAGE_DEADLINE_S, KESSAR_ANCHORS, KESSAR_SITES, NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { NPC_SIDE, type NpcSpec } from "../expeditionTypes.ts";
import { clamp } from "../math.ts";
import { hash3 } from "../rng.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * HOSTAGE RESCUE, "The Cartwright's Cage". Mr. Percival Quim, junior surveyor, "insured", sits in a cage wagon at Hangman's Orchard (KESSAR_SITES.hostage)
 * among four deserters who are carousing and one who is not. Four endings: `ransomed` (a parley and cash, no shots), `slipped_away` (open the cage while
 * nobody has SEEN you and the camp has heard nothing loud, then walk him to the landing dock), `rescued` (the alarm went up: break three of the four, open
 * the cage, get him to the dock alive), `hostage_lost` (the deadline, or he is downed). The reducer holds every rule; the runner only reports facts.
 */

export const HOSTAGE = {
  deadline: HOSTAGE_DEADLINE_S, bidDeadline: 300, reinforceAt: 240,
  alarmNoise: 70, stealthNoise: 40, rainNoiseBonus: 15, noiseDecay: 4,
  brokenNeeded: 3,
  /** Metres: the carousers have their backs to the cage and a bottle each; the lookout is paid to look. */
  sightCarousers: 5, sightLookout: 12,
  /** A carouser who sees you hails you rather than shooting: you have this long to open a parley (or be gone) before it is an alarm. */
  challengeS: 6,
  /**
   * D-041: the lookout hails too, from further off, and gives you longer: the colour-sergeant is across the camp from him. (He used to shoot on sight, which made the
   * ransom unreachable for anyone who walked up the road to pay it: the bot playtest's paying party was under fire before it had said a word.)
   */
  lookoutChallengeS: 15,
  ransomBase: 35, ransomMax: 90,
  /**
   * Metres round the dock goal (4 m inland of the landing) inside which Mr. Quim has ARRIVED. D-041: he follows 4-5 m behind his rescuer, so at 5 m a party standing
   * at the dock's edge left him short and nothing happened, and taking the boat then lost him; wide enough that anyone at the boat has brought him in.
   */
  dockRadius: 9,
} as const;

export interface HostageState extends BaseState {
  complication: ComplicationId; rain: number; purse: number; ransom: number; deadline: number; reinforced: boolean;
  near: { camp: number; cage: number; lookout: number };
  captors: { alive: number; routed: number; down: number; total: number };
  seen: boolean; hostile: boolean; alarm: boolean; noise: number; challenge: number;
  cage: boolean; hostage: "caged" | "free" | "arrived" | "down";
  tally: CasualtyTally; brokePromise: boolean; paid: number;
}

const NAMES = ["Colour-Sergeant Barnaby Cull", "Gunner Ludo Marrowby", "Private Edda Fenwick-Gone", "Trooper Wick Haverstock"] as const;
const ARMS: readonly WeaponId[] = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE];
const REINF_POSTS = [{ x: 62, z: -29 }, { x: 60, z: -21 }] as const;

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): HostageState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "hostage_rescue", seed, presence);
  const ransom = clamp(HOSTAGE.ransomBase + Math.round(c.factions.ward.rivalInfluence * 0.3) + (hash3(seed >>> 0, day, 0x4a11) % 11), 20, HOSTAGE.ransomMax);
  return {
    phase: "planning", t: 0, resolvedAt: 0, complication, rain: 0, purse: int(c.purse, 0, 99999, 0), ransom: Math.round(ransom / 5) * 5,
    deadline: complication === "rival_bid" ? HOSTAGE.bidDeadline : HOSTAGE.deadline, reinforced: false,
    near: { camp: 0, cage: 0, lookout: 0 }, captors: { alive: 4, routed: 0, down: 0, total: 4 },
    seen: false, hostile: false, alarm: false, noise: 0, challenge: 0, cage: false, hostage: "caged", tally: zeroTally(), brokePromise: false, paid: 0,
  };
}

const phaseOf = (s: HostageState): HostageState["phase"] =>
  s.parley ? "parley" : s.hostage === "free" || s.hostage === "arrived" ? "extract" : s.alarm ? "fighting" : s.near.camp > 0 || s.near.cage > 0 ? "standoff" : "planning";
const fin = (s: HostageState): HostageState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });
const broken = (s: HostageState): number => s.captors.routed + s.captors.down;
const rainy = (s: HostageState): boolean => s.complication === "rain" || s.rain >= 0.45;

/** The camp wakes: everybody who can fight is told. First cause wins; later ones change nothing. */
function raise(s: HostageState, why: string, brokePromise = false): Reduction<HostageState> {
  const bp = s.brokePromise || brokePromise;
  if (s.alarm) return { s: fin({ ...s, brokePromise: bp }), fx: [] };
  const fx: ScenarioFx[] = [
    { k: "order", group: "deserters", order: { o: "alert" } }, { k: "order", group: "lookout", order: { o: "alert" } },
    ...(s.reinforced ? [{ k: "order", group: "late:reinf", order: { o: "alert" } } as ScenarioFx] : []),
    say(why),
  ];
  return { s: fin({ ...s, alarm: true, parley: undefined, brokePromise: bp }), fx };
}

function reduce(s: HostageState, e: ScenarioInput): Reduction<HostageState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      const dt = dtOf(e);
      let n: HostageState = { ...s, t: s.t + dt, noise: Math.max(0, s.noise - HOSTAGE.noiseDecay * dt) };
      const fx: ScenarioFx[] = [];
      // a hailed party that walks away has answered the question (but the Orchard will be watching the cage now: `seen` stays)
      if (n.challenge > 0 && !n.parley && !n.alarm && n.near.camp === 0 && n.near.cage === 0 && n.near.lookout === 0) {
        n.challenge = 0;
        fx.push(say("\"And stay gone.\" The Orchard settles back to its bottles, but it will be watching the cage now."));
      }
      if (n.challenge > 0 && !n.parley && !n.alarm) {
        n.challenge = Math.max(0, n.challenge - dt);
        if (n.challenge === 0) {
          const r = raise(n, "\"That's quite enough standing there.\" The Orchard's patience, and its rifles, come out together.");
          n = r.s;
          fx.push(...(r.fx as ScenarioFx[]));
        }
      }
      if (s.complication === "reinforcements" && !s.reinforced && n.t >= HOSTAGE.reinforceAt) {
        n = { ...n, reinforced: true };
        fx.push({ k: "spawn", group: "late:reinf" }, say("Two more deserters have arrived at the Orchard with a keg and an opinion of the Syndicate."));
        if (n.alarm) fx.push({ k: "order", group: "late:reinf", order: { o: "alert" } });
      }
      if (n.t >= n.deadline && n.hostage !== "arrived") {
        const r = resolveWith(n, "hostage_lost", {}, [...fx, { k: "order", group: "deserters", order: { o: "stand_down" } }, say("A Syndicate buyer arrives with a cheque and a tin of biscuits. Mr. Quim has been bought, in every sense but the clerical.")]);
        return r;
      }
      return { s: fin(n), fx };
    }
    case "weather": return stay(fin({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 }));
    case "near": {
      const at = e.at;
      if (at !== "camp" && at !== "cage" && at !== "lookout") return stay(s);
      const n = Math.max(0, Math.min(8, int(e.party, 0, 8, 0)));
      return s.near[at] === n ? stay(s) : stay(fin({ ...s, near: { ...s.near, [at]: n } }));
    }
    case "noise": {
      const level = clamp(Number.isFinite(e.level) ? e.level : 0, 0, 100);
      if (level <= s.noise) return stay(s);
      const n = { ...s, noise: level };
      return level >= HOSTAGE.alarmNoise ? raise(n, "A shot rolls across the scrub. The Orchard is on its feet.") : stay(n);
    }
    case "seen": {
      if (e.group !== "deserters" && e.group !== "lookout" && e.group !== "late:reinf") return stay(s);
      if (s.alarm) return stay(s);
      // a fresh arrival shoots first; a carouser or the lookout hails you (talk to the colour-sergeant, or leave)
      if (e.group === "late:reinf") return raise({ ...s, seen: true }, "\"Intruder!\" The new arrivals have seen you, and the whole Orchard has heard them.");
      if (s.challenge > 0 || s.parley) return stay(s);
      if (e.group === "lookout") {
        return { s: fin({ ...s, seen: true, challenge: HOSTAGE.lookoutChallengeS }), fx: [say("\"Halt! Who goes there?\" The lookout has his rifle on you. \"Sergeant! Visitors!\" Speak to the colour-sergeant, or go back the way you came.")] };
      }
      return { s: fin({ ...s, seen: true, challenge: HOSTAGE.challengeS }), fx: [say("\"Oi! You! State your business, or he will state it for you.\" A deserter has noticed you. There is a bottle in one hand and a rifle in the other, and he has not yet decided which.")] };
    }
    case "hostile": {
      if (e.at !== undefined && e.at !== "deserters" && e.at !== "lookout" && e.at !== "late:reinf") return stay(s);
      return raise({ ...s, hostile: true }, "A deserter goes down. The Orchard remembers it has weapons.", s.parley !== undefined);
    }
    case "count": {
      if (e.group !== "deserters") return stay(s);
      const total = int(e.total, 0, 8, s.captors.total);
      const alive = int(e.alive, 0, total), routed = int(e.routed, 0, total - alive), down = int(e.down, 0, total - alive - routed);
      const n = fin({ ...s, captors: { alive, routed, down, total } });
      if (n.hostage === "arrived" && n.alarm && broken(n) >= HOSTAGE.brokenNeeded) return rescued(n);
      return stay(n);
    }
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "actor": {
      if (e.id !== "hostage") return stay(s);
      if (e.state === "down") {
        if (s.hostage === "down") return stay(s);
        return resolveWith({ ...s, hostage: "down" }, "hostage_lost", {}, [say("Mr. Quim is down. The paperwork will describe it as 'an inconvenience of insured persons'.")]);
      }
      if (e.state === "arrived" && s.hostage === "free") {
        if (!s.alarm) return resolveWith({ ...s, hostage: "arrived" }, "slipped_away", {}, [say("Mr. Quim reaches the dock. \"Is it over? Nobody told me there would be so much walking.\" Nobody saw you go. It is the most elegant thing the Society has done this year.")]);
        const n = fin({ ...s, hostage: "arrived" });
        return broken(n) >= HOSTAGE.brokenNeeded ? rescued(n) : { s: n, fx: [say("Mr. Quim is at the dock and safe. The Orchard is not: break three of the four and the Society may call it a rescue.")] };
      }
      return stay(s);
    }
    case "use": {
      if (e.target !== "cage" || s.hostage !== "caged" || s.near.cage < 1) return stay(s);
      const limit = HOSTAGE.stealthNoise + (rainy(s) ? HOSTAGE.rainNoiseBonus : 0);
      const quiet = !s.alarm && !s.seen && s.noise < limit;
      const opened: HostageState = fin({ ...s, cage: true, hostage: "free" });
      const fx: ScenarioFx[] = [{ k: "open", what: "cage" }];
      if (quiet) return { s: opened, fx: [...fx, say("The cage door opens on greased hinges. \"Is this the rescue?\" whispers Mr. Quim. \"I was told there would be a form.\" Walk him to the landing dock, quietly.")] };
      const r = raise(opened, "The lock shrieks. So much for subtlety. The Orchard, and several of its bottles, are on their feet.");
      return { s: r.s, fx: [...fx, ...r.fx] };
    }
    case "talk": {
      if (e.kind !== "ransom") return stay(s);
      if (e.result === "open") {
        if (s.parley || s.hostage !== "caged") return stay(s);
        if (s.alarm) return { s, fx: [say("The deserters are in no mood to haggle. They are in a mood to shoot.")] };
        return { s: fin({ ...s, parley: "ransom" }), fx: [{ k: "parley", kind: "ransom", price: s.ransom }] };
      }
      if (s.parley !== "ransom") return stay(s);
      switch (e.result) {
        case "close": return stay(fin({ ...s, parley: undefined }));
        case "hostile": return raise({ ...s, hostile: true }, "You have made your point, with a bullet. The deserters are fond of that kind of point.", true);
        case "ransom": {
          const lo = Math.round(s.ransom * 0.75), hi = Math.round(s.ransom * 1.25);
          const paid = int(e.paid, 0, 9999, 0);
          if (s.alarm || paid < lo || paid > hi || paid > s.purse) return stay(fin({ ...s, parley: undefined }));
          return resolveWith({ ...s, hostage: "free", cage: true }, "ransomed", { paid }, [
            { k: "open", what: "cage" }, { k: "order", group: "deserters", order: { o: "stand_down" } }, { k: "order", group: "lookout", order: { o: "stand_down" } },
            say(`£${paid} changes hands. Mr. Quim is returned with the lid of a biscuit tin as a receipt.`),
          ]);
        }
        default: return stay(s);
      }
    }
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function rescued(s: HostageState): Reduction<HostageState> {
  return resolveWith(s, "rescued", {}, [{ k: "order", group: "deserters", order: { o: "stand_down" } }, say("The Orchard is broken and Mr. Quim is at the dock, insured and aggrieved. \"I should like it noted,\" he says, \"that I was rescued late.\"")]);
}

function leave(s: HostageState): ReturnType<TemplateDef<HostageState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  if (s.hostage === "arrived") return s.alarm ? "rescued" : "slipped_away";
  const nothing = (s.phase === "planning" || s.phase === "standoff") && tallyEmpty(s.tally) && !s.alarm && !s.hostile && s.hostage === "caged" && !s.parley;
  return nothing ? undefined : "hostage_lost";
}

function view(s: HostageState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "ransomed" || res === "rescued" || res === "slipped_away";
  const need = HOSTAGE.brokenNeeded;
  const hailed = s.challenge > 0 && !s.parley && !s.alarm && res === undefined;
  const objectives: ObjectiveView[] = [
    { id: "find", text: "Find the deserters' camp at Hangman's Orchard", done: s.seen || s.near.camp > 0 || s.near.cage > 0 || s.phase !== "planning" },
    // (before the cage, so the compass points at the man you must answer)
    ...(hailed ? [{ id: "explain", text: "Hailed: talk to the colour-sergeant, or walk well away", done: false }] : []),
    { id: "free", text: res === "hostage_lost" ? "Lost: Mr. Quim did not come home" : "Free Mr. Quim from the cage: pay, sneak him out, or fight", done: s.cage || won },
  ];
  if (s.alarm && !won && res === undefined) objectives.push({ id: "break", text: `Drop the deserters or send them running (${Math.min(need, broken(s))} of ${need})`, done: broken(s) >= need, optional: true });
  objectives.push({ id: "dock", text: "Walk Mr. Quim to the landing dock alive", done: won });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the landing", done: false });

  const HINT: Record<string, string> = {
    planning: "Mr. Percival Quim, junior surveyor and insured, is in a cage at Hangman's Orchard in the north-east scrub. The deserters are carousing. Approach by the ford: the lookout on the south-west rise will hail anyone who walks up, and crouching keeps you out of sight.",
    standoff: "You are at the Orchard. The colour-sergeant takes cash. The cage takes patience. The rifles take neither. Anyone who sees you will give you a few seconds to explain.",
    parley: "The colour-sergeant is listening. He has named a price.",
    fighting: "The camp is up. Break three of the four, open the cage, and walk the surveyor to the dock.",
    extract: s.alarm ? "Quim is out and the camp is awake. Get him to the landing dock alive." : "Quim is out and nobody knows. Walk him to the landing dock, quietly.",
  };
  const DONE: Record<string, string> = {
    ransomed: "Paid in full; the receipt is a biscuit-tin lid. The Orchard's deserters are now the best-funded unit in Kessar. Take the boat home.",
    rescued: "Rescued, late and loudly, and the Orchard is a good deal quieter for it. Take the boat home from the dock.",
    slipped_away: "Out without a shot. Nobody will believe it, least of all the Society, which had budgeted for a funeral. Take the boat home.",
    hostage_lost: "Mr. Quim is gone. His insurers have begun reading the small print aloud, slowly, to the Society. Take the boat home.",
    abandoned: "The expedition is down. The Orchard opens another bottle. Take the boat home and explain.",
  };
  let hint = res !== undefined ? DONE[res] ?? "" : hailed ? "They have seen you and want an answer. Walk up to the colour-sergeant (he has the pistol) and Use to talk, or walk well away before they lose patience." : HINT[s.phase] ?? "";
  const ch = COMPLICATION_HINT[s.complication];
  if (res === undefined && ch) hint += ` ${ch}`;
  const remain = s.phase === "resolved" || s.hostage === "arrived" ? 0 : s.deadline - s.t;
  const clock = hailed ? timer("Their patience", s.challenge, now) : timer("The Syndicate buys him", remain, now);
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...clock, template: "hostage_rescue", title: "The Cartwright's Cage", ...ruleWhile("hostage_rescue", res === undefined && !s.alarm) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: HostageState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "hostage_rescue", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication,
  };
}

function roster(_c: CampaignState, seed: number, s: HostageState): NpcSpec[] {
  const H = KESSAR_SITES.hostage;
  const out: NpcSpec[] = [];
  const mk = (id: string, role: number, group: string, post: { x: number; z: number }, weapon: WeaponId, name: string, skill: number, bravery: number, brain: NpcSpec["brain"], i: number): NpcSpec => ({
    id, role, faction: "rival", side: NPC_SIDE[role]!, group, post: { x: post.x, z: post.z }, weapon, lookSeed: hash3(seed >>> 0, i, role), name, skill, bravery, brain,
  });
  for (let i = 0; i < 4; i++) out.push(mk(`deserter-${i}`, NPC.DESERTER, "deserters", H.posts[i]!, ARMS[i]!, NAMES[i]!, 40 + (hash3(seed >>> 0, i, 0x5a1) % 16), 38 + (hash3(seed >>> 0, i, 0xb5) % 20), "garrison", i));
  out.push(mk("lookout-0", NPC.DESERTER, "lookout", H.lookout, WEAPON.RIFLE, "Picket Dobbin Late", 55, 50, "garrison", 4));
  out.push(mk("hostage", NPC.HOSTAGE, "hostage", H.cage, WEAPON.FISTS, "Mr. Percival Quim", 10, 20, "civil", 5));
  if (s.complication === "reinforcements") {
    out.push(mk("reinf-0", NPC.DESERTER, "late:reinf", REINF_POSTS[0], WEAPON.RIFLE, "Corporal Hob Dankworth", 50, 42, "garrison", 6));
    out.push(mk("reinf-1", NPC.DESERTER, "late:reinf", REINF_POSTS[1], WEAPON.PISTOL, "Gunner Pim Oddly", 46, 40, "garrison", 7));
  }
  return out;
}

const observe: ObserveSpec = {
  near: [
    { id: "camp", x: KESSAR_SITES.hostage.cage.x, z: KESSAR_SITES.hostage.cage.z, r: 22 },
    { id: "cage", x: KESSAR_SITES.hostage.cage.x, z: KESSAR_SITES.hostage.cage.z, r: 2.6 },
    { id: "lookout", x: KESSAR_SITES.hostage.lookout.x, z: KESSAR_SITES.hostage.lookout.z, r: 14 },
  ],
  use: [
    { id: "ransom", npc: "deserter-0", r: 2.4, talk: "ransom", carry: "none" },
    { id: "cage", at: KESSAR_SITES.hostage.cage, r: 2.6, carry: "none" },
  ],
  count: [{ group: "deserters" }],
  seen: [{ group: "deserters", sight: HOSTAGE.sightCarousers }, { group: "lookout", sight: HOSTAGE.sightLookout }, { group: "late:reinf", sight: HOSTAGE.sightLookout }],
  noise: { x: KESSAR_SITES.hostage.cage.x, z: KESSAR_SITES.hostage.cage.z },
  actors: [{ id: "hostage", goal: { x: KESSAR_ANCHORS.landing.x, z: KESSAR_ANCHORS.landing.z - 4, r: HOSTAGE.dockRadius }, boards: true }],
  hostileGroups: ["deserters", "lookout", "late:reinf"],
};

export const hostageTemplate: TemplateDef<HostageState> = {
  id: "hostage_rescue", title: "The Cartwright's Cage",
  brief: "Mr. Percival Quim, junior surveyor, sits in a cage wagon at Hangman's Orchard, held by deserters who have read his insurance policy more closely than the Society ever did. They will sell him back; the Syndicate will buy him first if you dawdle. Pay the colour-sergeant, open the cage while the Orchard drinks, or break the camp and walk him home.",
  init, reduce, view, outcome, roster, leave, observe,
  sites: { cage: KESSAR_SITES.hostage.cage, camp: KESSAR_SITES.hostage.cage },
  opening: () => [],
};
