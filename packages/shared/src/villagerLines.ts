import { hash3 } from "./rng.ts";

/**
 * What Hollowmere's people say, in telegram captions over their heads now and then. AUTHORED text, no generation: a pool per kind of person and
 * per moment, chosen by a hash of (person, time slot), so every player sees the same words. The village is a fictional place with a manner of its
 * own; the satire is aimed at institutions (forms, surveys, "improvement", the Society's timetables, tourism) and the people themselves are kind,
 * dry and quite capable of managing the visitors back. Nothing here refers to any real people, nation or faith.
 */

export type LineKind = "keeper" | "miller" | "smith" | "baker" | "ferryman" | "clockkeeper" | "seller" | "child" | "elder" | "laundress" | "fisher" | "gardener" | "beekeeper" | "guard" | "watch" | "lamplighter" | "registrar" | KessarLineKind | BrineLineKind;

/** D-120: what Lampside's people say (Kessar's lower town): their own trades, and the Kessarine pools below instead of Hollowmere's. */
export type KessarLineKind = "kLamp" | "kSeller" | "kWater" | "kGarden" | "kClerk" | "kElder" | "kChild";
/** D-123: the Brinefolk at the Brine Houses' salt pans. */
export type BrineLineKind = "bRaker" | "bBarrow" | "bSkim" | "bTally" | "bPump" | "bElder" | "bChild";

const GENERAL: readonly string[] = [
  "Lovely day for not improving anything.",
  "The Society sends surveyors. We send them tea. It evens out.",
  "You'll want the path. We didn't make it; it simply happened.",
  "Tuesday, again. It is always Tuesday at the market.",
  "If you're lost, stay put. We'll draw you a map. It'll be wrong, but kindly.",
  "Forms are available in triplicate, or in a drawer, whichever is nearer.",
  "We were promised a railway. We asked for a bench. We got the bench.",
  "Mind the geese. They have not signed anything either.",
  "Nothing to report. Nothing to report is a great achievement.",
  "Do sign the visitors' book. We press flowers in it.",
];

const BY_KIND: Record<Exclude<LineKind, KessarLineKind | BrineLineKind>, readonly string[]> = {
  keeper: [
    "It is very nearly the hour. It usually is.",
    "The hour is kept, not caught. Do sit.",
    "Bells at dawn, noon and dusk. Between them, opinions.",
    "I keep the hours. The hours keep me a bit thin.",
    "Punctuality is only lateness with a good publicist.",
  ],
  miller: [
    "Flour by arrangement. The arrangement is that you wait.",
    "The wheel turns when the water asks it to.",
    "Sacks don't lift themselves. I've asked.",
    "Grinding since before the Survey. Grinding since before breakfast, in fact.",
  ],
  smith: [
    "Farrier, smith, and opinions. The opinions are free.",
    "It's not broken, it's decorative. That'll be a penny.",
    "Hot iron, cold tea. That's the whole trade.",
    "Whatever the Society sends us, I can make it slightly less pointy.",
  ],
  baker: [
    "Warm loaves! The crust is a matter of opinion.",
    "Bread, buns, and regrets. Mostly bread.",
    "Up before the sun. The sun doesn't thank me either.",
    "Take two. The second is a reference.",
  ],
  ferryman: [
    "Ferry, no charge for the unworldly. Are you unworldly?",
    "The pond's only nine feet across. It's the principle.",
    "Crossing's a state of mind. Also a punt.",
    "Everybody's going somewhere. The pond's just for thinking.",
  ],
  clockkeeper: [
    "It is right twice a day. I merely arrange to be there.",
    "Don't look at me, look at it. It's the one that's wrong.",
    "Half past. Or possibly half future.",
    "I wind it, I oil it, I forgive it.",
  ],
  seller: [
    "Pears! Not for sale to surveyors.",
    "Tea! No surveyors past this point.",
    "Yesterday's fish, cheaply. Very cheaply.",
    "Buy something. We've been out of a reason for years.",
    "Everything half price, then doubled for the discount.",
  ],
  child: [
    "Are you a surveyor? Can you survey my frog?",
    "I found a stone. It's the best stone.",
    "I'm not running. I'm improving my walking.",
    "Bet you can't hop to the well.",
    "Grown-ups say 'nothing to report' a lot.",
  ],
  elder: [
    "In my day the hills were much further.",
    "I remember the last improvement. It was tidied away.",
    "Sit, sit. The bench remembers you.",
    "I've been asked to retire. I've been asked to be asked.",
    "Young people rush. I get there when I'm ready.",
  ],
  laundress: [
    "Whites here, greys there, and the rest is weather.",
    "If it's on the line, it's on the record.",
    "The stream takes the dirt. I take the credit.",
  ],
  fisher: [
    "Catching's not the point. Sitting is the point.",
    "The fish and I have an understanding. They understand.",
    "Quiet, please. I'm listening to nothing biting.",
  ],
  gardener: [
    "Cabbages don't improve. That's their charm.",
    "It'll come up when it's good and ready. So will I.",
    "Weeds are only flowers with no publicist.",
  ],
  beekeeper: [
    "Don't wave. They take it as a comment.",
    "The bees have never heard of the Empire. They're doing splendidly.",
    "Honey is just sunlight with paperwork.",
  ],
  guard: [
    "Papers? Ah, you have none. Splendid, carry on.",
    "State your business. Or, failing that, your hat.",
    "We keep out improvement. Surveyors may pass, on sufferance.",
    "I stand here. That's the job. It is going well.",
  ],
  watch: [
    "All's well. Nothing is very well. But all's.",
    "Lamps lit, doors shut, owls on the record.",
    "The night shift is mostly listening.",
  ],
  lamplighter: [
    "One lamp at a time. Progress in the smallest possible units.",
    "They light themselves, really. I supervise.",
    "A little light for the parish. Don't tell the Society.",
  ],
  registrar: [
    "Item: nothing happened. Signed, Registrar.",
    "Please hold still while nothing is recorded.",
    "I keep the Record of Non-Events. Volume forty-one.",
    "Today: no incidents. Tomorrow: to be confirmed.",
    "An empty ledger is a well-run village.",
  ],
};

