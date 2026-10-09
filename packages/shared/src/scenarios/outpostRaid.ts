import type { CampaignState, CasualtyTally, ComplicationId, ObjectiveView, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { KESSAR_SITES, NPC } from "../campaignTypes.ts";
import { COMPLICATION_HINT, dealComplication } from "../chaos.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { FOLLOWER_DEFS } from "../followers.ts";
import { KESSAR_OUTPOST } from "../outpost.ts";
import { hash3 } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { WEAPON, type WeaponId } from "../weapons.ts";
import type { OutpostStage, RivalPresence } from "../worldTypes.ts";
import { addTally, dtOf, frozen, int, resolveWith, say, stay, tallyEmpty, timer, zeroTally } from "./common.ts";
import type { BaseState, ObserveSpec, Reduction, TemplateDef } from "./types.ts";
import { ruleWhile } from "./terms.ts";

/**
 * THE RAID ON THE POST (D-045, Kessar's fifth contract: the GDD's outpost defence). Offered at Kessar only while the Syndicate's agent means to raid the party's outpost (`presence.raidDue`):
 * instead of the raid landing abstractly between expeditions, the party is there when it comes. A raiding party lands upstream at `raidAt`, marches to a muster point at the edge of the post
 * and halts while its captain offers a "security consultation"; when his demand runs out (or the party opens fire, or tells him to come and try) the raiders march on the yard with torches.
 *  - `post_held`: the raiders broken (down or routed, 70% of them) before they fire the stores.
 *  - `post_burned`: two raiders standing in the yard for TORCH_S together: the stores burn and the raid lands (WorldRoom.commitOutcome hands it to the outposts).
 *  - `protection_paid`: the captain's price, paid: the raiders go home, the post stands, the Syndicate has a client.  `abandoned`: the party is down.
 * Complications (existing ids only): reinforcements add two raiders; fog delays the raid; rain makes the torches slow (a longer burn).
 */

export const RAID = {
  /** The raiders land this many seconds in (seeded): time to get to the post and set up. */
  raidMin: 70, raidMax: 100, fogRaid: 30,
  /** The captain's demand lasts this long at the muster. */
  demandS: 45,
  /** Raiders standing in the yard together for this long burn the stores (rain: longer). */
  torchS: 15, rainTorch: 10, torchersNeeded: 2,
  /** D-047: a post's stout sheds take longer to fire (seconds added by stage): the fort is worth defending from, not a blind wall the raiders swarm through. */
  stout: { none: 0, camp: 0, trading_post: 3, fortified_outpost: 10, settlement: 12, town: 15 } as Readonly<Record<OutpostStage, number>>,
  /**
   * The post's own WATCH by stage: riflemen the Society keeps at a stockaded post. A lone defender cannot hold a fortified post without them (the bot playtest, D-047: four of four
   * lost within seconds of contact, the stockade hiding the raiders until they were at sabre range); a stockade is a place that has a watch. They come down from the tower to stand
   * inside the gate when the PARTY gets to the post, and not before: a party that stays away still loses its stores (with the watch out alone, three held a town by themselves and
   * two fought the raiders to a standstill at a fort for seven minutes: bot playtest, D-048). The party's side, answering fire like hired hands: they never start the fight.
   */
  watch: { none: 0, camp: 0, trading_post: 0, fortified_outpost: 2, settlement: 2, town: 3 } as Readonly<Record<OutpostStage, number>>,
  /** Share of the raiders down or routed that breaks the raid. */
  brokenFraction: 0.7,
  /** How widely the raiders spread at their ranks while the captain talks (metres across). */
  ranksR: 8,
  raiders: 5, extraRaiders: 2,
  /** Radius of the yard the raiders must stand in, and of the post (the party "at the post"). */
  yardR: 7, postR: 22,
  priceProtection: [50, 85],
  personR: 2.4,
} as const;

const SITE = KESSAR_OUTPOST.site;
/**
 * Where the raiders land (upstream on the south bank, west of the Syndicate's post), halt for the captain's demand, and walk in (round to the north gate, then the yard). The Cast walks a
 * route's legs STRAIGHT, so every leg is clear on the nav grid at every outpost stage, both bridges and seven seeds (`outpostRaid.test.ts`): the landing is hemmed in by the Syndicate's own
 * post and the scatter, and a town's houses stand across the direct line, so the walk swings north first. The assault is the whole chain, joined at the nearest waypoint (`join`), so a
 * raid that starts before the muster is reached still walks only clear legs.
 */
const MUSTER_WALK = KESSAR_SITES.raid.walk;
export const RAID_SITES = {
  landing: MUSTER_WALK[0],
  muster: MUSTER_WALK[3],
  /** Where the raiders stand while their captain talks: spread behind him (a `guard` order, planned on the nav grid), so the party meets the captain first and sees a party, not a clump. */
  ranks: { x: 54, z: 50 },
  route: MUSTER_WALK,
  assault: [...MUSTER_WALK, KESSAR_SITES.raid.round, { x: SITE.x, z: SITE.z - 18 }, { x: SITE.x, z: SITE.z - 8 }, { x: SITE.x, z: SITE.z }],
} as const;

export interface RaidState extends BaseState {
  complication: ComplicationId;
  near: { post: number };
  landed: boolean; raidAt: number;
  /** The captain's demand runs out at this time (0 until the raiders muster). */
  demandUntil: number;
  attacking: boolean;
  crew: { alive: number; routed: number; down: number; total: number };
  /** Raiders who reached the yard and are not down (ids), and since when two or more have been there together. */
  inYard: string[]; torchSince: number;
  /** D-047: seconds the post's own sheds add to the torch time (by its stage when the contract began). */
  stout?: number;
  /** The post's watch (`RAID.watch` by its stage when the contract began); absent at a post with no stockade. `watchOut`: it has come down to stand with the party. */
  watch?: number;
  watchOut?: boolean;
  captainGone: boolean;
  price: number;
  purse: number; spent: number; paid: number;
  tally: CasualtyTally; brokePromise: boolean;
}

const rnd5 = (lo: number, hi: number, h: number): number => lo + 5 * (h % Math.floor((hi - lo) / 5 + 1));

function init(c: CampaignState, _asking: number, seed: number, presence?: RivalPresence): RaidState {
  const day = int(c.day, 0, 1e6, 0);
  const complication = dealComplication(c, "outpost_raid", seed, presence);
  const h = (k: number): number => hash3(seed >>> 0, day, 0x2a1d + k);
  const n = RAID.raiders + (complication === "reinforcements" ? RAID.extraRaiders : 0);
  return {
    phase: "planning", t: 0, resolvedAt: 0, complication, near: { post: 0 }, landed: false,
    raidAt: Math.round(RAID.raidMin + (h(1) % (RAID.raidMax - RAID.raidMin + 1)) + (complication === "fog" ? RAID.fogRaid : 0)),
    demandUntil: 0, attacking: false, crew: { alive: n, routed: 0, down: 0, total: n }, inYard: [], torchSince: 0, captainGone: false,
    ...(presence?.partyPost && RAID.stout[presence.partyPost] > 0 ? { stout: RAID.stout[presence.partyPost] } : {}),
    ...(presence?.partyPost && RAID.watch[presence.partyPost] > 0 ? { watch: RAID.watch[presence.partyPost] } : {}),
    price: rnd5(...RAID.priceProtection, h(2)), purse: int(c.purse, 0, 99999, 0), spent: 0, paid: 0, tally: zeroTally(), brokePromise: false,
  };
}

// ---- small predicates -----------------------------------------------------------------------------------------------------------------------

const brokenCount = (s: RaidState): number => s.crew.routed + s.crew.down;
const needed = (s: RaidState): number => Math.ceil(s.crew.total * RAID.brokenFraction);
const isBroken = (s: RaidState): boolean => s.crew.total > 0 && brokenCount(s) >= needed(s);
const torchS = (s: RaidState): number => RAID.torchS + (s.stout ?? 0) + (s.complication === "rain" ? RAID.rainTorch : 0);
const affordable = (s: RaidState, n: number): boolean => n >= 0 && n <= s.purse - s.spent;
const phaseOf = (s: RaidState): RaidState["phase"] =>
  s.parley ? "parley" : s.attacking ? "fighting" : s.demandUntil > 0 ? "standoff" : s.landed ? "tension" : "planning";
const fin = (s: RaidState): RaidState => (s.phase === "resolved" ? s : { ...s, phase: phaseOf(s) });

/** The raiders go for the yard: first cause wins. */
// (the captain sends his men and stays at the muster with his list: he holds fire, a consultant, not a sixth gun; the bot playtest's lone defender lost to him when he joined in)
function assault(s: RaidState, why: string): Reduction<RaidState> {
  if (s.attacking || !s.landed) return stay(fin(s));
  return {
    s: fin({ ...s, attacking: true, demandUntil: 0, parley: s.parley === "raid_captain" ? undefined : s.parley }),
    fx: [{ k: "order", group: "late:raiders", order: { o: "alert" } }, { k: "order", group: "late:raiders", order: { o: "march", route: "assault", join: true } }, { k: "order", group: "late:captain", order: { o: "hold_fire" } }, say(why)],
  };
}

// ---- the reducer ------------------------------------------------------------------------------------------------------------------------------

function reduce(s: RaidState, e: ScenarioInput): Reduction<RaidState> {
  if (s.phase === "resolved") return frozen(s, e);
  switch (e.t) {
    case "tick": {
      let n: RaidState = { ...s, t: s.t + dtOf(e) };
      const fx: ScenarioFx[] = [];
      if (!n.landed && n.t >= n.raidAt) {
        n = { ...n, landed: true, demandUntil: n.t + RAID.demandS };
        fx.push({ k: "spawn", group: "late:raiders" }, { k: "spawn", group: "late:captain" },
          { k: "order", group: "late:raiders", order: { o: "guard", x: RAID_SITES.ranks.x, z: RAID_SITES.ranks.z, r: RAID.ranksR } },
          { k: "order", group: "late:captain", order: { o: "guard", x: RAID_SITES.muster.x, z: RAID_SITES.muster.z, r: 0 } },
          say(`A Syndicate launch noses into the south bank upstream and puts a raiding party ashore: ${n.crew.total} men with torches, and a captain with a list. They are coming down the bank toward the post.`));
      }
      if (n.landed && !n.attacking && n.demandUntil > 0 && n.t >= n.demandUntil) {
        const r = assault(n, "The captain looks at his watch, shows it to you, and drops his torch into the grass. \"Gentlemen: the yard.\"");
        n = r.s;
        fx.push(...(r.fx as ScenarioFx[]));
      }
      // the yard: two raiders standing in it together long enough, and the stores go up
      if (n.attacking && n.inYard.length >= RAID.torchersNeeded) {
        if (n.torchSince === 0) n = { ...n, torchSince: n.t };
        else if (n.t - n.torchSince >= torchS(n)) {
          return resolveWith(n, "post_burned", {}, [...fx,
            say("The torches go into the store-sheds. The stores go up with a sound like a ledger being closed. The raiders cheer, take the flag down to have something to carry, and leave by the gate, unhurried.")]);
        }
      } else if (n.torchSince !== 0) n = { ...n, torchSince: 0 };
      return { s: fin(n), fx };
    }
    case "near": {
      if (e.at !== "post") return stay(s);
      const k = int(e.party, 0, 8, 0);
      if (s.near.post === k) return stay(s);
      const n = fin({ ...s, near: { post: k } });
      // the party is at the post: the watch comes down from the tower and stands with it (once)
      if (k > 0 && (s.watch ?? 0) > 0 && !s.watchOut) {
        return { s: { ...n, watchOut: true }, fx: [{ k: "spawn", group: "late:watch" }, say(`The post's watch comes down from the tower to stand with you: ${s.watch} Society pensioners with rifles, at the gate. They will answer fire; they will not start it.`)] };
      }
      return stay(n);
    }
    case "hostile": {
      if (e.at !== "late:raiders" && e.at !== "late:captain") return stay(s);
      return assault({ ...s, brokePromise: s.brokePromise || s.paid > 0 }, "Shots at the muster. The raiders stop consulting and start running at the yard, torches high.");
    }
    case "count": {
      // (the runner counts every observed group every tick: before the landing the Cast reports an empty group, which says nothing about the raid)
      if (e.group !== "late:raiders" || !s.landed || !(e.total > 0)) return stay(s);
      const tot = int(e.total, 1, RAID.raiders + RAID.extraRaiders, s.crew.total);
      const alive = int(e.alive, 0, tot), routed = int(e.routed, 0, tot - alive), down = int(e.down, 0, tot - alive - routed);
      const n = fin({ ...s, crew: { alive, routed, down, total: tot } });
      if (n.landed && isBroken(n)) {
        return resolveWith(n, "post_held", {}, [{ k: "order", group: "late:raiders", order: { o: "flee" } }, { k: "order", group: "late:captain", order: { o: "flee" } },
          say("The raid breaks. The men who can still run do, back up the bank to their launch, and the captain goes with them, writing as he runs. The stores stand. Somewhere on the fort's wall, the Lamp-Warden lowers a telescope.")]);
      }
      return stay(n);
    }
    case "actor": {
      const m = /^raider-(\d)$/.exec(e.id);
      if (m && e.state === "arrived") {
        if (!s.attacking || s.inYard.includes(e.id)) return stay(s);
        const n = fin({ ...s, inYard: [...s.inYard, e.id] });
        return { s: n, fx: n.inYard.length === RAID.torchersNeeded ? [say(`Two raiders are in the yard with torches. Drop one of them: ${torchS(n)} seconds and the stores go up.`)] : [] };
      }
      // (down, or run back out of the yard: D-086, a raider who fled was still "in the yard" and his torch kept the clock running)
      if (m && (e.state === "down" || e.state === "left")) return s.inYard.includes(e.id) ? stay(fin({ ...s, inYard: s.inYard.filter((id) => id !== e.id) })) : stay(s);
      if (e.id === "captain" && e.state === "down" && !s.captainGone) return stay(fin({ ...s, captainGone: true, parley: s.parley === "raid_captain" ? undefined : s.parley }));
      return stay(s);
    }
    case "talk": return e.kind === "raid_captain" ? talk(s, e.result, e.paid) : stay(s);
    case "tally": return stay({ ...s, tally: addTally(s.tally, e.add) });
    case "party_down": return resolveWith(s, "abandoned", {});
    case "leave": {
      const r = leave(s);
      return r === undefined ? stay(s) : resolveWith(s, r, {});
    }
    default: return stay(s);
  }
}

function paidOk(s: RaidState, paid: number): boolean {
  return Number.isFinite(paid) && paid >= Math.round(s.price * 0.75) && paid <= Math.round(s.price * 1.25) && affordable(s, paid);
}

function talk(s: RaidState, result: string, paid: number): Reduction<RaidState> {
  if (result === "open") {
    if (s.parley || !s.landed || s.captainGone) return stay(s);
    if (s.attacking) return { s, fx: [say("The captain is past consulting. He is pointing at your stores with a torch.")] };
    return { s: fin({ ...s, parley: "raid_captain" }), fx: [{ k: "parley", kind: "raid_captain", price: s.price }] };
  }
  if (s.parley !== "raid_captain") return stay(s);
  switch (result) {
    case "close": return stay(fin({ ...s, parley: undefined }));
    case "learn": return stay(fin(s));
    case "hostile": return assault({ ...s, parley: undefined }, "\"Very well,\" says the captain. \"Gentlemen: the yard.\"");
    case "paid": {
      if (!paidOk(s, paid)) return stay(fin({ ...s, parley: undefined }));
      const n = fin({ ...s, parley: undefined, spent: s.spent + paid, paid: s.paid + paid });
      return resolveWith(n, "protection_paid", {}, [{ k: "order", group: "late:raiders", order: { o: "stand_down" } }, { k: "order", group: "late:captain", order: { o: "stand_down" } },
        say(`£${paid} changes hands at the edge of the yard. The captain writes a receipt, with the renewal date already filled in, and his men go back up the bank to their launch, unlit and slightly disappointed.`)]);
    }
    default: return stay(s);
  }
}

// ---- leaving --------------------------------------------------------------------------------------------------------------------------------

function leave(s: RaidState): ReturnType<TemplateDef<RaidState>["leave"]> {
  if (s.phase === "resolved") return s.resolution;
  // sailing before the raiders land leaves the post to the raid exactly as it would have been without the party there; so does sailing during it
  const nothing = !s.landed && tallyEmpty(s.tally) && s.paid === 0;
  return nothing ? undefined : "post_burned";
}

// ---- the view ---------------------------------------------------------------------------------------------------------------------------------

const HINT: Record<string, string> = {
  planning: "The Syndicate means to raid the Society's post on the south bank, and the party is here first. Get to the post and pick your ground: the raiders will come down the bank from upstream.",
  tension: "The raiders are coming down the bank toward the post. Their captain will stop at the edge of it and offer a \"security consultation\".",
  standoff: "The captain has made his offer. Pay him, or refuse: walk away and he waits out his watch; tell him to come and try and they come at once; or open fire. When his watch runs out, the raiders come in with torches.",
  parley: "The captain is consulting. His men are holding their torches up so you can see them.",
  fighting: "The raiders are going for the yard. Two of them in it together, long enough, and the stores go up. Drop them before that, or send them running.",
};
const DONE: Record<string, string> = {
  post_held: "The raid broke in the post's yard. The stores stand, and the watch has a story it will tell until it dies of old age. Take the boat home.",
  post_burned: "The stores are ash and the raiders have the post's flag. The post itself stands, weaker and well lit. Take the boat home from the landing.",
  protection_paid: "The raiders were paid to leave. The post stands; the Syndicate has a client, and the Society has a standing order. Take the boat home.",
  abandoned: "The expedition is down, and the raiders have the yard. Take the boat home and explain.",
};
const COMPLICATION_LINE: Partial<Record<ComplicationId, string>> = {
  reinforcements: "The raiding party is bigger than the agent's last letter said.",
  fog: "Fog on the river: the raiders' launch is feeling its way, and will be late.",
  rain: "Rain: the torches will be slow to take.",
};

function view(s: RaidState, now: number): ScenarioView {
  const res = s.resolution;
  const won = res === "post_held" || res === "protection_paid";
  const objectives: ObjectiveView[] = [
    { id: "post", text: "Get to the Society's post before the raiders do", done: s.near.post > 0 || s.landed },
    { id: "defend", text: res === "post_burned" ? "Lost: the stores were burned" : res === "abandoned" ? "Lost: the expedition went down" : "Keep the raiders' torches out of the post's yard", done: won },
  ];
  if (res === undefined && s.landed && !s.attacking && !s.captainGone) objectives.push({ id: "captain", text: `Pay the captain £${s.price} for "protection", or refuse and fight`, done: false, optional: true });
  if (res === undefined && s.attacking) objectives.push({ id: "break", text: `Drop ${needed(s)} of the ${s.crew.total} raiders, or send them running (${Math.min(brokenCount(s), needed(s))} so far)`, done: isBroken(s), optional: true });
  if (res === undefined && s.attacking && s.inYard.length > 0) objectives.push({ id: "yard", text: `Drop the raiders in the yard (${s.inYard.length} inside): two together set the stores alight`, done: false, optional: true });
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Take the boat home from the landing", done: false });
  let hint = res !== undefined ? DONE[res] ?? "" : HINT[s.phase] ?? "";
  const cl = COMPLICATION_LINE[s.complication] ?? COMPLICATION_HINT[s.complication];
  if (res === undefined && cl) hint += ` ${cl}`;
  if (res === undefined && (s.watch ?? 0) > 0) {
    hint += s.watchOut ? ` The post's watch (${s.watch} rifles) stands inside the gate: it answers fire, it does not start it.` : ` The post keeps a watch (${s.watch} rifles); it will stand with you once you are there.`;
  }
  const clock: [string, number] = !s.landed ? ["The raiders land", s.raidAt - s.t] : s.demandUntil > 0 && !s.attacking ? ["The captain's watch", s.demandUntil - s.t]
    : s.torchSince > 0 ? ["The stores catch", s.torchSince + torchS(s) - s.t] : ["", 0];
  const v: ScenarioView = { phase: s.phase, objectives, hint, ...timer(clock[0], res !== undefined ? 0 : clock[1], now), template: "outpost_raid", title: "The Raid on the Post", ...ruleWhile("outpost_raid", res === undefined) };
  if (res !== undefined) v.resolution = res;
  if (s.complication !== "none") v.complication = s.complication;
  return v;
}

function outcome(s: RaidState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "outpost_raid", resolution: s.resolution, toll: 0, paid: s.paid, bridge: "intact", tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
    complication: s.complication, region: "kessar",
  };
}

