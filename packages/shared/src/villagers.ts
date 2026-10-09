import type { CollisionWorld } from "./collision.ts";
import { phaseOfHour, wrapHours, WORLD_CLOCK } from "./daycycle.ts";
import { clamp, smoothstep, wrapAngle } from "./math.ts";
import { hash3, hashFloat, Rng } from "./rng.ts";
import { pickLine, type LineKind } from "./villagerLines.ts";
import { buildNav, routePoint, segmentOk, standingHeight, type Nav, type Route } from "./villagerNav.ts";
import { weatherAt, createWeather } from "./weather.ts";

/**
 * HOLLOWMERE'S FOLK: the village's people, as scenery with a routine. A roster is generated from the world seed (names, trades, households, who
 * lives where), each person has a daily schedule of places and things to do, and `villagerAt` answers "where is this person, which way do they
 * face, what are they doing" as a PURE function of the world clock (`FolkClock`: the hour of day, the world's age and the weather that follows
 * from the seed). No server simulation and no messages: every client computes the same people in the same places at the same moment. They are
 * not obstacles, cannot be hit and are never sent over the network (docs/_notes/environment.md, "Villagers").
 *
 * A day is a ring of STINTS: arrive at a station at a fixed hour, do something there (a loop between two stations counts: sacks from the pile to
 * the cart), and set off in time to arrive at the next one on time. Walking follows the village's footpaths (villagerNav.ts) at a plain pace.
 * Rain moves people who work in the open under a roof: whether a stint is "rained off" is decided from the weather at its arrival, so a
 * position is always continuous in time. Nothing allocates once the roster is built.
 */

export type Occupation = "keeper" | "miller" | "smith" | "baker" | "ferryman" | "clockkeeper" | "seller" | "child" | "elder" | "laundress" | "fisher" | "gardener" | "beekeeper" | "guard" | "watch" | "lamplighter" | "registrar";
export type Age = "child" | "adult" | "elder";

/** What a person is doing right now (the client turns each into a pose). */
export type Activity =
  | "sleep"
  | "walk"
  | "idle"
  | "sweep"
  | "hammer"
  | "scrub"
  | "hang"
  | "tend"
  | "fish"
  | "sit"
  | "read"
  | "sell"
  | "chat"
  | "lean"
  | "ring"
  | "lookup"
  | "draw"
  | "lamp"
  | "shelter"
  | "play"
  | "sack"
  | "hive"
  | "write";

/** What is carried (held in front of the body, or in the hand). */
export type Carry = "none" | "sack" | "basket" | "bucket" | "crate" | "lantern" | "book" | "bottle" | "loaves" | "fish" | "washing" | "chair";

const WALK = 1.25;
/** Longest stretch a stint may last before it is cut in two (each half decides on its own whether it is rained off); a stint that loops between two places gets more room. */
const MAX_STINT = 0.8;
const MAX_LOOP = 1.7;
/** Hours spent at each end of a loop (putting the sack down, hanging the sheet). */
const LOOP_DWELL = 0.2;
const PHASE_DAY = phaseOfHour(5.2 - 1e-9);

export interface Villager {
  id: number;
  name: string;
  /** The trade, as the village says it ("Keeper of the Hours"). */
  title: string;
  occupation: Occupation;
  age: Age;
  /** Building id of the house they sleep in. */
  home: string;
  /** Seed for `generateCharacter`, the archetype to draw from, and the body scale (children are small). */
  lookSeed: number;
  archetype: number;
  scale: number;
  /** Pace factor (children hurry, elders amble) and which side of the road they favour, 0.25..1. */
  walk: number;
  lane: number;
  /** Which kind of lines they speak. */
  lines: LineKind;
  stints: Stint[];
}

export interface Stint {
  /** The hour of day they arrive at their station. */
  at: number;
  /** Station index (in `Folk.nav.stations`). */
  st: number;
  act: Activity;
  carry: Carry;
  /** What they carry while walking TO this stint. */
  carryIn: Carry;
  /** A loop: after a beat here they walk to `to`, do `actTo`, and come back; `carryOut` is what they carry on the way there. -1 = no loop. */
  to: number;
  actTo: Activity;
  carryOut: Carry;
  /** Who they are talking with (villager id) or -1. */
  partner: number;
  /** Where they wait out rain instead of this station, or -1 (under a roof already, or indoors already). */
  shelter: number;
  /** Which of the spots round the station (`Folk.spots`) is theirs here, at their shelter and at the far end of their loop: nobody shares one at once. */
  slot: number;
  shelterSlot: number;
  toSlot: number;
}

export interface Folk {
  readonly nav: Nav;
  readonly roster: readonly Villager[];
  readonly seed: number;
  /**
   * Per station, the places people take when more than one is there at once, as (dx, dz, y, sit) from the station's point, in the order that
   * station's people prefer them: the station itself first, then (for a bench seat) the bench's other seat, then places to stand beside it and
   * behind it (or in front of a bench), each one standable. A stint's `slot` picks one; `sit` is 1 for a seat.
   */
  readonly spots: readonly Float64Array[];
}

export interface FolkClock {
  /** Hour of day, 0..24. */
  hours: number;
  /** The world's age, ms. */
  worldMs: number;
  seed: number;
  dayMinutes: number;
  /** Real seconds one daylight game hour lasts (the dark hours pass three times faster). */
  hourSec: number;
  /** Rain forced for review (`?weather=`), 0..1; undefined = follow the weather schedule. */
  rain: number | undefined;
}

export const createFolkClock = (): FolkClock => ({ hours: 12, worldMs: 0, seed: 7, dayMinutes: WORLD_CLOCK.defaultDayMinutes, hourSec: (WORLD_CLOCK.defaultDayMinutes * 60) / PHASE_DAY, rain: undefined });

/** Fills a clock. `hours` is whatever hour the sky shows (a pinned `?time=` too); `dayMinutes <= 0` freezes the day. */
export function setFolkClock(c: FolkClock, seed: number, worldMs: number, hours: number, dayMinutes: number, rain?: number): FolkClock {
  c.seed = seed;
  c.worldMs = worldMs;
  c.hours = wrapHours(hours);
  c.dayMinutes = dayMinutes > 0 ? dayMinutes : WORLD_CLOCK.defaultDayMinutes;
  c.hourSec = (c.dayMinutes * 60) / PHASE_DAY;
  c.rain = rain;
  return c;
}

const isDark = (h: number): boolean => h < 5.2 || h > 20.6;
/** Real seconds one game hour lasts at clock hour `h`. */
export const hourSecAt = (c: FolkClock, h: number): number => (isDark(wrapHours(h)) ? c.hourSec / 3 : c.hourSec);