/**
 * D-120: the Kessarine, coast and hill-fort folk of the Ward of the Nine Lamps: tall, lamp-bearing and professionally unsurprised by anybody's paperwork. The joke is the
 * Society's forms, maps and expeditions meeting a people who have seen them all before; the people themselves are dry, capable and quite happy to manage the visitors back.
 */
const KESSAR_BY_KIND: Record<KessarLineKind, readonly string[]> = {
  kLamp: [
    "Trim the wick, mind the oil, ignore the Society.",
    "Nine lamps. I could do them blindfold. I did once. Never again.",
    "Dusk is my busy hour. Dawn is my other busy hour.",
    "A lamp left untrimmed is a lamp that gossips.",
    "The notice on my door is perfectly true. It usually is.",
  ],
  kSeller: [
    "Brass lamps, fair price, no haggling with expeditions.",
    "That one is an heirloom. So is that one. They are all heirlooms.",
    "Payment in coin, please, not in promises of a railway.",
    "Jars for water, jars for oil, jars for the Society's correspondence.",
    "Your Form 7 is not legal tender. I did check.",
  ],
  kWater: [
    "The well is deep and the queue is short. Let's keep it that way.",
    "Two buckets a trip. Your Society would form a committee.",
    "Fresh water: unassessed, untaxed, unimproved.",
    "Every house gets its water. Even the ones with notices.",
  ],
  kGarden: [
    "Dates take longer than an expedition. Most things do.",
    "The barley needs no surveying. It needs water.",
    "Plant a palm for your grandchildren. Plant a form for nobody.",
    "Mind the drills. They were straight before your boots.",
  ],
  kClerk: [
    "A chit for the street, a chit for the well, a chit for asking about chits.",
    "Stamped, dated and filed under 'Society, again'.",
    "The Warden signs at noon. Noon is negotiable.",
    "No chit, no caller. It's on the door. In writing.",
  ],
  kElder: [
    "I remember the last expedition. And the one before. Same boots.",
    "In my day we sealed the doors with wax. Now it's paper. Standards.",
    "Sit? We stand in Lampside. It keeps the visitors moving.",
    "They named this street after themselves once. It didn't take.",
  ],
  kChild: [
    "Are you lost? Grown-ups from ships are always lost.",
    "Does your compass point at the fort too? Ours does.",
    "My lamp is the fourth one. It's the best one.",
    "Is that a real hat or a Society hat?",
  ],
};

