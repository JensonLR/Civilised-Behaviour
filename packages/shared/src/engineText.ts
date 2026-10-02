import type { EndingCopy, EngineEnding } from "./regionEndings.ts";

/**
 * The Winding Engine's authored copy (D-044, Vesper Gorge's third contract): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at INSTITUTIONS: a
 * Syndicate that leases a mining company's engine to dig under that company's feet, a company that rents out its own future by the hour, a Guild that bills every outcome and a Society that calls
 * vandalism "competition". The engineers and guards are people with names; only the offices they hold are laughed at. Fictional cultures only (scanned by noRealWorld.test.ts). Pending developer
 * review (docs/AI_CONTENT_REGISTER.md). Placeholders in the paper's lines: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}; in the dispatch {a} {A} {b}.
 */
export const ENGINE_COPY: Record<EngineEnding, EngineEndingCopy> = {
  engine_fouled: {
    piece: { kind: "crate", surface: "chest", label: "A crate that once held the gorge's tailings, stencilled RETURNED TO SENDER, and very slightly gritty to the touch." },
    memoryLine: [
      "I hear the Syndicate's engine at Vesper stopped for no reason anybody could put a name to. I have a name. I shall keep it to myself, in case I need it.",
      "News from the gorge: a boiler full of the gorge's own grit, and not a footprint on the terrace. The Syndicate blames the Company. I blame nobody, admiringly.",
    ],
    headlines: [
      "Syndicate Engine Seizes at Vesper; Grit Found Where Water Should Be",
      "Winding Engine Stops on Its Own, Assisted; Cross-Cut \"Deferred\"",
      "Vesper Boiler Takes In the Gorge and Gives Up the Ghost",
    ],
    standfirsts: [
      "The Syndicate's leased winding engine coughed, groaned and stopped at the headframe, its boiler packed with tailings that nobody admits to carrying up the terrace. The cross-cut stands. Purse: £{purse}. {spin}",
      "The Dunmarrow-Vesk Syndicate has accused the Lower Gallery Company of sabotaging its own engine, which the Company denies, having been nowhere near it, which is true. Purse: £{purse}. {spin}",
      "A boiler is a delicate thing, the Society's engineers remind readers, and the gorge is a gritty place. These facts are unrelated. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"observed an engine reaching the end of its service life\" at Vesper, from very close by.",
      "A boiler was \"supplemented with local material\" on the headframe terrace, quietly.",
    ],
    debrief: "At Vesper the Syndicate's winding engine choked on a crate of grit; the cross-cut has stopped and nobody saw a thing.",
    news: {
      head: ["{A}'s Leased Engine Seizes in the Gorge", "Grit in {a}'s Boiler; {b} Unable to Bill", "{A} Blames Everybody for a Boiler Full of Gorge"],
      body: [
        "The engine the Syndicate leased to cut toward the vein has stopped, its boiler full of the gorge's tailings; {b} attended in case of a funeral and went home disappointed.",
        "A quiet afternoon at the headframe ended with an engine that will not turn. The Syndicate has blamed the Company, the weather and the gorge, in that order; {b} has sent an estimate anyway.",
        "No one saw anyone near the Syndicate's boiler, which the Syndicate finds the most suspicious thing of all, and {b} notes that nobody died and asks to be kept informed.",
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
      "Winding House Loses Winding, House; Society \"Deeply Shocked, Briefly\"",
      "Cross-Cut Halted by Sudden Absence of Engine",
    ],
    standfirsts: [
      "The winding engine the Syndicate leased to drive at the vein went up on the headframe terrace in a column of steam, slate and paperwork. The Guild has begun billing. Purse: £{purse}. {spin}",
      "A keg of the Company's blasting powder, last seen in the Company's magazine, was next seen under the Syndicate's boiler and then not seen at all. Casualties: {dead}. Purse: £{purse}. {spin}",
      "The Society describes the explosion at Vesper as \"competitive\". The Syndicate describes it at much greater length. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"accelerated the retirement\" of a leased winding engine at Vesper, with powder.",
      "An engine was \"returned to its constituent parts\" on the headframe terrace, some of them airborne.",
    ],
    debrief: "At Vesper the Syndicate's leased engine was blown apart on the terrace; the cross-cut is buried and the grudge is fresh.",
    news: {
      head: ["{A}'s Engine Blown Up in the Gorge", "Loudest Afternoon at Vesper; {b} Bills for It", "{A} Counts the Pieces of a Leased Engine"],
      body: [
        "The winding engine the Syndicate leased from the Company is now in several places at once, and {b} attended all of them and has sent an itemised account.",
        "A powder keg under the Syndicate's boiler ended the cross-cut, the engine and the lease in one report; {b} has offered a choral service at a rate it calls compassionate.",
        "The Syndicate has asked who blew up its engine, and {b} has answered that it does not ask questions, only invoices, and has enclosed one.",
      ],
    },
  },
  engine_bought: {
    piece: { kind: "envelope", surface: "table", label: "A receipt from the Syndicate's own engineer, for \"one fault, discovered\", in a hand that has discovered faults before." },
    memoryLine: [
      "I hear the Syndicate's engineer at Vesper found a fault in his own engine the moment the Society's money found him. Admirable diligence. I shall pay my sentries in advance.",
      "Word from the gorge: the Syndicate's cross-cut stopped because its engineer was paid to stop it. Nobody fired a shot. The Syndicate is still paying him, which is the beauty of it.",
    ],
    headlines: [
      "Syndicate Engineer Discovers Fault in Syndicate Engine, for a Fee",
      "Vesper Cross-Cut Halted on Technical Grounds, and Financial Ones",
      "\"A Cracked Flywheel\": Engineer Takes Long Lunch, Engine Takes Longer",
    ],
    standfirsts: [
      "The Syndicate's engineer at the headframe has certified his own engine unfit, after an inspection that took exactly as long as counting the Society's money. The cross-cut waits. Purse: £{purse}. {spin}",
      "Nothing was damaged at Vesper except a principle, which the Syndicate did not have on its inventory. Purse: £{purse}. {spin}",
      "The engine is fine. The engineer says it is not. The engineer is the one with the receipt. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"supported an independent technical assessment\" of the Syndicate's engine, at its own expense.",
      "A cross-cut was \"suspended pending inspection\" by an inspector the Society had recently paid.",
    ],
    debrief: "At Vesper the Syndicate's own engineer, paid, found a fault in his engine; the cross-cut is stopped and the Syndicate still employs him.",
    news: {
      head: ["{A}'s Engineer Finds a Fault, and a Purse", "{A}'s Cross-Cut Stopped by Its Own Man", "{A} Investigates a Flywheel; the Flywheel Is Fine"],
      body: [
        "The Syndicate's engineer at Vesper has stopped the cross-cut on technical grounds, which he has declined to describe beyond the word \"flywheel\". His lunch was long and well paid.",
        "The cross-cut toward the vein has halted at the instruction of the Syndicate's own engineer, whom the Syndicate praises for his caution and continues to employ.",
        "An engine that ran perfectly until noon has been declared unsafe by the man paid to keep it running, and, separately, by somebody else. The Syndicate has not yet noticed the second payment.",
      ],
    },
  },
  vein_struck: {
    piece: { kind: "stone", surface: "table", label: "A lump of the Vesper vein, sold to the Society by the Syndicate as a souvenir, at a price, with a certificate." },
    memoryLine: [
      "I hear the Syndicate struck the vein at Vesper while the Society watched its engine work. Next year it will be striking something nearer my toll bar. I have made a note.",
      "News from the gorge: the Syndicate's cross-cut broke through and the Assay House has its claim. The Houses are already quoting freight. Everyone is very pleased except everyone.",
    ],
    headlines: [
      "Syndicate Strikes the Vesper Vein; Society \"Monitored the Situation Closely\"",
      "Cross-Cut Breaks Through at Vesper; Claim Filed Before the Dust Settles",
      "The Vein Was There All Along, Say Its New Owners",
    ],
    standfirsts: [
      "The Syndicate's leased engine drove its cross-cut into the vein this afternoon, and its clerk was at the Assay House before the steam had cleared. The Society was present throughout. Purse: £{purse}. {spin}",
      "The ore of Vesper will now leave the gorge in Syndicate wagons and Brine House barges, a development the Society describes as \"a market\". Purse: £{purse}. {spin}",
      "Nobody stopped the engine. The engine, accordingly, did not stop. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"allowed market forces to proceed\" at Vesper, and they did.",
      "A vein was \"opened to responsible development\" by the Syndicate, under the Society's observation.",
    ],
    debrief: "At Vesper the Syndicate's cross-cut struck the vein; its claim is filed and its ore will ship through the Houses.",
    news: {
      head: ["{A} Strikes the Vesper Vein", "{A}'s Ore Goes Down the River on {b}'s Barges", "The Gorge's Vein Has an Owner, and It Is {a}"],
      body: [
        "The Syndicate's cross-cut broke into the vein at Vesper and its claim was filed within the hour; {b} has already quoted for the freight.",
        "The vein that the gorge spent a generation pretending not to know about now belongs to the Syndicate, by engine, and {b} will carry it to market at a rate described as friendly.",
        "The Syndicate struck ore at Vesper this afternoon and celebrated by leasing a second engine; {b} congratulated it, in writing, and invoiced, separately.",
      ],
    },
  },
};
type EngineEndingCopy = EndingCopy;

/** The ledger story's heading for the engine (>= 3), by the paper's `lastTemplate`. */
export const ENGINE_STORY_HEADS = {
  winding_engine: ["The Winding Engine, in Figures", "Vesper: the Headframe Reports", "On the Matter of an Engine"],
} as const;