/** Real ms from clock hour `from` forward to clock hour `to` (wrapping a day). */
function msBetween(c: FolkClock, from: number, to: number): number {
  const d = (((phaseOfHour(to) - phaseOfHour(from)) % PHASE_DAY) + PHASE_DAY) % PHASE_DAY;
  return d * (c.dayMinutes * 60 * 1000 / PHASE_DAY);
}

// ---- the cast -------------------------------------------------------------------------------------------------------------------------------

type Opt = { carry?: Carry; carryIn?: Carry; to?: string; actTo?: Activity; carryOut?: Carry; with?: string };
/** [arrival hour, station key(s) with fallbacks after "|", what they do, options] */
type Appt = [at: number, keys: string, act: Activity, opt?: Opt];

interface CastDef {
  key: string;
  title: string;
  occupation: Occupation;
  age: Age;
  home: string;
  lines: LineKind;
  scale?: number;
  walk?: number;
  archetype?: number;
  script: Appt[];
}

const BENCHES = ["bench:0:1", "bench:0:2", "bench:1:1", "bench:1:2"] as const;

/**
 * The whole cast in priority order (the low preset takes the first few). Hours are clock hours; the first entry of each script is the morning at
 * the house door, the last is bed. Nobody's walk crosses dusk (20.6) or dawn (5.2), where the clock changes speed.
 */