const KESSAR_GENERAL: readonly string[] = [
  "The Society again. We had one last year. It went the same way.",
  "Nine lamps, one Ward, no forms. It saves a great deal of time.",
  "The gate opens when the lamps agree. The lamps are in no hurry.",
  "Another expedition. Do they make you in batches?",
  "We read your Form 7. It lit Form 8 beautifully.",
  "Your map has us as a blank. We're flattered. Blanks pay no tax.",
  "Mind the step. It was here before your Empire, and it will wait.",
  "Nothing surprises the Ward. You came close once. It was the hat.",
];

const KESSAR_RAIN: readonly string[] = [
  "Rain. The lamps sulk and the gardens cheer.",
  "Under the awning. It has outlasted three governors.",
  "Wet season. The Society calls it a 'hydrological event'.",
];

const KESSAR_NIGHT: readonly string[] = [
  "Nine lamps lit. Count them; the Society always gets eight.",
  "Evening. The Ward keeps the lamps; the dark keeps itself.",
  "Late for a visit. Later still for a survey.",
];

const KESSAR_GREET: readonly string[] = [
  "Peace on your lamp. Have you a chit?",
  "Welcome to Lampside. Please don't name anything.",
  "Ah, the Society. We've left a light on. Not for you, but still.",
  "Good day. The bar is that way, should you wish to pay it twice.",
  "Visitors! Mind the gardens. The barley bites.",
];

/** D-122: shooting in the street. The Kessarine have seen expeditions before; they go in by the back and complain in writing. */
const KESSAR_FRIGHT: readonly string[] = [
  "Lamps out! Everyone in by the back!",
  "Not in the street, sirs! The street is for walking!",
  "The Ward will hear of this. Loudly. In triplicate.",
  "Inside, little one! Leave the hoop!",
  "Another expedition, another shutter.",
  "Gunfire? We were promised a survey.",
];

const isKessar = (k: LineKind): k is KessarLineKind => k in KESSAR_BY_KIND;

/**
 * D-123: the Brinefolk, delta waders who work the Brine Houses' pans: "who sell the tide by deed and everything else by the lot". The joke is the Houses' auctions and the
 * Society's surveyors meeting people who have long since been sold, resold and counted, and find it all very funny; the Brinefolk themselves are dry, quick and amused.
 */
const BRINE_BY_KIND: Record<BrineLineKind, readonly string[]> = {
  bRaker: [
    "Rake it in rows. The Houses like to count it twice.",
    "Lot nine's still drying. Lot nine was sold on Tuesday.",
    "Salt's the only thing here that keeps.",
    "Mind the windrows. That's somebody's dowry.",
  ],
  bBarrow: [
    "Heap one's sold, heap two's bid, heap three's arguing.",
    "Mind your boots. That's somebody's profit.",
    "Forty barrows a day. The barrow gets a bead for each.",
  ],
  bSkim: [
    "When it goes pink it's nearly salt. When it goes white it's nearly sold.",
    "Skim the crust, leave the brine. Leave the bids to the Houses.",
    "Rose, then white, then money. In that order, mostly.",
  ],
  bTally: [
    "Every grain counted. The grains are not consulted.",
    "Bids close at high water. Everything closes at high water.",
    "One bead a barrow. Don't tell the beads.",
    "Your Society bid on lot four. Lot four declined.",
  ],
  bPump: [
    "The wind pumps, I watch. It's a partnership.",
    "Brine in, salt out, the Houses in between.",
    "She creaks when she's happy. She's never happy.",
  ],
  bElder: [
    "I raked this pan when it was a different lot.",
    "The Houses have changed their colours four times. The salt hasn't.",
    "Salt's patient. The Houses aren't. That's the whole trade.",
  ],
  bChild: [
    "I'm not allowed in the pink ones.",
    "Bet you can't walk the bund with your eyes shut.",
    "When I'm big I'll rake the white ones.",
  ],
};

const BRINE_GENERAL: readonly string[] = [
  "You're standing on lot twelve. That'll be a penny.",
  "The Society wants to survey the salt. The salt has declined to be surveyed.",
  "Everything here's for sale but the weather, and that's under offer.",
  "Bought by the Houses, sold by the Houses, raked by us. Fair's fair.",
  "We'd show you round, but you'd want a receipt.",
];

const BRINE_RAIN: readonly string[] = [
  "Rain! Cover the heaps! Cover the bids!",
  "Rain in the pans. Three days gone and the price up.",
  "Indoors. The salt won't rake itself, and in this it won't even try.",
];

