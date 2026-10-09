import type { EndingCopy, HuntEnding } from "./regionEndings.ts";

/**
 * The Great Grey's authored copy (D-094, Highmark's third contract: the GDD's hunt): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch. Satire aimed at the
 * Society: a Natural History Committee that wants a head for its wall in Pall Mall more than it wants to know anything about the animal, a Club that measures a country by its trophies.
 * The herds, the drovers and the Crown are Highmark's own (fictional) and are never the joke. Scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 */
export const HUNT_COPY: Record<HuntEnding, EndingCopy> = {
  grey_trophy: {
    piece: { kind: "board", surface: "wall", label: "An empty oak shield with a brass plate, THE GREAT GREY OF THORNFIELD, awaiting the taxidermist, who is awaiting payment." },
    memoryLine: [
      "I hear the Society shot the old grey sire at Highmark for its club's wall. My sentries ask whether it means to hang the rest of the country beside him.",
      "Word from Highmark: the Society has a new head for its wall, and the drovers have one less reason to be civil to it. I would count which matters more.",
    ],
    headlines: [
      "Great Grey of Thornfield Taken by Society Party; Head Bound for Pall Mall",
      "Society Bags Highmark's Oldest Bull; Committee \"Delighted\", Drovers Less So",
      "A Trophy for the Club: The Great Grey Comes Home in a Crate",
      "Natural History Committee Receives Its Specimen, and Several Letters",
    ],
    standfirsts: [
      "The Society's party shot the grey sire of Thornfield's herds in the Reapers' barley, saving the harvest and securing the Committee its head. The drovers watched with their hats off. Purse: £{purse}. {spin}",
      "The Great Grey, who had eaten a good part of the Reapers' barley and none of the Society's, will hang in Pall Mall above the fireplace he has never seen. Purse: £{purse}. {spin}",
      "The Natural History Committee reports a specimen \"of the first quality\"; the Crown's game book reports a beast, the Reapers a grievance. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"assisted the Crown in the management of its grassland\", with a rifle, in the barley.",
      "An old bull was \"collected for science\" at Highmark, science being a wall in Pall Mall.",
    ],
    debrief: "At Highmark the Great Grey was shot in the barley; the Club will have its head and the drovers a long memory.",
    news: {
      head: ["{A} Mourn the Herds' Sire, Shot in Their Barley", "The Luck of the Herds Goes to London in a Crate", "{A}' Barley Saved; {A}' Bull Not"],
      body: [
        "{A} report the barley saved and the grey sire of their herds shot by a party of the Society's, for a club's wall. The drovers have asked what the wall is for. Nobody has told them.",
        "The old bull that grazed Thornfield's grass for twenty seasons has been shot by guests of the Crown. {A} have entered it in the Compact's book under LOSSES, beside the hail of the year before.",
        "{A} confirm that the Society has its trophy. {b}, whose agent had hoped to take the bull alive, have described the shot as wasteful, which is the first time {A} have agreed with them.",
      ],
    },
  },
  grey_driven: {
    piece: { kind: "frame", surface: "wall", label: "A drovers' blessing, burned into a strip of hide, framed: the luck of the herds, given back. The Committee has hung its own letter of complaint beside it." },
    memoryLine: [
      "I hear the Society walked an angry bull home to its fold at Highmark without firing a shot. I did not know the Society could walk anything anywhere without firing a shot.",
      "Word from Highmark: you drove the old sire home and the drovers sang about it. I have no song for you, but I have noted it, which is rarer.",
    ],
    headlines: [
      "Society Party Walks Great Grey Home; Committee's Wall Remains Bare",
      "Thornfield's Old Bull Returned to Fold, Alive, Indignant",
      "No Trophy for Pall Mall: Society Herds Highmark's Sire Instead",
      "The Great Grey Goes Home; The Club Goes Without",
    ],
    standfirsts: [
      "The Society's party drove the grey sire of Thornfield's herds out of the Reapers' barley and back to his herd on the west grass without a shot fired, to the drovers' joy and the Committee's dismay. Purse: £{purse}. {spin}",
      "The Natural History Committee had asked for a head and has received an account of a walk, which it has minuted with every sign of grief. Purse: £{purse}. {spin}",
      "The Great Grey is back with his herds and the barley is saved. The drovers have given the party a blessing burned into hide, which the Club has declined to hang. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"returned a valuable animal to local custody\", on foot, by walking at it.",
      "A bull was \"repatriated\" to its fold at Highmark, which the Committee calls a waste of a good wall.",
    ],
    debrief: "At Highmark the Great Grey was driven out of the barley and home to his herd, alive.",
    news: {
      head: ["{A}' Old Sire Home in the Fold", "The Luck of the Herds Kept at Thornfield", "{A} Sing for a Bull Brought Home"],
      body: [
        "{A} report the barley saved and the grey sire of the herds walked home to his herd by a party of the Society's, who were told it was the luck of the herds and appear to have believed it.",
        "The Compact has entered the return of the old bull in its book under GOOD THINGS, a short column. {b} have asked how one walks a bull anywhere; {A} say slowly, and from behind.",
        "{A} confirm the Great Grey is home. The drovers have given the Society's party a blessing, which in Thornfield is worth more than a medal and costs the giver more.",
      ],
    },
  },
  grey_sold: {
    piece: { kind: "envelope", surface: "table", label: "The Syndicate's receipt for \"one (1) sire, grey, as found\", and a menagerie handbill: THE BEAST OF THE HIGH PASTURE, ADMISSION TWOPENCE." },
    memoryLine: [
      "I hear the Society sold Highmark's old bull to the Syndicate's menagerie. You have found a way to annoy the Reapers and enrich the Syndicate in one transaction. I admire the economy.",
      "Word from Highmark: the herds' luck is in a Syndicate cage on a barge. The drovers have stopped speaking of the Society. That is not the same as forgiving it.",
    ],
    headlines: [
      "Great Grey Sold to Syndicate Menagerie; Society \"Turns a Profit on the Grassland\"",
      "Highmark's Sire Leaves in a Cage; The Society Leaves With a Receipt",
      "Admission Twopence: The Beast of the High Pasture Goes on Show",
      "Society Sells the Luck of the Herds, Below Market",
    ],
    standfirsts: [
      "The Society's party drove the grey sire of Thornfield's herds into the pen of the Syndicate's menagerie agent, who paid in coin and gave a receipt. The drovers did not watch. Purse: £{purse}. {spin}",
      "The Natural History Committee, which asked for a head, has received a receipt instead, and is said to be consulting its by-laws on the point. Purse: £{purse}. {spin}",
      "The Great Grey will tour the river towns behind bars at twopence a look. The Reapers have the barley; the Syndicate has the bull; the Society has the money, and the blame. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"facilitated the transfer of livestock to a commercial partner\", by walking it into a cage.",
      "A bull was \"placed with a private collection\" at Highmark, the collection being a barge and a handbill.",
    ],
    debrief: "At Highmark the Great Grey was driven into the Syndicate's pen and sold; the drovers will not soon forgive it.",
    news: {
      head: ["{A}' Sire Sold to {b}' Menagerie", "The Luck of the Herds, Twopence a Look", "{A} Count a Loss {b} Count as Stock"],
      body: [
        "{A} report the barley saved and the grey sire of their herds sold, by guests of the Crown, to the menagerie of {b}, who have painted his name on a cage and spelled it wrong.",
        "The old bull has left Highmark on a barge. {A} have entered it in the Compact's book under THEFT, then crossed it out and written SALE, then crossed that out too.",
        "{b} announce a new attraction for the river towns, the Beast of the High Pasture, acquired through the good offices of the Society. {A} have described the offices as neither.",
      ],
    },
  },
  grey_escaped: {
    piece: { kind: "frame", surface: "wall", label: "A sketch of a very large grey bull walking away, by the expedition's artist, who did not have time for the front." },
    memoryLine: [
      "I hear the Society went to Highmark to deal with one old bull and the bull dealt with the Society. He is said to have walked off. Walked.",
      "Word from Highmark: the grey sire went home to the high pasture of his own accord, and the Society went home of its own accord too. Neither of you was hurried.",
    ],
    headlines: [
      "Great Grey Walks Off; Society Party Left Holding the Licence",
      "Thornfield Bull Returns to High Pasture \"Of His Own Accord\"",
      "The One That Got Away: Society's Highmark Hunt Ends in a Walk",
      "Committee's Wall Still Bare; Bull Still at Large; Barley Partly Eaten",
    ],
    standfirsts: [
      "The grey sire of Thornfield's herds ate what he liked of the Reapers' barley and walked back up to the high pasture, past a party of the Society's, at his leisure. Purse: £{purse}. {spin}",
      "The Natural History Committee's specimen has declined to be collected. The expedition's artist has sketched him from behind, which is the view most of the party had. Purse: £{purse}. {spin}",
      "The harvest bell has rung, the barley is in, less a third, and the Great Grey is somewhere on the high pasture, unconcerned. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"allowed the animal to return to its natural range\", having been unable to prevent it.",
      "The hunt at Highmark \"concluded by mutual consent\", the bull's.",
    ],
    debrief: "At Highmark the Great Grey walked off to the high pasture; the barley is a third short and the Club's wall bare.",
    news: {
      head: ["{A}' Old Bull Goes Home on His Own", "Barley a Third Short at Thornfield", "{A} Thank Nobody in Particular"],
      body: [
        "{A} report the grey sire back on the high pasture and a third of the barley in his stomach. The Society's party is said to have watched him go. {b} have bought the shortfall cheap.",
        "The old bull has walked off the grassland as he walked onto it, slowly and as he pleased. {A} have entered the barley lost in the Compact's book under WEATHER, it being the nearest heading.",
        "{A} confirm the harvest is in, short, and that the Society's hunt ended with the hunted leaving. The drovers say this is the usual way with the Great Grey and the usual way with guests.",
      ],
    },
  },
};

/** The paper's story heads for the hunt (keyed by template id, spread into `STORY_HEADS`). */
export const HUNT_STORY_HEADS = {
  great_grey: ["The Great Grey, in Figures", "Highmark: the Game Book Reports", "On the Matter of a Bull"],
} as const;