const CAST: readonly CastDef[] = [
  { key: "guard", title: "Warden of the Gate", occupation: "guard", age: "adult", home: "cot-c", lines: "guard", archetype: 2, script: [
    [6.5, "step:cot-c", "idle"], [6.9, "gate-out|gate-look", "lean"], [12.3, "bench:1:1|plaza", "sit"], [13.3, "gate-out|gate-look", "lean"], [17.6, "gate-in|gate-out", "idle"], [19.2, "step:cot-c", "idle"], [19.7, "in:cot-c", "sleep"],
  ] },
  { key: "miller", title: "Miller", occupation: "miller", age: "adult", home: "mill", lines: "miller", archetype: 0, script: [
    [6.2, "step:mill", "sweep"], [6.9, "mill-sacks", "sack", { to: "mill-cart", actTo: "idle", carryOut: "sack" }], [12.3, "step:mill", "lean"], [13.3, "mill-sacks", "sack", { to: "mill-cart", actTo: "idle", carryOut: "sack" }], [17.6, "step:mill", "lean"], [19.4, "step:mill", "idle"], [19.9, "in:mill", "sleep"],
  ] },
  { key: "smith", title: "Smith & Farrier", occupation: "smith", age: "adult", home: "cot-b", lines: "smith", archetype: 2, script: [
    [6.7, "step:cot-b", "idle"], [7.4, "anvil", "hammer"], [12.2, "trough", "scrub"], [12.8, "smithy-front|plaza", "lean"], [13.6, "anvil", "hammer"], [17.9, "smithy-front|plaza", "lean"], [19.9, "step:cot-b", "idle"], [20.3, "in:cot-b", "sleep"],
  ] },
  { key: "keeper", title: "Keeper of the Hours", occupation: "keeper", age: "adult", home: "hall", lines: "keeper", archetype: 1, script: [
    [5.9, "step:hall", "ring"], [6.6, "well", "draw", { to: "step:hall", actTo: "sweep", carryOut: "bucket" }], [8.4, "step:hall", "sweep"], [9.3, "bench:0:1|plaza", "read", { carry: "book" }], [11.6, "step:hall", "ring"], [12.3, "bench:1:2|plaza", "sit"], [14.0, "plaza", "idle"], [17.6, "step:hall", "ring"], [20.4, "step:hall", "idle"], [21.1, "in:hall", "sleep"],
  ] },
  { key: "ferryman", title: "Ferryman", occupation: "ferryman", age: "adult", home: "stilt-w", lines: "ferryman", archetype: 4, script: [
    [6.5, "step:stilt-w", "idle"], [7.2, "jetty-mid", "lean"], [9.8, "jetty-end", "fish"], [13.4, "jetty-mid", "lean"], [18.4, "jetty-end|jetty-mid", "fish"], [20.3, "step:stilt-w", "idle"], [20.8, "in:stilt-w", "sleep"],
  ] },
  { key: "pears", title: "Pear Merchant", occupation: "seller", age: "adult", home: "stilt-e", lines: "seller", archetype: 3, script: [
    [6.9, "step:stilt-e", "idle", { carryIn: "basket" }], [7.5, "stall:2", "sell", { carryIn: "basket" }], [18.0, "step:stilt-e", "idle"], [20.3, "in:stilt-e", "sleep"],
  ] },
  { key: "baker", title: "Baker", occupation: "baker", age: "adult", home: "cot-b", lines: "baker", archetype: 0, script: [
    [5.7, "step:cot-b", "sweep"], [6.4, "stall:3", "sell", { carryIn: "loaves" }], [17.5, "smithy-front|plaza", "idle"], [19.9, "step:cot-b", "idle"], [20.3, "in:cot-b", "sleep"],
  ] },
  { key: "elder", title: "Retired Everything", occupation: "elder", age: "elder", home: "hall", lines: "elder", archetype: 5, walk: 0.7, script: [
    [7.6, "step:hall", "idle"], [8.2, "bench:0:2|plaza", "read", { carry: "book" }], [11.6, "porch:hall:b|step:hall", "sit"], [15.0, "bench:0:2|plaza", "sit"], [17.0, "porch:hall:b|step:hall", "sit"], [20.4, "step:hall", "idle"], [21.0, "in:hall", "sleep"],
  ] },
  { key: "clock", title: "Clockkeeper", occupation: "clockkeeper", age: "adult", home: "cot-b", lines: "clockkeeper", archetype: 1, script: [
    [6.4, "step:cot-b", "idle"], [7.0, "gate-look", "lookup"], [9.6, "arch:b|arch:a", "lean"], [10.5, "gate-look", "lookup"], [12.3, "bench:0:1|plaza", "sit"], [13.4, "gate-look", "lookup"], [15.6, "arch:c|arch:a", "lean"], [17.4, "gate-look", "lookup"], [19.4, "step:cot-b", "idle"], [19.9, "in:cot-b", "sleep"],
  ] },
  { key: "registrar", title: "Registrar of Non-Events", occupation: "registrar", age: "adult", home: "stilt-e", lines: "registrar", archetype: 5, script: [
    [7.3, "step:stilt-e", "idle"], [8.2, "bench:0:1|plaza", "write", { carry: "book" }], [10.2, "gate-look|plaza", "lookup"], [11.0, "plaza", "write", { carry: "book" }], [14.0, "smithy-front|plaza", "write", { carry: "book" }], [16.5, "bench:1:1|plaza", "write", { carry: "book" }], [20.4, "step:stilt-e", "idle"], [20.9, "in:stilt-e", "sleep"],
  ] },
  { key: "tea", title: "Tea Merchant", occupation: "seller", age: "elder", home: "stilt-e", lines: "seller", archetype: 3, walk: 0.75, script: [
    [7.6, "step:stilt-e", "idle"], [8.0, "stall:4", "sell", { carryIn: "bottle" }], [14.6, "bench:0:1|plaza", "sit"], [15.6, "stall:4", "sell"], [18.6, "step:stilt-e", "idle"], [19.8, "in:stilt-e", "sleep"],
  ] },
  { key: "fisher", title: "Fisher", occupation: "fisher", age: "adult", home: "cot-a", lines: "fisher", archetype: 4, script: [
    [6.0, "step:cot-a", "idle"], [6.6, "weir|jetty-end", "fish"], [11.0, "front:1|plaza", "idle", { carryIn: "fish" }], [12.3, "bench:0:2|plaza", "sit"], [13.6, "weir|jetty-end", "fish"], [18.3, "step:cot-a", "idle"], [19.6, "in:cot-a", "sleep"],
  ] },
  { key: "fishseller", title: "Fishmonger", occupation: "seller", age: "adult", home: "cot-a", lines: "seller", archetype: 0, script: [
    [7.1, "step:cot-a", "sweep"], [7.9, "stall:1", "sell", { carryIn: "basket" }], [17.6, "step:cot-a", "idle"], [19.8, "in:cot-a", "sleep"],
  ] },
  { key: "gardener", title: "Gardener", occupation: "gardener", age: "adult", home: "cot-c", lines: "gardener", archetype: 4, script: [
    [6.2, "step:cot-c", "idle"], [6.8, "garden:1|garden:0", "tend"], [10.5, "garden:1:b|garden:0:b", "tend"], [12.2, "cart|plaza", "lean"], [13.3, "garden:1|garden:0", "tend"], [17.2, "well", "draw", { to: "plaza", actTo: "idle", carryOut: "bucket" }], [19.0, "step:cot-c", "idle"], [19.4, "in:cot-c", "sleep"],
  ] },
  { key: "beekeeper", title: "Beekeeper", occupation: "beekeeper", age: "adult", home: "cot-c", lines: "beekeeper", archetype: 1, script: [
    [7.3, "step:cot-c", "idle"], [7.9, "hive:2|hive:0", "hive"], [9.8, "hive:1|hive:2", "hive"], [12.2, "step:cot-c", "idle"], [13.6, "hive:0|hive:2", "hive"], [16.3, "hive:2", "hive"], [18.4, "step:cot-c", "idle"], [19.2, "in:cot-c", "sleep"],
  ] },
  { key: "laundress", title: "Laundress", occupation: "laundress", age: "adult", home: "stilt-w", lines: "laundress", archetype: 3, script: [
    [6.4, "step:stilt-w", "sweep"], [7.2, "trough", "scrub", { to: "wash:2|wash:1|wash:0", actTo: "hang", carryOut: "washing" }], [12.0, "step:stilt-w", "idle"], [13.2, "trough", "scrub", { to: "wash:2|wash:1|wash:0", actTo: "hang", carryOut: "washing" }], [17.2, "step:stilt-w", "idle"], [20.5, "in:stilt-w", "sleep"],
  ] },
  { key: "lamp", title: "Lamplighter", occupation: "lamplighter", age: "adult", home: "stilt-e", lines: "lamplighter", archetype: 1, script: [
    [7.3, "step:stilt-e", "idle"], [8.2, "plaza", "idle"], [12.3, "bench:0:2|plaza", "sit"], [14.4, "well", "draw"], [17.3, "step:stilt-e", "idle"], [21.2, "ferry-foot|plaza", "idle", { carry: "lantern" }], [21.8, "in:stilt-e", "sleep"],
  ] },
  { key: "oldgent", title: "Gentleman of Leisure", occupation: "elder", age: "elder", home: "mill", lines: "elder", archetype: 3, walk: 0.7, script: [
    [8.0, "step:mill", "idle"], [8.6, "bench:1:1|plaza", "read", { carry: "book" }], [10.9, "step:mill", "lean"], [14.0, "bench:1:1|plaza", "sit"], [16.4, "plaza", "idle"], [19.0, "step:mill", "idle"], [19.6, "in:mill", "sleep"],
  ] },
  { key: "watch", title: "Night Watch", occupation: "watch", age: "adult", home: "cot-c", lines: "watch", archetype: 2, script: [
    [4.8, "gate-out|gate-look", "idle", { carry: "lantern", carryIn: "lantern" }], [6.4, "step:cot-c", "idle"], [6.9, "in:cot-c", "sleep"], [17.4, "step:cot-c", "idle"], [18.3, "gate-in|gate-out", "idle", { carry: "lantern", carryIn: "lantern" }], [21.4, "plaza", "idle", { carry: "lantern", carryIn: "lantern" }], [23.6, "well", "lean", { carry: "lantern", carryIn: "lantern" }], [1.6, "gate-in|gate-out", "idle", { carry: "lantern", carryIn: "lantern" }], [3.4, "plaza", "idle", { carry: "lantern", carryIn: "lantern" }],
  ] },
  { key: "pip", title: "Pip", occupation: "child", age: "child", home: "cot-a", lines: "child", scale: 0.66, walk: 1.5, archetype: 4, script: [
    [7.6, "step:cot-a", "play"], [8.3, "ferry-foot", "play", { to: "jetty-mid", actTo: "play", carryOut: "none" }], [12.4, "step:cot-a", "sit"], [13.4, "plaza", "play", { to: "well", actTo: "play" }], [17.4, "step:cot-a", "play"], [19.4, "in:cot-a", "sleep"],
  ] },
  { key: "tansy", title: "Tansy", occupation: "child", age: "child", home: "cot-b", lines: "child", scale: 0.7, walk: 1.5, archetype: 3, script: [
    [7.9, "step:cot-b", "play"], [8.6, "plaza", "play", { to: "well", actTo: "play" }], [12.5, "step:cot-b", "sit"], [13.5, "cart|plaza", "play", { to: "plaza", actTo: "play" }], [17.6, "step:cot-b", "play"], [19.6, "in:cot-b", "sleep"],
  ] },
  { key: "apprentice", title: "Miller's Apprentice", occupation: "child", age: "child", home: "mill", lines: "child", scale: 0.74, walk: 1.4, archetype: 2, script: [
    [7.4, "step:mill", "play"], [8.0, "mill-sacks", "sack", { to: "mill-cart", actTo: "idle", carryOut: "sack" }], [12.5, "step:mill", "sit"], [13.5, "mill-sacks", "sack", { to: "mill-cart", actTo: "idle", carryOut: "sack" }], [17.5, "step:mill", "play"], [19.6, "in:mill", "sleep"],
  ] },
];

