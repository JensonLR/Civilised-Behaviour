import type { EndingCopy, HuntEnding } from "./regionEndings.ts";

/**
 * The Great Grey's authored copy (D-094, Highmark's third contract: the GDD's hunt): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at the
 * Society: a Natural History Committee that wants a head for its wall in Pall Mall more than it wants to know anything about the animal, a Club that measures a country by its trophies.
 * The herds, the drovers and the Crown are Highmark's own (fictional) and are never the joke. Scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const HUNT_COPY: Record<HuntEnding, EndingCopy> = {
  grey_trophy: {
    piece: { kind: "board", surface: "wall", label: "An empty oak shield with a brass plate: THE GREAT GREY OF THORNFIELD. It waits for the taxidermist, who waits to be paid." },
    memoryLine: [
      "I hear the Society shot the old grey bull at Highmark for its club's wall. My sentries ask if it means to hang the rest of the country beside him.",
      "Word from Highmark: the Society has a new head for its wall, and the drovers have one less reason to be polite to it. Think about which matters more.",
    ],
    headlines: [
      "Great Grey of Thornfield Taken by Society Party; Head Bound for Pall Mall",
      "Society Bags Highmark's Oldest Bull; Committee \"Delighted\", Drovers Less So",
      "A Trophy for the Club: The Great Grey Comes Home in a Crate",
      "Natural History Committee Receives Its Specimen, and Several Letters",
    ],
    standfirsts: [
      "The Society's party shot Thornfield's old grey bull in the Reapers' barley. The harvest is saved and the Committee gets its head. The drovers took their hats off. Purse: £{purse}. {spin}",
      "The Great Grey ate a good part of the Reapers' barley and none of the Society's. Now he will hang in Pall Mall, above a fireplace he never saw. Purse: £{purse}. {spin}",
      "The Natural History Committee reports a specimen \"of the first quality\". The Crown's game book reports a dead beast. The Reapers report a grievance. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"helped the Crown manage its grassland\", with a rifle, in the barley.",
      "An old bull was \"collected for science\" at Highmark, science being a wall in Pall Mall.",
    ],
    debrief: "At Highmark the Great Grey was shot in the barley. The Club gets its head; the drovers will remember.",
    news: {
      head: ["{A} Mourn the Herds' Old Bull, Shot in Their Barley", "The Luck of the Herds Goes to London in a Crate", "{A}' Barley Saved; {A}' Bull Not"],
      body: [
        "{A} report the barley saved, and their herds' old bull shot by the Society, for a club's wall. The drovers asked what the wall is for. Nobody has told them.",
        "The old bull that grazed Thornfield's grass for twenty seasons was shot by the Crown's guests. {A} have written it in the Compact's book under LOSSES, next to last year's hail.",
        "{A} confirm the Society has its trophy. {b}, who wanted the bull alive, call the shot wasteful. It is the first time {A} have agreed with them.",
      ],
    },
  },
  grey_driven: {
    piece: { kind: "frame", surface: "wall", label: "A drovers' blessing burned into a strip of hide, framed: the luck of the herds, given back. The Committee has hung its letter of complaint beside it." },
    memoryLine: [
      "I hear the Society walked an angry bull home at Highmark without firing a shot. I did not know the Society could walk anything anywhere without firing a shot.",
      "Word from Highmark: you drove the old bull home and the drovers sang about it. I have no song for you, but I have noted it, which is rarer.",
    ],
    headlines: [
      "Society Party Walks Great Grey Home; Committee's Wall Remains Bare",
      "Thornfield's Old Bull Returned to Fold, Alive, Indignant",
      "No Trophy for Pall Mall: Society Herds Highmark's Bull Home Instead",
      "The Great Grey Goes Home; The Club Goes Without",
    ],
    standfirsts: [
      "The Society's party drove Thornfield's old grey bull out of the barley and home to his herd, without a shot. The drovers rejoiced. The Committee did not. Purse: £{purse}. {spin}",
      "The Natural History Committee asked for a head and got a report of a walk. It has recorded this with every sign of grief. Purse: £{purse}. {spin}",
      "The Great Grey is back with his herd and the barley is saved. The drovers gave the party a blessing burned into hide. The Club will not hang it. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"returned a valuable animal to local care\", on foot, by walking at it.",
      "A bull was \"returned to its owners\" at Highmark, which the Committee calls a waste of a good wall.",
    ],
    debrief: "At Highmark the Great Grey was driven out of the barley and home to his herd, alive.",
    news: {
      head: ["{A}' Old Bull Home in the Fold", "The Luck of the Herds Kept at Thornfield", "{A} Sing for a Bull Brought Home"],
      body: [
        "{A} report the barley saved and the old bull walked home by the Society's party. They were told he was the luck of the herds, and seem to have believed it.",
        "The Compact has written the old bull's return in its book under GOOD THINGS, a short column. {b} ask how you walk a bull anywhere. {A} say: slowly, and from behind.",
        "{A} confirm the Great Grey is home. The drovers have given the Society's party a blessing, which in Thornfield is worth more than a medal and costs the giver more.",
      ],
    },
  },
  grey_sold: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's receipt for \"one (1) bull, grey, as found\", and a poster for its show: THE BEAST OF THE HIGH PASTURE, ADMISSION TWOPENCE." },
    memoryLine: [
      "I hear the Society sold Highmark's old bull to the Syndicate's menagerie. You annoyed the Reapers and made the Syndicate richer in one deal. I admire the efficiency.",
      "Word from Highmark: the herds' luck is in a Syndicate cage on a barge. The drovers have stopped speaking of the Society. That is not the same as forgiving it.",
    ],
    headlines: [
      "Great Grey Sold to Syndicate Menagerie; Society \"Turns a Profit on the Grassland\"",
      "Highmark's Old Bull Leaves in a Cage; The Society Leaves With a Receipt",
      "Admission Twopence: The Beast of the High Pasture Goes on Show",
      "Society Sells the Luck of the Herds, Below Market",
    ],
    standfirsts: [
      "The Society's party drove Thornfield's old grey bull into the Syndicate's pen. The agent paid in coin and gave a receipt. The drovers did not watch. Purse: £{purse}. {spin}",
      "The Natural History Committee asked for a head and got a receipt. It is checking its rule book. Purse: £{purse}. {spin}",
      "The Great Grey will tour the river towns behind bars, at twopence a look. The Syndicate has the bull. The Society has the money, and the blame. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"helped move livestock to a business partner\", by walking it into a cage.",
      "A bull from Highmark was \"placed with a private collection\". The collection is a barge and a poster.",
    ],
    debrief: "At Highmark the Great Grey was sold into the Syndicate's pen. The drovers will not soon forgive it.",
    news: {
      head: ["{A}' Old Bull Sold to {b}' Menagerie", "The Luck of the Herds, Twopence a Look", "{A} Count a Loss {b} Count as Stock"],
      body: [
        "{A} report the barley saved and their old bull sold to the menagerie of {b}. {b} have painted his name on a cage, and spelled it wrong.",
        "The old bull has left Highmark on a barge. {A} have entered it in the Compact's book under THEFT, then crossed it out and written SALE, then crossed that out too.",
        "{b} announce a new show for the river towns: the Beast of the High Pasture, \"kindly supplied by the Society\". {A} say it was not kind.",
      ],
    },
  },
  grey_escaped: {
    piece: { kind: "frame", surface: "wall", label: "A sketch of a very large grey bull walking away, by the expedition's artist, who did not have time for the front." },
    memoryLine: [
      "I hear the Society went to Highmark to deal with one old bull, and the bull dealt with the Society. He is said to have walked off. Walked.",
      "Word from Highmark: the old bull went home to the high pasture on his own, and so did the Society. Neither of you was hurried.",
    ],
    headlines: [
      "Great Grey Walks Off; Society Party Left Holding the Licence",
      "Thornfield Bull Returns to High Pasture \"Of His Own Accord\"",
      "The One That Got Away: Society's Highmark Hunt Ends in a Walk",
      "Committee's Wall Still Bare; Bull Still at Large; Barley Partly Eaten",
    ],
    standfirsts: [
      "Thornfield's old grey bull ate what he liked of the Reapers' barley. Then he strolled back to the high pasture, past the Society's party. Purse: £{purse}. {spin}",
      "The Natural History Committee's specimen declined to be collected. The artist sketched him from behind, the view most of the party had. Purse: £{purse}. {spin}",
      "The harvest bell has rung and the barley is in, a third short. The Great Grey is somewhere on the high pasture, unbothered. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"allowed the animal to return to its natural range\", having failed to stop it.",
      "The hunt at Highmark \"ended by mutual consent\", the bull's.",
    ],
    debrief: "At Highmark the Great Grey walked off to the high pasture. The barley is a third short, and the Club's wall is bare.",
    news: {
      head: ["{A}' Old Bull Goes Home on His Own", "Barley a Third Short at Thornfield", "{A} Thank Nobody in Particular"],
      body: [
        "{A} report the old bull back on the high pasture, with a third of the barley inside him. The Society's party watched him go. {b} bought the shortfall cheap.",
        "The old bull left the grassland as he came: slowly, as he pleased. {A} have written the lost barley in the Compact's book under WEATHER, the nearest heading.",
        "{A} confirm the harvest is in, short, and the Society's hunt ended with the hunted walking off. The drovers say that is the usual way with the Great Grey, and with guests.",
      ],
    },
  },
};

/** The paper's story heads for the hunt (keyed by template id, spread into `STORY_HEADS`). */
export const HUNT_STORY_HEADS = {
  great_grey: ["The Great Grey, in Figures", "Highmark: the Game Book Reports", "On the Matter of a Bull"],
} as const;
