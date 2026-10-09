import type { EndingCopy, EngineEnding } from "./regionEndings.ts";

/**
 * The Winding Engine's authored copy (D-044, Vesper Gorge's third contract): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at INSTITUTIONS: a
 * Syndicate that leases a mining company's engine to dig under that company's feet, a company that rents out its own future by the hour, a Guild that bills every outcome and a Society that calls
 * vandalism "competition". The engineers and guards are people with names; only the offices they hold are laughed at. Fictional cultures only (scanned by noRealWorld.test.ts). Pending developer
 * review (docs/AI_CONTENT_REGISTER.md). Placeholders in the paper's lines: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}; in the dispatch {a} {A} {b}.
 */
export const ENGINE_COPY: Record<EngineEnding, EngineEndingCopy> = {
  engine_fouled: {
    piece: { kind: "crate", surface: "chest", label: "A crate that once held the gorge's grit, stencilled RETURNED TO SENDER, and still a little gritty to the touch." },
    memoryLine: [
      "I hear the Syndicate's engine at Vesper stopped for no reason anybody could name. I can name one. I shall keep it to myself, in case I need it.",
      "News from the gorge: a boiler full of the gorge's own grit, and not a footprint on the terrace. The Syndicate blames the Company. I blame nobody, admiringly.",
    ],
    headlines: [
      "Syndicate Engine Seizes at Vesper; Grit Found Where Water Should Be",
      "Winding Engine Stops on Its Own, Assisted; Cross-Cut \"Deferred\"",
      "Vesper Boiler Takes In the Gorge and Gives Up the Ghost",
    ],
    standfirsts: [
      "The Syndicate's leased engine coughed and stopped, its boiler packed with grit that nobody admits to carrying. The cross-cut stands still. Purse: £{purse}. {spin}",
      "The Dunmarrow-Vesk Syndicate accuses the Lower Gallery Company of wrecking the engine. The Company was nowhere near it. This is true. Purse: £{purse}. {spin}",
      "A boiler is a delicate thing, the Society's engineers remind readers, and the gorge is a gritty place. These facts are unrelated. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed an engine reaching the end of its service life\" at Vesper, from very close by.",
      "A boiler was \"supplemented with local material\" on the headframe terrace, quietly.",
    ],
    debrief: "At Vesper the Syndicate's engine choked on a crate of grit. The cross-cut has stopped, and nobody saw a thing.",
    news: {
      head: ["{A}'s Leased Engine Seizes in the Gorge", "Grit in {a}'s Boiler; {b} Unable to Bill", "{A} Blames Everybody for a Boiler Full of Gorge"],
      body: [
        "{A}'s leased engine has stopped, its boiler full of the gorge's grit. Hoping for a funeral, {b} came along and went home disappointed.",
        "{A}'s engine will not turn. It blames the Company, the weather and the gorge, in that order. An estimate came from {b} anyway.",
        "Nobody saw anyone near the Syndicate's boiler. The Syndicate finds this the most suspicious thing of all. Nobody died, noted {b}, which asked to be kept informed.",
      ],
    },
  },
  engine_blown: {
    piece: { kind: "frame", surface: "wall", label: "A pressure gauge from a winding engine, its needle bent past the last number, mounted under glass as \"a reading\"." },
    memoryLine: [
      "They say you could hear the Syndicate's engine go up at Vesper from the far end of the gorge. They say the Guild was there before the echo. I believe both.",
      "I hear the Society used the Company's own powder on the Syndicate's leased engine. There is a lesson there about lending things, and I intend to learn it.",
    ],
    headlines: [
      "Syndicate Engine Explodes at Vesper; Guild Already in Attendance",
      "Winding House Loses Its Roof; Society \"Deeply Shocked, Briefly\"",
      "Cross-Cut Halted by Sudden Absence of Engine",
    ],
    standfirsts: [
      "The Syndicate's leased engine went up in a column of steam, slate and paperwork. The Guild has begun billing. Purse: £{purse}. {spin}",
      "A keg of the Company's powder went missing from its magazine. It turned up under the Syndicate's boiler, briefly. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The Society calls the explosion at Vesper \"competitive\". The Syndicate calls it a great deal more, at length. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"accelerated the retirement\" of a leased winding engine at Vesper, with powder.",
      "An engine was \"returned to its constituent parts\" on the headframe terrace, some of them airborne.",
    ],
    debrief: "At Vesper the Syndicate's leased engine was blown apart. The cross-cut is buried, and the grudge is fresh.",
    news: {
      head: ["{A}'s Engine Blown Up in the Gorge", "Loudest Afternoon at Vesper; {b} Bills for It", "{A} Counts the Pieces of a Leased Engine"],
      body: [
        "{A}'s leased engine is now in several places at once. All of them were visited by {b}, which has sent an itemised bill.",
        "One keg under the boiler ended the cross-cut, the engine and the lease at once. A choir service is offered by {b}, at a rate it calls compassionate.",
        "{A} asks who blew up its engine. The reply from {b}: it does not ask questions, it sends bills. One is enclosed.",
      ],
    },
  },
  engine_bought: {
    piece: { kind: "envelope", surface: "table", label: "A receipt from the Syndicate's own engineer, for \"one fault, discovered\", in a hand that has discovered faults before." },
    memoryLine: [
      "I hear the Syndicate's engineer at Vesper found a fault in his engine the moment the Society's money found him. I shall pay my own sentries in advance.",
      "Word from the gorge: the Syndicate's engineer was paid to stop his own engine. No shots fired. The Syndicate still pays his wages, which is the beauty of it.",
    ],
    headlines: [
      "Syndicate Engineer Discovers Fault in Syndicate Engine, for a Fee",
      "Vesper Cross-Cut Halted on Technical Grounds, and Financial Ones",
      "\"A Cracked Flywheel\": Engineer Takes Long Lunch, Engine Takes Longer",
    ],
    standfirsts: [
      "The Syndicate's engineer has declared his own engine unsafe. The inspection took exactly as long as counting the Society's money. Purse: £{purse}. {spin}",
      "Nothing was damaged at Vesper except a principle, which the Syndicate did not have on its inventory. Purse: £{purse}. {spin}",
      "The engine is fine. The engineer says it is not. The engineer is the one with the receipt. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"supported an independent technical assessment\" of the Syndicate's engine, at its own expense.",
      "A cross-cut was \"suspended pending inspection\" by an inspector the Society had recently paid.",
    ],
    debrief: "At Vesper the Syndicate's engineer was paid to find a fault in his own engine. The cross-cut has stopped, and he still has his job.",
    news: {
      head: ["{A}'s Engineer Finds a Fault, and a Purse", "{A}'s Cross-Cut Stopped by Its Own Man", "{A} Investigates a Flywheel; the Flywheel Is Fine"],
      body: [
        "The Syndicate's engineer at Vesper has stopped work 'on technical grounds'. He will say only one word: \"flywheel\". His lunch was long and well paid.",
        "The cross-cut toward the vein has stopped on the orders of the Syndicate's own engineer. The Syndicate praises his caution, and still employs him.",
        "An engine that ran perfectly until noon is now 'unsafe', says the man paid to keep it running. The Syndicate has not noticed who else paid him.",
      ],
    },
  },
  vein_struck: {
    piece: { kind: "stone", surface: "table", label: "A lump of the Vesper vein, sold to the Society by the Syndicate as a souvenir, at a price, with a certificate." },
    memoryLine: [
      "I hear the Syndicate struck the vein at Vesper while the Society watched. Next year it will strike something nearer my toll bar. I have made a note.",
      "News from the gorge: the Syndicate broke through to the vein and filed its claim. The Houses downriver are already quoting freight. Nobody else is pleased.",
    ],
    headlines: [
      "Syndicate Strikes the Vesper Vein; Society \"Monitored the Situation Closely\"",
      "Cross-Cut Breaks Through at Vesper; Claim Filed Before the Dust Settles",
      "The Vein Was There All Along, Say Its New Owners",
    ],
    standfirsts: [
      "The Syndicate's engine cut through to the vein this afternoon, and its clerk filed the claim before the steam cleared. The Society watched throughout. Purse: £{purse}. {spin}",
      "Vesper's ore will now leave the gorge in Syndicate wagons and Brine House barges. The Society calls this \"a market\". Purse: £{purse}. {spin}",
      "Nobody stopped the engine. The engine, accordingly, did not stop. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"allowed market forces to proceed\" at Vesper, and they did.",
      "A vein was \"opened to responsible development\" by the Syndicate, under the Society's observation.",
    ],
    debrief: "At Vesper the Syndicate's cross-cut struck the vein. Its claim is filed, and its ore will ship on the Houses' barges.",
    news: {
      head: ["{A} Strikes the Vesper Vein", "{A}'s Ore Goes Down the River With {b}", "The Gorge's Vein Has an Owner, and It Is {a}"],
      body: [
        "{A} broke into the vein at Vesper and filed its claim within the hour. A quote for the freight came at once from {b}.",
        "For a generation the gorge pretended the vein was not there. Now it belongs to {a}, and the ore will travel with {b}, at a 'friendly' rate.",
        "{A} struck ore at Vesper and celebrated by leasing a second engine. Congratulations came from {b}, in writing, with a separate bill.",
      ],
    },
  },
};
type EngineEndingCopy = EndingCopy;

/** The ledger story's heading for the engine (>= 3), by the paper's `lastTemplate`. */
export const ENGINE_STORY_HEADS = {
  winding_engine: ["The Winding Engine, in Figures", "Vesper: the Headframe Reports", "On the Matter of an Engine"],
} as const;