/** Talking events: two people meet at a conversation spot for a while, then go back to whatever they were doing. */
const MEETINGS: readonly { at: number; dur: number; spot: number; a: string; b: string }[] = [
  { at: 17.9, dur: 1.0, spot: 0, a: "keeper", b: "clock" },
  { at: 12.5, dur: 0.9, spot: 3, a: "miller", b: "oldgent" },
  { at: 18.6, dur: 1.0, spot: 2, a: "smith", b: "baker" },
  { at: 17.6, dur: 1.2, spot: 4, a: "ferryman", b: "laundress" },
  { at: 18.3, dur: 1.0, spot: 1, a: "pears", b: "tea" },
  { at: 17.7, dur: 0.9, spot: 5, a: "gardener", b: "beekeeper" },
  { at: 15.0, dur: 0.8, spot: 1, a: "registrar", b: "guard" },
];

const FIRST = ["Pellam", "Odo", "Tansy", "Wimsy", "Hobb", "Marrow", "Pip", "Nettle", "Quill", "Bramwell", "Jessamy", "Tobrin", "Lorimel", "Fenna", "Dilly", "Ambrin", "Corvel", "Sorrel", "Tibbet", "Yarrow", "Mabbit", "Perrin", "Ludo", "Osprey", "Cuthwin", "Hesper", "Dunstan", "Kestrel", "Thimble", "Alder", "Marisk", "Sedge", "Zennoby", "Iskaly", "Brumel", "Osmerick", "Tulliver", "Wrenna", "Gaskin", "Ottley"];
const LAST = ["Puddlecote", "Thistlewick", "Mumblecrust", "Applewarden", "Brindlemarsh", "Crumbledown", "Nettlebed", "Dunnock", "Ladleworth", "Fennimore", "Quillon", "Tumblewick", "Oddsworth", "Pennywhistle", "Bellwether", "Crookshanks", "Marrowfat", "Sundry", "Lanternby", "Hollowell", "Ninepins", "Dabbledown", "Cobblestay", "Plumtree", "Tuppence", "Wetherwick", "Gimblet", "Dovetail", "Snodgrass", "Muddlecombe"];

// ---- building the folk -------------------------------------------------------------------------------------------------------------------------

const cache = new WeakMap<CollisionWorld, Map<number, Folk>>();

/** The village's people for a world and its seed: deterministic in both, built once and cached. */
export function buildFolk(world: CollisionWorld, seed: number): Folk {
  let bySeed = cache.get(world);
  if (!bySeed) cache.set(world, (bySeed = new Map()));
  const hit = bySeed.get(seed);
  if (hit) return hit;
  const nav = buildNav(world);
  const rng = new Rng((seed ^ 0x40110d) >>> 0);
  const firsts = shuffled(FIRST, rng);
  const lasts = shuffled(LAST, rng);
  const keyToId = new Map(CAST.map((c, i) => [c.key, i]));
  const okStation = (keys: string): number => {
    for (const k of keys.split("|")) {
      const i = nav.index.get(k);
      if (i !== undefined && nav.stations[i]!.ok) return i;
    }
    return -1;
  };
  // hours a person leaves the house door, per person and stable: a little spread so nobody moves in lockstep
  const roster: Villager[] = CAST.map((c, i) => {
    const jit = (hashFloat(seed, i, 0x51) - 0.5) * 0.3;
    const first = firsts[i % firsts.length]!;
    const name = c.age === "child" ? `${c.title} ${lasts[(i * 7 + 3) % lasts.length]!}` : `${first} ${lasts[i % lasts.length]!}`;
    const base: Villager = {
      id: i,
      name,
      title: c.title,
      occupation: c.occupation,
      age: c.age,
      home: c.home,
      lookSeed: hash3(seed, i, 0x100) >>> 0,
      archetype: c.archetype ?? Math.floor(hashFloat(seed, i, 0x77) * 6),
      scale: c.scale ?? 1,
      walk: c.walk ?? 1,
      lane: 0.3 + hashFloat(seed, i, 0x33) * 0.7,
      lines: c.lines,
      stints: [],
    };
    // meetings first, so they can override the script
    let script = c.script.map((a) => [...a] as unknown as Appt);
    for (const m of MEETINGS) {
      const side = m.a === c.key ? "a" : m.b === c.key ? "b" : undefined;
      if (!side) continue;
      script = withEvent(script, m.at, m.dur, [m.at, `chat:${m.spot}:${side}`, "chat", { with: side === "a" ? m.b : m.a }]);
    }
    if (c.key === "lamp") script = lampScript(script);
    const stints: Stint[] = [];
    for (const [at0, keys, act, opt] of script) {
      const st = okStation(keys);
      if (st < 0) continue;
      const isMeet = act === "chat";
      const at = isMeet ? at0 : at0 < 4.5 ? at0 : clamp(at0 + jit, 4.7, 23.9);
      const to = opt?.to ? okStation(opt.to) : -1;
      const partner = opt?.with ? (keyToId.get(opt.with) ?? -1) : -1;
      stints.push({ at, st, act, carry: opt?.carry ?? "none", carryIn: opt?.carryIn ?? opt?.carry ?? "none", to, actTo: opt?.actTo ?? act, carryOut: opt?.carryOut ?? "none", partner, shelter: -1, slot: 0, shelterSlot: 0, toSlot: 0 });
    }
    stints.sort((a, b) => a.at - b.at);
    base.stints = stints;
    return base;
  });

  // rain shelters: children, elders and people who work in the open go indoors; the rest of the adults stand under the nearest roofs
  const roofs = ["arch:a", "arch:b", "arch:c", "smithy:a", "smithy:b", "porch:hall:a", "porch:hall:b", "stall:1", "stall:2", "stall:3", "stall:4"].map((k) => nav.index.get(k) ?? -1).filter((i) => i >= 0 && nav.stations[i]!.ok);
  for (const v of roster) {
    const indoors = v.age !== "adult" || v.occupation === "fisher" || v.occupation === "gardener" || v.occupation === "beekeeper" || v.occupation === "laundress" || v.occupation === "ferryman" || v.occupation === "lamplighter";
    const homeIn = nav.index.get(`in:${v.home}`) ?? -1;
    for (const s of v.stints) {
      const at = nav.stations[s.st]!;
      if (at.sheltered || at.hidden) continue;
      if (indoors) {
        if (homeIn >= 0 && nav.stations[homeIn]!.ok) s.shelter = homeIn;
      } else {
        let best: { i: number; d: number }[] = [];
        for (const r of roofs) {
          const d = nav.distance(s.st, r);
          if (d < Infinity) best.push({ i: r, d });
        }
        best = best.sort((a, b) => a.d - b.d).slice(0, 3);
        if (best.length > 0) s.shelter = best[(v.id + s.st) % best.length]!.i;
      }
    }
  }
  // split long stints so every part decides for itself whether the weather has driven it under cover; drop stints whose routes do not exist
  for (const v of roster) {
    const out: Stint[] = [];
    for (let k = 0; k < v.stints.length; k++) {
      const s = v.stints[k]!;
      const next = v.stints[(k + 1) % v.stints.length]!;
      const end = next.at <= s.at ? next.at + 24 : next.at;
      const hidden = nav.stations[s.st]!.hidden;
      const limit = s.to >= 0 ? MAX_LOOP : MAX_STINT;
      if (hidden || end - s.at <= limit) {
        out.push(s);
        continue;
      }
      const parts = Math.ceil((end - s.at) / limit);
      for (let p = 0; p < parts; p++) out.push({ ...s, at: wrapHours(s.at + ((end - s.at) * p) / parts), carryIn: p === 0 ? s.carryIn : s.carry });
    }
    out.sort((a, b) => a.at - b.at);
    v.stints = pruneUnroutable(nav, out);
  }
  const { spotsOf, idsOf, groupOf } = stationSpots(nav);
  assignSpots(roster, idsOf, groupOf);
  const folk: Folk = { nav, roster, seed, spots: spotsOf };
  bySeed.set(seed, folk);
  return folk;
}