// ---- the people -------------------------------------------------------------------------------------------------------------------------------

const RAIDERS = ["Raider Gilbert Tamsin", "Raider Odile Fenchurch", "Raider Barnabas Quell", "Raider Hetty Sallow", "Raider Ned Ashgrove", "Raider Philippa Crane (sent for)", "Raider Mungo Teale (sent for)"] as const;
// (torch-bearers: a torch in one hand leaves a blade in the other. The bot playtest's lone rifle went down to two pistol and rifle shots 7 s into the assault with
// two rifles in the base five; the defence is meant to be shooting them on the open ground before the yard, so only the reinforcements bring a long gun)
const ARMS: readonly WeaponId[] = [WEAPON.PISTOL, WEAPON.SABRE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.SABRE, WEAPON.RIFLE, WEAPON.SABRE];
const WATCH = ["Watchman Abel Crouch (Society pensioner)", "Watchwoman Dorcas Pim (Society pensioner)", "Watchman Elias Mote (Society pensioner)"] as const;
/** Where the watch stands: inside the gate, either side of it, looking down the gap at the north approach and across the yard behind them. */
export const WATCH_POSTS = [{ x: SITE.x - 3, z: SITE.z - 13 }, { x: SITE.x + 3, z: SITE.z - 13 }, { x: SITE.x, z: SITE.z - 9 }] as const;