const BRINE_NIGHT: readonly string[] = [
  "The pans sleep. The Houses don't.",
  "Dark's free. The Houses haven't noticed.",
  "Late for a bid. Early for a raking.",
];

const BRINE_GREET: readonly string[] = [
  "Welcome to the pans. Mind the brine, it bites boots.",
  "A visitor! Buying, or being sold to?",
  "Morning. Don't stand on the windrows, they're spoken for.",
  "Ah, the Society. Lot or no lot?",
];

/** D-123: shooting at the pans. */
const BRINE_FRIGHT: readonly string[] = [
  "Not in the pans! That's twelve lots of salt!",
  "Into the hut! Leave the rake!",
  "Who's shooting at the salt?",
  "Down! Down in the brine!",
  "That's the Society. Nobody else bids that loud.",
];

const isBrine = (k: LineKind): k is BrineLineKind => k in BRINE_BY_KIND;

const RAIN: readonly string[] = [
  "It's only weather. Weather is very good at being weather.",
  "Under here, quick. The awning has never said no.",
  "Rain again. The Society calls it 'unimproved moisture'.",
  "A drop for every survey. They're making up for it.",
];

const NIGHT: readonly string[] = [
  "Mind the dark. It's the Society's biggest unfunded project.",
  "The lamps are lit. Nobody asked me to; I just did.",
  "Quiet night. Well, quiet-ish. The owls have a lot to say.",
];

/** D-122: shooting in the village. The Mereborn take cover first and send the invoice later. */
const FRIGHT: readonly string[] = [
  "Inside! Everybody inside! Mind the hens!",
  "Not the windows! We've only just paid for the windows!",
  "Is this the improvement they promised?",
  "Somebody write this down. Then hide the pen.",
  "The Society's here, then. Get the washing in!",
  "Not again! The geese had only just calmed down!",
];

const GREET: readonly string[] = [
  "Good day. Please don't improve anything.",
  "A visitor! Do keep to the path we didn't make.",
  "Ah, one of the Society's? You have the look. And the boots.",
  "Welcome to Hollowmere. The clock is right twice a day.",
  "Hello! Mind the geese.",
];

/** The line to show for a person: deterministic in (id, slot). `moment` picks a special pool; otherwise a mix of the person's own and the general pool. */
export function pickLine(kind: LineKind, id: number, slot: number, moment: "" | "rain" | "night" | "greet" | "fright" = ""): string {
  if (isBrine(kind)) {
    const pool = moment === "rain" ? BRINE_RAIN : moment === "night" ? BRINE_NIGHT : moment === "greet" ? BRINE_GREET : moment === "fright" ? BRINE_FRIGHT : hash3(id, slot, 3) % 5 < 3 ? BRINE_BY_KIND[kind] : BRINE_GENERAL;
    return pool[hash3(id, slot, 11) % pool.length]!;
  }
  if (isKessar(kind)) {
    const pool = moment === "rain" ? KESSAR_RAIN : moment === "night" ? KESSAR_NIGHT : moment === "greet" ? KESSAR_GREET : moment === "fright" ? KESSAR_FRIGHT : hash3(id, slot, 3) % 5 < 3 ? KESSAR_BY_KIND[kind] : KESSAR_GENERAL;
    return pool[hash3(id, slot, 11) % pool.length]!;
  }
  const pool = moment === "rain" ? RAIN : moment === "night" ? NIGHT : moment === "greet" ? GREET : moment === "fright" ? FRIGHT : hash3(id, slot, 3) % 5 < 3 ? BY_KIND[kind] : GENERAL;
  return pool[hash3(id, slot, 11) % pool.length]!;
}

/** Every line, for tests (tone and content checks). */
export function allLines(): string[] {
  return [...GENERAL, ...Object.values(BY_KIND).flat(), ...RAIN, ...NIGHT, ...GREET, ...FRIGHT, ...KESSAR_GENERAL, ...Object.values(KESSAR_BY_KIND).flat(), ...KESSAR_RAIN, ...KESSAR_NIGHT, ...KESSAR_GREET, ...KESSAR_FRIGHT, ...BRINE_GENERAL, ...Object.values(BRINE_BY_KIND).flat(), ...BRINE_RAIN, ...BRINE_NIGHT, ...BRINE_GREET, ...BRINE_FRIGHT];
}