/** Where people stand round a station when more than one is there at once (metres across its facing, then behind it): the station itself first. */
const SPOT_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0], [0.7, 0], [-0.7, 0], [1.4, 0], [-1.4, 0], [0.35, 0.7], [-0.35, 0.7], [1.05, 0.7], [-1.05, 0.7], [0, 1.4], [0.7, 1.4], [-0.7, 1.4],
];
/** Where people stand by a seat that is taken (metres across, then in front of it): a bench's overflow stands to the side before it, and right in front of the sitter's knees only last. */
const SEAT_STAND: readonly (readonly [number, number])[] = [[0.75, 0.75], [-0.75, 0.75], [1.45, 0.75], [-1.45, 0.75], [2.15, 0.75], [-2.15, 0.75], [1.05, 1.45], [-1.05, 1.45], [0.35, 1.45], [-0.35, 1.45], [0, 0.75]];

interface Spot { x: number; z: number; y: number; sit: boolean }

/**
 * The places round each station. Stations whose places come within reach of each other (a bench's two seats, the gate's arches side by side)
 * share them, as one group, so people at the two never stand in one place: `spotsOf` is every station's list (see `Folk.spots`), `idsOf` the same
 * list as indices into its group's places, and `groupOf` the group.
 */
function stationSpots(nav: Nav): { spotsOf: Float64Array[]; idsOf: Int32Array[]; groupOf: Int32Array } {
  const S = nav.stations;
  const APART = 0.6;
  const near = (p: Spot, q: Spot): boolean => Math.hypot(p.x - q.x, p.z - q.z) < APART;
  // each station's own places: its point, then the places beside and behind it (or, for a seat, in front of it) that a person can stand on
  const own: Spot[][] = S.map((st) => {
    const list: Spot[] = [{ x: st.x, z: st.z, y: st.y, sit: st.seat }];
    if (!st.ok || st.hidden) return list;
    const lx = Math.cos(st.facing), lz = -Math.sin(st.facing); // (across the way it faces)
    const bx = Math.sin(st.facing), bz = Math.cos(st.facing); // (behind it)
    for (const [a, b] of st.seat ? SEAT_STAND : SPOT_OFFSETS.slice(1)) {
      const f = st.seat ? -b : b; // (a seat's overflow stands in front of it)
      const sp: Spot = { x: st.x + lx * a + bx * f, z: st.z + lz * a + bz * f, y: 0, sit: false };
      if (list.some((q) => near(q, sp))) continue;
      const y = standingHeight(nav.world, sp.x, sp.z, st.y);
      if (y === undefined || Math.abs(y - st.y) > 0.3) continue;
      if (!st.seat && !segmentOk(nav.world, st.x, st.z, st.y, sp.x, sp.z)) continue;
      sp.y = y;
      list.push(sp);
    }
    return list;
  });
  // groups: stations any of whose places come near each other's
  const groupOf = new Int32Array(S.length).map((_, i) => i);
  const root = (i: number): number => (groupOf[i] === i ? i : (groupOf[i] = root(groupOf[i]!)));
  for (let i = 0; i < S.length; i++)
    for (let j = i + 1; j < S.length; j++) if (own[i]!.some((p) => own[j]!.some((q) => near(p, q)))) groupOf[Math.max(root(i), root(j))] = Math.min(root(i), root(j));
  for (let i = 0; i < S.length; i++) groupOf[i] = root(i);
  // a group's places: every member's own point first, then the rest, none within reach of another; `from[k]` is the station that offered place k
  const places = new Map<number, Spot[]>();
  const from = new Map<number, number[]>();
  for (const pass of [0, 1])
    for (let i = 0; i < S.length; i++) {
      const g = groupOf[i]!;
      let list = places.get(g);
      if (!list) {
        places.set(g, (list = []));
        from.set(g, []);
      }
      for (const sp of pass === 0 ? own[i]!.slice(0, 1) : own[i]!.slice(1))
        if (!list.some((q) => near(q, sp))) {
          list.push(sp);
          from.get(g)!.push(i);
        }
    }
  const spotsOf: Float64Array[] = [];
  const idsOf: Int32Array[] = [];
  for (let i = 0; i < S.length; i++) {
    const st = S[i]!;
    const g = groupOf[i]!;
    const list = places.get(g)!;
    const by = from.get(g)!;
    // this station's own point; for a seat, the bench's other seat; then its own places; then a neighbour's places a step away and straight in
    // reach (never a seat for someone who is not sitting, never a place across a wall or a jump away)
    const rank = (k: number): number => {
      const sp = list[k]!;
      if (Math.abs(sp.x - st.x) < 1e-9 && Math.abs(sp.z - st.z) < 1e-9) return 0;
      const d = Math.hypot(sp.x - st.x, sp.z - st.z);
      if (sp.sit) return st.seat && d < 1 ? 1000 + k : -1;
      if (by[k] === i) return 2000 + k;
      if (d > 1.5 || (!st.seat && !segmentOk(nav.world, st.x, st.z, st.y, sp.x, sp.z))) return -1;
      return 3000 + k;
    };
    const order = list.map((_, k) => k).filter((k) => rank(k) >= 0).sort((p, q) => rank(p) - rank(q));
    const out = new Float64Array(order.length * 4);
    order.forEach((k, j) => {
      const sp = list[k]!;
      out[j * 4] = sp.x - st.x;
      out[j * 4 + 1] = sp.z - st.z;
      out[j * 4 + 2] = sp.y;
      out[j * 4 + 3] = sp.sit ? 1 : 0;
    });
    spotsOf.push(out);
    idsOf.push(Int32Array.from(order));
  }
  return { spotsOf, idsOf, groupOf };
}