/** The raiding party (five, seven with reinforcements) and its captain, held back until the launch lands; and, at a stockaded post, its watch, held back until the party gets there. */
function roster(_c: CampaignState, seed: number, s: RaidState): NpcSpec[] {
  const L = RAID_SITES.landing;
  const out: NpcSpec[] = [];
  for (let i = 0; i < s.crew.total; i++) {
    const a = (i / s.crew.total) * Math.PI * 2;
    out.push({
      id: `raider-${i}`, role: NPC.RAIDER,   // (their own role so the client can give them torches; a Syndicate soldier in every other respect)
       faction: "rival", side: "rival", group: "late:raiders", post: { x: L.x + Math.cos(a) * 2.2, z: L.z + Math.sin(a) * 2.2 }, weapon: ARMS[i]!,
      lookSeed: hash3(seed >>> 0, i, 0x2a1d), name: RAIDERS[i]!, skill: 38 + (hash3(seed >>> 0, i, 0x2a2) % 16), bravery: 40 + (hash3(seed >>> 0, i, 0x2a3) % 25), brain: "garrison",
    });
  }
  // the post's watch: the Society's riflemen, held back until the party reaches the post (a garrison brain holds its post; the party side answers fire and never starts it)
  const rifle = FOLLOWER_DEFS.rifleman;
  for (let i = 0; i < Math.min(s.watch ?? 0, WATCH.length); i++) {
    out.push({
      id: `watch-${i}`, role: rifle.role, faction: "ward", side: "party", group: "late:watch", post: { ...WATCH_POSTS[i]! }, weapon: rifle.weapon, look: { ...rifle.look },
      lookSeed: hash3(seed >>> 0, i, 0x3a1d), name: WATCH[i]!, skill: rifle.skill, bravery: rifle.bravery, brain: "garrison",
    });
  }
  // (a garrison brain, like the convoy's driver: the Cast's civil brain stands still, and the captain has to walk to the muster with his men; he is no braver than a consultant)
  out.push({
    id: "captain", role: NPC.RIVAL_SURVEYOR, faction: "rival", side: "rival", group: "late:captain", post: { x: L.x - 1.5, z: L.z - 2.5 }, weapon: WEAPON.PISTOL,
    lookSeed: hash3(seed >>> 0, 9, 0x2a1d), name: "Captain Ignatius Pell-Dunmarrow, Security Consultant", skill: 40, bravery: 30, brain: "garrison",
  });
  return out;
}

const observe: ObserveSpec = {
  near: [{ id: "post", x: SITE.x, z: SITE.z, r: RAID.postR }],
  use: [{ id: "captain", npc: "captain", r: RAID.personR, talk: "raid_captain", carry: "none" }],
  count: [{ group: "late:raiders" }],
  seen: [],
  actors: [
    ...Array.from({ length: RAID.raiders + RAID.extraRaiders }, (_, i) => ({ id: `raider-${i}`, goal: { x: SITE.x, z: SITE.z, r: RAID.yardR }, leaves: true })),
    { id: "captain" },
  ],
  hostileGroups: ["late:raiders", "late:captain"],
};

export const outpostRaidTemplate: TemplateDef<RaidState> = {
  id: "outpost_raid", title: "The Raid on the Post",
  brief: "The Syndicate means to raid the Society's post on Kessar's south bank, and for once the party is there when it lands. Its captain will stop at the gate and offer a season's \"protection\" at a reasonable price; the Society's insurers have already declined the post as a fire risk. Hold the yard, or pay him.",
  init, reduce, view, outcome, roster, leave, observe,
  routes: { assault: RAID_SITES.assault },
  sites: { yard: SITE, muster: RAID_SITES.muster },
};