/**
 * Gives every person their own place at each station for as long as they may be there, so two people never stand (or sit) in one place: they did,
 * two gossips on one paving stone, two readers on one bench seat, a crowd sheltering in one body on the hall's porch bench. A person may be at a
 * station through a run of consecutive stints (working there, sheltering there when it rains, or at the far end of a loop); each run is an
 * interval of the day, and runs in one group of places (a station, or a bench's seats) that overlap get different places: each takes the first
 * free one in its station's order (its own seat or spot first). Rain is not known in advance, so a shelter run counts whether or not it rains.
 * Deterministic: fixed by the roster.
 */
function assignSpots(roster: readonly Villager[], idsOf: readonly Int32Array[], groupOf: Int32Array): void {
  interface Run { v: number; x: number; a: number; b: number; ks: number[]; id: number }
  const runs: Run[] = [];
  for (const v of roster) {
    const S = v.stints;
    const n = S.length;
    if (n === 0) continue;
    const span = (k: number): number => {
      let d = S[(k + 1) % n]!.at - S[k]!.at;
      while (d <= 1e-9) d += 24;
      return d;
    };
    const at = (k: number, x: number): boolean => S[k]!.st === x || S[k]!.shelter === x || S[k]!.to === x;
    const seen = new Set<number>();
    for (const s of S) for (const x of [s.st, s.shelter, s.to]) if (x >= 0) seen.add(x);
    for (const x of seen) {
      if (S.every((_, k) => at(k, x))) {
        runs.push({ v: v.id, x, a: S[0]!.at, b: S[0]!.at + 24, ks: S.map((_, k) => k), id: -1 });
        continue;
      }
      for (let k = 0; k < n; k++) {
        if (!at(k, x) || at((k - 1 + n) % n, x)) continue; // (a run starts where the stint before it is elsewhere)
        const ks: number[] = [];
        let len = 0;
        for (let j = k; at(j, x) && ks.length < n; j = (j + 1) % n) {
          ks.push(j);
          len += span(j);
        }
        runs.push({ v: v.id, x, a: S[k]!.at, b: S[k]!.at + len, ks, id: -1 });
      }
    }
  }
  const overlap = (p: Run, q: Run): boolean => [-24, 0, 24].some((d) => p.a < q.b + d && q.a + d < p.b); // (round the clock: a run may pass midnight)
  const byGroup = new Map<number, Run[]>();
  for (const r of runs) {
    const g = groupOf[r.x]!;
    let list = byGroup.get(g);
    if (!list) byGroup.set(g, (list = []));
    list.push(r);
  }
  for (const list of byGroup.values()) {
    list.sort((p, q) => p.a - q.a || p.v - q.v || p.x - q.x);
    for (const r of list) {
      const ids = idsOf[r.x]!;
      let slot = 0;
      while (slot < ids.length - 1 && list.some((q) => q.id === ids[slot] && q.v !== r.v && overlap(r, q))) slot++;
      r.id = ids[slot]!;
      const S = roster[r.v]!.stints;
      for (const k of r.ks) {
        const s = S[k]!;
        if (s.st === r.x) s.slot = slot;
        if (s.shelter === r.x) s.shelterSlot = slot;
        if (s.to === r.x) s.toSlot = slot;
      }
    }
  }
}

/** A person's own place at a station: its offset from the station's point, its height, whether it is a seat, and how far it is from the point. */
interface Place { dx: number; dz: number; y: number; sit: boolean; len: number }
const placeA: Place = { dx: 0, dz: 0, y: 0, sit: false, len: 0 };
const placeB: Place = { dx: 0, dz: 0, y: 0, sit: false, len: 0 };

/** The place `slot` at `station` (the last place takes any overflow), written into `o`. */
function placeAt(folk: Folk, station: number, slot: number, o: Place): Place {
  const sp = folk.spots[station]!;
  const i = Math.min(slot, sp.length / 4 - 1) * 4;
  o.dx = sp[i]!;
  o.dz = sp[i + 1]!;
  o.y = sp[i + 2]!;
  o.sit = sp[i + 3]! > 0;
  o.len = Math.hypot(o.dx, o.dz);
  return o;
}

/**
 * Where a walker is `s` metres along a walk from their place `a` at station `A` to their place `b` at `B`: a straight step from the place to the
 * station's point, the route, and a straight step from the far station's point onto the place (both steps were tested walkable when the places
 * were made, so a walker is always on ground somebody can stand on).
 */
function placeOnWalk(v: Villager, nav: Nav, r: Route, A: number, a: Place, B: number, b: Place, s: number, out: VillagerPose): void {
  if (s < a.len) {
    const sa = nav.stations[A]!;
    const t = s / a.len;
    out.x = sa.x + a.dx * (1 - t);
    out.z = sa.z + a.dz * (1 - t);
    out.y = a.y + (sa.y - a.y) * t;
    out.facing = Math.atan2(a.dx, a.dz);
    return;
  }
  const d = s - a.len;
  if (d <= r.len || b.len <= 0) {
    placeOnRoute(v, r, Math.min(d, r.len), out);
    return;
  }
  const sb = nav.stations[B]!;
  const t = Math.min(1, (d - r.len) / b.len);
  out.x = sb.x + b.dx * t;
  out.z = sb.z + b.dz * t;
  out.y = sb.y + (b.y - sb.y) * t;
  out.facing = Math.atan2(-b.dx, -b.dz);
}

/** Drops stints that cannot be walked to from the one before (a station cut off in this world); disables shelters whose route is missing. */
function pruneUnroutable(nav: Nav, stints: Stint[]): Stint[] {
  let cur = stints.slice();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let k = 0; k < cur.length && cur.length > 1; k++) {
      const a = cur[k]!;
      const b = cur[(k + 1) % cur.length]!;
      if (a.st !== b.st && nav.distance(a.st, b.st) === Infinity) {
        cur.splice((k + 1) % cur.length, 1);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  for (let k = 0; k < cur.length; k++) {
    const a = cur[k]!;
    const b = cur[(k + 1) % cur.length]!;
    if (a.shelter >= 0) {
      for (const [from, to] of [[a.shelter, b.st], [a.shelter, b.shelter >= 0 ? b.shelter : b.st]] as const) if (from !== to && nav.distance(from, to) === Infinity) a.shelter = -1;
    }
    if (b.shelter >= 0 && a.st !== b.shelter && nav.distance(a.st, b.shelter) === Infinity) b.shelter = -1;
    if (a.to >= 0 && nav.distance(a.st, a.to) === Infinity) a.to = -1;
  }
  // (a shelter needs the route from the PREVIOUS stint's position, sheltered or not: recheck both)
  for (let k = 0; k < cur.length; k++) {
    const a = cur[(k + cur.length - 1) % cur.length]!;
    const b = cur[k]!;
    if (b.shelter >= 0) {
      for (const from of a.shelter >= 0 ? [a.st, a.shelter] : [a.st]) if (from !== b.shelter && nav.distance(from, b.shelter) === Infinity) b.shelter = -1;
    }
    if (a.shelter >= 0 && a.shelter !== b.st && nav.distance(a.shelter, b.st) === Infinity) a.shelter = -1;
  }
  cur = cur.filter(Boolean);
  return cur;
}

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Puts an appointment into a script for a while, then puts the person back where they were. */
function withEvent(script: Appt[], at: number, dur: number, appt: Appt): Appt[] {
  const sorted = script.slice().sort((a, b) => a[0] - b[0]);
  let before: Appt | undefined;
  for (const a of sorted) if (a[0] <= at) before = a;
  const out = sorted.filter((a) => a[2] === "sleep" || a[0] < at - 0.001 || a[0] > at + dur + 0.001);
  out.push(appt);
  if (before && before[2] !== "sleep" && before[1] !== appt[1]) out.push([at + dur, before[1], before[2] === "ring" ? "idle" : before[2], before[3]]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** The lamplighter's rounds: along the row of lamp posts at dusk to light them, and back at first light to put them out. */
function lampScript(script: Appt[]): Appt[] {
  const out = script.filter((a) => a[0] > 6.4 && a[0] < 17.5 || a[0] > 19.9);
  const posts = 10;
  for (let i = 0; i < posts; i++) out.push([17.9 + i * 0.14, `lamp:${i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  for (let i = 0; i < posts; i++) out.push([5.9 + i * 0.11, `lamp:${posts - 1 - i}`, "lamp", { carryIn: "lantern", carry: "lantern" }]);
  // (the morning round is followed by the doorstep at 6.6, the evening one by supper)
  out.push([19.4, "step:stilt-e", "idle"]);
  return out.sort((a, b) => a[0] - b[0]);
}

// ---- where is everyone --------------------------------------------------------------------------------------------------------------

export interface VillagerPose {
  x: number;
  y: number;
  z: number;
  /** Character facing (0 = -Z). */
  facing: number;
  /** Metres per second right now. */
  speed: number;
  act: Activity;
  carry: Carry;
  /** False while indoors (asleep or sheltering inside). */
  visible: boolean;
  /** Villager id of whoever they are talking to, or -1. */
  partner: number;
  /** Station index they are at or heading for. */
  station: number;
  /** True while they are out of their routine because of weather. */
  rained: boolean;
  /** True while they sit on a seat (a bench's overflow stands beside it instead). */
  seated: boolean;
}

export const createVillagerPose = (): VillagerPose => ({ x: 0, y: 0, z: 0, facing: 0, speed: 0, act: "idle", carry: "none", visible: true, partner: -1, station: 0, rained: false, seated: false });

const rainTmp = createWeather();
const rainCache = new Map<number, number>();

/** The rain (0..1) at world time `ms`, quantised to 50 ms and cached (weather is a pure function, so this is only saving arithmetic). */
function rainAtMs(clock: FolkClock, ms: number): number {
  if (clock.rain !== undefined) return clock.rain;
  const q = Math.round(ms / 50);
  const key = q * 1009 + (clock.seed & 1023);
  const hit = rainCache.get(key);
  if (hit !== undefined) return hit;
  if (rainCache.size > 4096) rainCache.clear();
  const r = weatherAt(clock.seed, q * 50, rainTmp).rain;
  rainCache.set(key, r);
  return r;
}

/** Whether rain drives a stint under cover: decided from the rain at its arrival. */
const RAINED = 0.36;
const rainy = (clock: FolkClock, ms: number): boolean => rainAtMs(clock, ms) > RAINED;

/** Hours needed to walk `len` metres at a villager's pace when an hour lasts `hourSec` seconds. */
const commuteHours = (len: number, walk: number, hourSec: number): number => (len <= 0.05 ? 0 : clamp(len / (WALK * walk * hourSec), 0.02, 3));

/** A trapezoid: ease in and out over the first and last `a` of the way. Position and its rate of change, both 0..1 for u in 0..1. */
function trapezoid(u: number, a = 0.14): { p: number; v: number } {
  const t = clamp(u, 0, 1);
  const k = a * (1 - a);
  if (t < a) return { p: (0.5 * t * t) / k, v: t / k };
  if (t > 1 - a) return { p: 1 - (0.5 * (1 - t) * (1 - t)) / k, v: (1 - t) / k };
  return { p: (t - a / 2) / (1 - a), v: 1 / (1 - a) };
}

const rp = { x: 0, z: 0, y: 0, tx: 0, tz: -1, clear: 0 };
const rq = { x: 0, z: 0, y: 0, tx: 0, tz: -1, clear: 0 };

function placeOnRoute(v: Villager, r: Route, s: number, out: VillagerPose): void {
  routePoint(r, s, rp);
  // keep to one side of the road: a small offset to the right of the way of travel
  const off = v.lane * rp.clear;
  out.x = rp.x - rp.tz * off;
  out.z = rp.z + rp.tx * off;
  out.y = rp.y;
  routePoint(r, Math.min(r.len, s + 0.45), rq);
  const dx = rq.x - rp.x;
  const dz = rq.z - rp.z;
  out.facing = dx * dx + dz * dz > 1e-6 ? Math.atan2(-dx, -dz) : Math.atan2(-rp.tx, -rp.tz);
}

/** Where a villager is at `clock`. Pure; allocation-free. */
export function villagerAt(folk: Folk, index: number, clock: FolkClock, out: VillagerPose): VillagerPose {
  const v = folk.roster[index]!;
  const S = v.stints;
  const n = S.length;
  out.partner = -1;
  out.carry = "none";
  out.visible = true;
  out.speed = 0;
  out.rained = false;
  out.seated = false;
  if (n === 0) {
    out.act = "sleep";
    out.visible = false;
    return out;
  }
  const nav = folk.nav;
  const h = clock.hours;
  let k = -1;
  for (let j = 0; j < n; j++) if (S[j]!.at <= h) k = j;
  let tk: number;
  if (k < 0) {
    k = n - 1;
    tk = S[k]!.at - 24;
  } else tk = S[k]!.at;
  const nk = (k + 1) % n;
  let tn = S[nk]!.at;
  while (tn <= tk + 1e-6) tn += 24;
  const sk = S[k]!;
  const sn = S[nk]!;
  const flagK = sk.shelter >= 0 && rainy(clock, clock.worldMs - msBetween(clock, sk.at, h));
  const flagN = sn.shelter >= 0 && rainy(clock, clock.worldMs + msBetween(clock, h, sn.at));
  const A = flagK ? sk.shelter : sk.st;
  const Bn = flagN ? sn.shelter : sn.st;
  const st = nav.stations[A]!;
  const route = A === Bn ? undefined : nav.route(A, Bn);
  const pa = placeAt(folk, A, flagK ? sk.shelterSlot : sk.slot, placeA);
  const pb = placeAt(folk, Bn, flagN ? sn.shelterSlot : sn.slot, placeB);
  const walkLen = route ? pa.len + route.len + pb.len : 0;
  const gap = tn - tk;
  const hourSec = hourSecAt(clock, tn);
  const c = route ? Math.min(commuteHours(walkLen, v.walk, hourSec), gap * 0.85) : 0;
  const td = tn - c;
  out.rained = flagK || flagN;

  // ---- on the way to the next stint --------------------------------------------------------------------------------------------------
  if (route && c > 0 && h >= td) {
    const u = (h - td) / c;
    const tz = trapezoid(u);
    const s = tz.p * walkLen;
    placeOnWalk(v, nav, route, A, pa, Bn, pb, s, out);
    out.speed = (tz.v * walkLen) / (c * hourSec);
    out.act = "walk";
    out.carry = sn.carryIn;
    out.station = Bn;
    const rs = s - pa.len;
    out.visible = rs > route.hideUntil && rs < route.hideFrom;
    // turn to the station's own facing over the last stretch
    const rest = walkLen - s;
    if (rest < 1.4) out.facing = out.facing + wrapAngle(nav.stations[Bn]!.facing - out.facing) * smoothstep(1.4, 0.3, rest);
    // and turn away from it at the start
    if (s < 0.7) out.facing = st.facing + wrapAngle(out.facing - st.facing) * smoothstep(0, 0.7, s);
    return out;
  }

  // ---- at the station (or looping from it) -----------------------------------------------------------------------------------------------
  out.station = A;
  out.x = st.x + pa.dx;
  out.z = st.z + pa.dz;
  out.y = pa.y;
  out.facing = st.facing;
  out.visible = !st.hidden;
  out.seated = pa.sit;
  if (flagK) {
    out.act = st.hidden ? "sleep" : "shelter";
    return out;
  }
  out.act = sk.act;
  out.carry = sk.carry;
  out.partner = sk.partner;
  if (sk.to >= 0 && sk.to !== A) {
    const leg = nav.route(A, sk.to);
    const back = nav.route(sk.to, A);
    if (leg && back) {
      const pt = placeAt(folk, sk.to, sk.toSlot, placeB);
      const legLen = pa.len + leg.len + pt.len;
      const backLen = pt.len + back.len + pa.len;
      const hs = hourSecAt(clock, tk); // (fixed for the stint, so a loop never changes pace mid-way)
      const w = commuteHours(legLen, v.walk, hs);
      const T = 2 * w + 2 * LOOP_DWELL;
      const cycles = Math.floor((td - tk) / T);
      const t = h - tk;
      if (t < cycles * T) {
        const p = t % T;
        const tgt = nav.stations[sk.to]!;
        if (p < LOOP_DWELL) return out;
        if (p < LOOP_DWELL + w) {
          const q = trapezoid((p - LOOP_DWELL) / w, 0.2);
          placeOnWalk(v, nav, leg, A, pa, sk.to, pt, q.p * legLen, out);
          out.speed = (q.v * legLen) / (w * hs);
          out.act = "walk";
          out.carry = sk.carryOut;
          out.visible = true;
          out.seated = false;
          return out;
        }
        if (p < 2 * LOOP_DWELL + w) {
          out.x = tgt.x + pt.dx;
          out.z = tgt.z + pt.dz;
          out.y = pt.y;
          out.facing = tgt.facing;
          out.act = sk.actTo;
          out.carry = "none";
          out.seated = pt.sit;
          return out;
        }
        const q = trapezoid((p - 2 * LOOP_DWELL - w) / w, 0.2);
        placeOnWalk(v, nav, back, sk.to, pt, A, pa, q.p * backLen, out);
        out.speed = (q.v * backLen) / (w * hs);
        out.act = "walk";
        out.carry = "none";
        out.seated = false;
        return out;
      }
    }
  }
  return out;
}

// ---- speech --------------------------------------------------------------------------------------------------------------------------------

export interface Speech {
  text: string;
  /** 0..1 through the time it stays up. */
  u: number;
}

const SAY_SECONDS = 5.5;

/**
 * What a villager is saying at world time `worldSec` (real seconds), if anything: a short authored line every half a minute or so, chosen from
 * their own trade, the general pool, the weather or the hour. Deterministic, so everyone reads the same balloon. `pose` is their current pose.
 */
export function villagerSays(v: Villager, pose: VillagerPose, worldSec: number, hours: number, rain: number, out: Speech): Speech | undefined {
  if (!pose.visible || pose.act === "sleep" || pose.act === "walk" && pose.speed > 1.6) return undefined;
  const period = 26 + hashFloat(v.id, 1, 0x1a) * 22;
  const phase = hashFloat(v.id, 2, 0x1a) * period;
  const slot = Math.floor((worldSec + phase) / period);
  const into = (worldSec + phase) - slot * period;
  if (into > SAY_SECONDS) return undefined;
  // not everyone speaks in every slot, and pairs take turns
  if (hash3(v.id, slot, 0x2b) % 100 > (pose.act === "chat" ? 92 : 55)) return undefined;
  if (pose.act === "chat" && pose.partner >= 0 && (slot + (v.id < pose.partner ? 0 : 1)) % 2 === 1) return undefined;
  const dark = hours < 5.2 || hours > 20.6;
  const moment = rain > RAINED ? "rain" : dark && hash3(v.id, slot, 5) % 3 === 0 ? "night" : "";
  out.text = pickLine(v.lines, v.id, slot, moment);
  out.u = into / SAY_SECONDS;
  return out;
}

/** A greeting for a passing player (the client asks when someone comes close and the villager is idle). */
export function villagerGreeting(v: Villager, slot: number): string {
  return pickLine(v.lines, v.id, slot, "greet");
}
