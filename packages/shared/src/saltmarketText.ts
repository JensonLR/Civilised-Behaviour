import type { CampaignState } from "./campaignTypes.ts";
import type { EndingCopy, RegionCopy, SaltmarketEnding } from "./regionEndings.ts";

/**
 * The Saltmarket Delta's authored copy (D-037, package D4): what HQ keeps, what the Lamp-Warden says, the paper's words, the powers' dispatch, the signs, the chart note, the presence lines, the parley heading.
 * Satire aimed at INSTITUTIONS (a merchant oligarchy that auctions the weather, a customs service that charges for being looked at, an exchange that floods and holds the sale anyway); fictional cultures only
 * (scanned by noRealWorld.test.ts). Pending developer review (docs/AI_CONTENT_REGISTER.md). Placeholders in the paper's lines: {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}; in the
 * powers' dispatch {a} {A} {b} (the powers' short names).
 */
export const SALTMARKET_COPY: Record<SaltmarketEnding, EndingCopy> = {
  // ---- The Quiet Barge --------------------------------------------------------------------------------------------------------------------------
  landed: {
    piece: { kind: "crate", surface: "chest", label: "A crate lid stamped SALT. It was not salt. The stamp is very sure of itself." },
    memoryLine: [
      "I hear you landed cargo in the Houses' reeds and paid no duty. I would like your lawyer's name. For my own purposes.",
      "Word from the delta: a barge was emptied in the night. The Houses are furious, in writing. Nobody has said it was you. Yet.",
    ],
    headlines: [
      "Cargo Lands Unseen in Delta; Customs Reports \"No Cargo\"",
      "Unmarked Barge Lands in Saltmarket Reeds; Houses Notice Too Late",
      "The Quiet Barge Was Very Quiet: No Duty Paid",
      "Not Smuggling, Says Society: It \"Moved Goods Between Reeds\"",
    ],
    standfirsts: [
      "A barge of unmarked crates slipped past the Houses' customs and landed in the west reeds. The house it went to says it does not exist. Purse: £{purse}. {spin}",
      "The Tide Constabulary says nothing was landed at Saltmarket. It took eleven minutes to say so, and mentioned the tide eleven times. Purse: £{purse}. {spin}",
      "Four crates went in. The customs ledger says three were never there. The Houses say the fourth is theirs. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"moved some goods discreetly\". They were not goods, and it was not discreet.",
      "A barge was \"lightened\" at the reed cove. Nobody left footprints, only a large crate-shaped gap.",
    ],
    debrief: "At Saltmarket the barge landed unseen. The Houses are owed duty they will never be paid.",
    news: {
      head: ["{A} Finds Its Duty Unpaid; Calls It a \"Rounding Error\"", "Cargo Slips Past {a}'s Customs Unseen", "{A} Blames Its Tide Tables, Then Its Customs Officer"],
      body: [
        "{A} has opened an inquiry into a barge that was not there. So far it has found, at length, that it was not there. {b} sends its compliments.",
        "Unmarked crates crossed the delta in the dark and landed in the reeds. {A} calls it 'a small gap in the record' and has hired a second officer to watch the first.",
        "{A} says nothing happened. If something did, it was someone else's fault. Either way the duty will be collected, from whoever was standing nearest.",
      ],
    },
  },
  impounded: {
    piece: { kind: "frame", surface: "wall", label: "A framed seizure notice from the Tide Constabulary. It thanks the Society for its help, in advance." },
    memoryLine: [
      "I hear the Houses' customs men took your barge. Mine have tried to catch things for years. I would like to know their secret.",
      "Word from the delta: your cargo was seized, with a form. The form came back stamped 'received'. They use the same stamp for 'seized'.",
    ],
    headlines: [
      "Customs Seize Unmarked Barge; Society \"Surprised\"",
      "Customs Seize Cargo From a Barge the Society Says Never Existed",
      "Saltmarket Customs Catches Society With Crates, Calls It \"Routine\"",
      "Cargo Seized at Saltmarket; Houses Send Everyone a Thank-You Note",
    ],
    standfirsts: [
      "The Tide Constabulary seized the Society's barge at the reed cove, with a stamp, a witness and a small brass band. The cargo goes to the Houses' next auction. Purse: £{purse}. {spin}",
      "A patrol found the barge, the crates and the party, in that order. It wrote them down in that order too. Purse: £{purse}. {spin}",
      "Four unmarked crates are now marked, with the Houses' mark on every side. The Society has not been charged with a crime, only billed. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A cargo was \"taken into custody\", along with the Society's good opinion of itself.",
      "The Society's barge was \"rehomed by the Houses' customs\", cargo and all, for a fee.",
    ],
    debrief: "At Saltmarket the customs men seized the barge and its cargo. The Houses added a handling charge.",
    news: {
      head: ["{A} Seizes a Barge; Calls It a \"Favour to the Community\"", "Customs Win at Saltmarket: {a} Gets a Free Cargo", "{A}'s Constabulary Reports a Record Seizure"],
      body: [
        "{A}'s customs men have seized a barge, four crates and the paperwork. {b} watched from the gallery. The cargo will be sold back to its owners, at a profit.",
        "A customs win {a} has waited years for. The barge is listed as 'recovered', the crates as 'evidence' and the Society as 'regrettably helpful'.",
        "{A} says its patrol was simply walking the boardwalk with its eyes open. It has always been told to do this. Today, for the first time, it did.",
      ],
    },
  },
  scuttled: {
    piece: { kind: "bridge", surface: "table", label: "A scale model of a barge, sinking stern first. It looks sulky." },
    memoryLine: [
      "I hear you sank a barge rather than be caught with it. A toll is better than a wreck, I always say. But I respect the commitment.",
      "Word from the delta: a barge sank in the cove, and the evidence went down with it. The Houses are sending divers, and a bill.",
    ],
    headlines: [
      "Barge Goes Down at Reed Cove; Evidence Goes With Her",
      "Smugglers Sink Own Barge; Delta Divers Have a Busy Week",
      "Saltmarket Cove Gains a New Sight: One Barge, Underwater",
      "Unmarked Barge Sinks; Nobody Claims It",
    ],
    standfirsts: [
      "A barge was sunk on purpose at the reed cove, just before a patrol arrived with a form. The cargo now belongs to the delta. Purse: £{purse}. {spin}",
      "The Houses are examining the wreck. So far they have found that she was wet, that she was heavy, and that somebody pulled a plug. Purse: £{purse}. {spin}",
      "Four crates lie under the silt, where the Houses' inspectors cannot reach them without getting their ledgers wet. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "A barge was \"retired from service\", suddenly, in two fathoms of water.",
      "The Society \"dealt with the evidence\". Now there is none.",
    ],
    debrief: "At Saltmarket the barge and its cargo are at the bottom of the cove. The Guild has offered to bury the paperwork.",
    news: {
      head: ["{A} Inspects a Wreck and Finds It Badly Documented", "Barge Down in {a}'s Cove; {b} Offers a Wreath", "{A} Bills the Cove for the Wreck"],
      body: [
        "{A} calls the wreck 'a danger to shipping and to our good name', and has sent the sea a bill. {b} offers to bury what is left, with lilies, for a fee.",
        "A barge sank at the cove with four crates and has made no statement. {A} is said to be relieved, a new feeling for it in a customs matter.",
        "{A}'s divers found nothing. {A}'s lawyers found a great deal of nothing and are charging for it. {b} sent a basket.",
      ],
    },
  },
  informed: {
    piece: { kind: "envelope", surface: "chest", label: "An opened reward envelope from the Houses. They paid in crisp new notes, which means they are embarrassed." },
    memoryLine: [
      "I hear you reported your own barge to the Houses and they paid you for it. Where I work, that is called a confession, and nobody pays for those.",
      "Word from the delta: the Society told the Houses where its own barge was. I admire it. I would like to know the rate.",
    ],
    headlines: [
      "Society Reports Its Own Barge; Houses Pay a Reward, Wincing",
      "\"A Tip Is a Tip\": Houses Reward Unusual Honesty",
      "Smugglers Report Themselves; Saltmarket Has Never Seen the Like",
      "Houses Pay a Reward to the Barge's Own Owners; Society Calls It \"Cooperation\"",
    ],
    standfirsts: [
      "The Society walked into the Customs House and told the officer where its own barge was. It left with a reward. The barge stayed. Purse: £{purse}. {spin}",
      "It is Saltmarket's first case of an informer reporting himself. The Houses are still working out whom to bill. Purse: £{purse}. {spin}",
      "The customs officer is said to have wept quietly into a ledger. Nobody knows if it was pride or the damp. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"helped the Houses with their enquiries\", and was thanked, in cash.",
      "A cargo was \"brought to the customs' attention\", by the people who brought it.",
    ],
    debrief: "At Saltmarket the Houses paid you for reporting your own barge. The barge is theirs now.",
    news: {
      head: ["{A} Pays an Informer and Is Mildly Offended", "{A} Rewards a Tip From the Barge's Own Owners", "Reward Paid at {a}'s Customs House"],
      body: [
        "{A} paid a reward for a tip, then learned the tipster owned the barge. Its lawyers call this 'new, and so billable'. {b} has been told nothing.",
        "The customs officer is said to be 'moved'. {A} has given him a day off to recover, and a form to fill in about it.",
        "An informer walked into {a}'s Customs House with a story that was entirely true. {A} wants to know where he found one.",
      ],
    },
  },
  // ---- The Auction at High Water ----------------------------------------------------------------------------------------------------------------
  lot_won: {
    piece: { kind: "board", surface: "wall", label: "An auction ticket: THE TIDE CONCESSION OF OSSUARY BAY, SOLD TO THE SOCIETY. One corner is damp." },
    memoryLine: [
      "I hear the Society now owns the right to charge for the weather in Ossuary Bay. I charge for weather here too. I call it a toll.",
      "Word from the delta: you won the Houses' auction, standing in an inch of water. The Houses have gone very quiet. That is when I worry.",
    ],
    headlines: [
      "Society Wins the Tide Concession; Houses Bid, Lose, Float Away",
      "Hammer Falls at High Water: Lot Goes to the Society, Water Goes Everywhere",
      "Ossuary Bay's Weather Now Owned by Outsiders; Weather Unavailable for Comment",
      "Exchange Sells Tide to Newcomers; Newcomers Billed for Damp",
    ],
    standfirsts: [
      "The Brine Houses' auction ended at high water with the Society's bid on top and its feet in eighteen inches of water. The Houses are drying their paddles. Purse: £{purse}. {spin}",
      "The Houses have sold this lot to each other for generations. Now a stranger has it. The auctioneer was heard to say 'going, going, oh dear'. Purse: £{purse}. {spin}",
      "The Society holds the Tide Concession of Ossuary Bay forever, or until it rains. It was raining at the time. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"took a long-term interest in the local weather\", and bought it.",
      "A concession was \"won through the usual channels\", which were flooded.",
    ],
    debrief: "At Saltmarket you won the auction. The Houses will not forget the price, and nor will your purse.",
    news: {
      head: ["{A} Loses Its Own Auction and Is Told to Mind the Step", "Tide Concession Leaves {a}'s Hands, and So Does Its Dignity", "{A} Wins Nothing at Its Own Sale"],
      body: [
        "{A} was out-bid at its own Exchange by outsiders with a purse and a clock. It held a meeting about it, above the waterline. {b} smiled and was asked to stop.",
        "The Tide Concession went to the Society at high water. {A} calls it 'a temporary loan of the weather' and has begun writing a very long clause.",
        "{A}'s Heads left the hall by rank, holding their paddles over their heads. The auctioneer left last, wet to the shin, still saying 'gone'.",
      ],
    },
  },
  consortium: {
    piece: { kind: "pennant", surface: "wall", label: "A pennant of two Houses and the Society, sewn together with salty thread. It will not last the winter." },
    memoryLine: [
      "I hear the Society shared a lot with two of the Houses. A partnership: a committee that owns things. We have one here. It is called the garrison.",
      "Word from the delta: the Houses and the Society now share the weather, on a contract nobody has read. I wish them luck with the meetings.",
    ],
    headlines: [
      "Society and Houses Share the Tide; Salt-Stained Contract Signed",
      "Partnership Signed at High Water; Nobody Has Read It, All Agree It Is Fair",
      "Saltmarket's Weather Goes to a Committee; Committee Delighted",
      "Houses and Society Share a Lot, and Very Little Else",
    ],
    standfirsts: [
      "Two signatures, two inks, one wet sheet: the Houses and the Society now share the Tide Concession. Shares to be announced when the water goes down. Purse: £{purse}. {spin}",
      "The Exchange has shared a lot for the first time in living memory. The auctioneer now dines out on the phrase 'a spirit of partnership'. Purse: £{purse}. {spin}",
      "An odd partnership has leased the weather of Ossuary Bay. It depends on the tide, the Houses' goodwill and a clause nobody can find. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"entered a joint arrangement with local partners\", on salt-stained paper.",
      "A concession was \"shared in a spirit of mutual debt\". The Houses hold most of the debt.",
    ],
    debrief: "At Saltmarket you shared the lot with the Houses. You share the profits, and the grudges.",
    news: {
      head: ["{A} Shares a Lot; Calls It Generosity", "{A} Signs a Partnership, Will Read It Later", "Joint Venture at {a}'s Exchange: Shares to Follow, Eventually"],
      body: [
        "{A} has taken the Society as a partner in the Tide Concession. {b} calls it 'a big change of heart'. The ink was salty. The shares are in the post.",
        "The Houses and the Society will share the weather's profits, if any, and the blame, if there is any left. {A} has hired a clerk to keep the minutes dry.",
        "{A} notes that a partnership is just a lease with friends in it. It has quietly begun to count the friends.",
      ],
    },
  },
  shorted: {
    piece: { kind: "key", surface: "chest", label: "A key to a lot that was never really ours. The Houses have asked for it back twice, in bigger letters each time." },
    memoryLine: [
      "I hear the Society sold something it did not own, at the Houses' own auction. It is the most Society thing I have ever heard. I keep a file.",
      "Word from the delta: you sold the lot before you paid for it, in a flood. The auctioneer clapped, then called the guard. In that order.",
    ],
    headlines: [
      "Society Sells What It Never Paid For; Houses Lost for Words",
      "Lot Sold, Nobody Pays; Money \"Expected\"",
      "Tide Concession Sold Before It Was Bought; Auctioneer Impressed",
      "Delta Stunned by Sale on Credit; Hall Floods in Sympathy",
    ],
    standfirsts: [
      "The Society bid for the Tide Concession with no money, then sold it on before the hammer fell. The Houses call it 'theft with good manners'. Purse: £{purse}. {spin}",
      "The lot is the Society's, unpaid for. The Houses are writing an account of how this happened, and another of how it will never happen again. Purse: £{purse}. {spin}",
      "Nobody has been paid. Everybody has been promised. The hall is under two feet of water, which the auctioneer says is the most solid thing in it. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"used the Exchange's flexible payment terms\", which bend one way only.",
      "A lot was \"sold before it was bought\", a trick the Houses will be quoting for years.",
    ],
    debrief: "At Saltmarket you sold the lot before paying for it, and got away with it. The Houses want a word, and a signature.",
    news: {
      head: ["{A} Outsmarted at Its Own Sale; Lawyers Called", "{A} Finds the Tide Concession Has Two Owners, and Neither Paid", "Credit Sale at the Exchange Leaves {a} Without Credit"],
      body: [
        "{A} was beaten at its own auction by a bid with no money behind it. It calls this 'theft with good manners'. {b} watched from the gallery, delighted, drawing a diagram.",
        "The lot was sold before it was bought, then bought before it was paid for, then paid for 'in principle'. {A} has asked for the principle in cash.",
        "{A} says it has never been tricked in all its history. If it has, the history will be changed. {b} has offered to help change it.",
      ],
    },
  },
  washed_out: {
    piece: { kind: "stone", surface: "table", label: "A stone from the Exchange's second step, with the high-water line on it. It has been underwater, and it has opinions." },
    memoryLine: [
      "I hear the Houses' sale was washed out by the tide and nobody won. Fitting. Some of my own meetings deserve the same.",
      "Word from the delta: the Exchange held its sale in the flood, and the water won. They say the auctioneer brought the hammer down underwater.",
    ],
    headlines: [
      "Exchange Floods, Sale Closes: \"The Lot Is Gone\", Says Auctioneer, Dripping",
      "Tide Takes the Tide Concession; Nobody Wins, Everybody Pays",
      "Auction at High Water Washed Out; Houses Bill the Tide",
      "Hall Floods at Saltmarket; Hammer Falls on Water",
    ],
    standfirsts: [
      "The Brine Houses' Exchange flooded on schedule and held its sale anyway. The water won by the third lot. The Houses have sent the weather a bill. Purse: £{purse}. {spin}",
      "The hammer fell at high water on nothing at all. The Exchange's books call this 'a clear result'. The lot will be offered again at the next spring tide. Purse: £{purse}. {spin}",
      "Nobody owns the Tide Concession of Ossuary Bay, and the sea has not claimed it. The Society was there and is said to be 'drying'. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"saw the sale reach its usual end\", up to the knee.",
      "A sale was \"ended by local conditions\". The conditions were water.",
    ],
    debrief: "At Saltmarket the tide washed out the sale. Nobody holds the lot, and the Houses are drying off.",
    news: {
      head: ["{A} Closes the Sale; the Sea Declines to Comment", "{A}'s Exchange Floods on Schedule, to General Applause", "Auction Washed Out; {a} Blames the Weather It Sold"],
      body: [
        "{A} calls the afternoon 'a clear result' and the water in the hall 'a seasonal feature'. {b} sent a boat.",
        "The hammer fell at high water on a lot that was mostly underwater. {A} has billed the tide for the trouble and is waiting for a reply.",
        "{A} notes that its Exchange has flooded on schedule at every spring tide for generations. On balance, it calls this a success.",
      ],
    },
  },
  // D-093, the Lost Survey (lost_survey): the surveyor home with his books, home without them, sold to the Houses with his survey, or lost to the reeds.
  survey_home: {
    piece: { kind: "frame", surface: "wall", label: "The first page of the Delta Survey, framed: nineteen canals (two counted twice) and a pond, in angry handwriting." },
    memoryLine: [
      "I hear the Society got its surveyor out of the delta with his books. The Houses are furious. With the Houses, fury earns interest.",
      "Word from the delta: your man came home with his measurements. I would very much like a copy. For map-making purposes only, of course.",
    ],
    headlines: [
      "Surveyor Returns From Delta With His Books and a Grievance",
      "\"Nineteen Canals, Two Twice\": Delta Survey Reaches London Intact",
      "Survey Party Rescued; Houses' Hospitality Ends at the Quay",
      "Lost Surveyor Found Exactly Where the Houses Left Him",
    ],
    standfirsts: [
      "Mr. Augustus Pellow-Brane, the Society's surveyor, walked out of the west reeds with his field books. He wants the Houses' tea recorded as an act of war. Purse: £{purse}. {spin}",
      "The survey party is home after a week as guests of the Brine Houses. They billed it for every chain it measured, and some it only thought about. Purse: £{purse}. {spin}",
      "The Admiralty will get its map of the delta, with the delta's name spelled three ways. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"completed its survey of the western waters\". This meant walking one man in shirtsleeves past two wardens and a ledger.",
      "The surveyor's books were \"released from an administrative hold\". The hold was a table. The administration was the Houses.",
    ],
    debrief: "At Saltmarket the Society's surveyor came home from the west reeds with his field books.",
    news: {
      head: ["{A}'s Canals Charted; {A} Charges for the Ink", "Society Survey Leaves the Reeds; {A} Keeps the Receipt", "{A} Counts Its Canals, and Finds the Society Has Too"],
      body: [
        "{A} confirms that a foreign survey has measured its canals. The dues are paid, or will be remembered. A map of the delta is now in London, which {A} calls a leak.",
        "The Society's surveyor has left the delta with his books. {A} has opened a new ledger, 'Maps No Longer Only Ours', and written the first entry in red. {b} wants a copy.",
        "{A} says it gave the Society's surveyor every comfort. It has the bills to prove it, and would like them paid.",
      ],
    },
  },
  chart_ceded: {
    piece: { kind: "board", surface: "wall", label: "A board with a brass plate: THE DELTA SURVEY, GIVEN TO THE HOUSES. The surveyor has pencilled the canals on it from memory, in protest." },
    memoryLine: [
      "I hear your surveyor came home and his chart did not. The Houses are pleased. That frightens me more than when they are angry.",
      "Word from the delta: the Society gave the Houses its map of their own canals. Generous. I did not know the Society could be generous by accident.",
    ],
    headlines: [
      "Surveyor Home, Survey Not: Society Hands Delta Chart to Houses",
      "Mr. Pellow-Brane Returns Without His Books, and in a Temper",
      "Houses Keep the Canals' Secrets; Society Keeps Its Man",
      "\"The Delta May Be Measured Again\", Says Society, Measuring Nothing",
    ],
    standfirsts: [
      "The Society's surveyor is home from the west reeds. His chart of nineteen canals is not: it was handed to the Brine Houses to free him. Purse: £{purse}. {spin}",
      "Mr. Augustus Pellow-Brane came home in the Society's boat. He has started the survey again from memory, on the back of the Houses' receipt. Purse: £{purse}. {spin}",
      "The Houses kept the chart and returned the man who drew it. The Committee calls it a fair swap. The man calls it theft. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"left the map in local care\", meaning the Houses' ledger. Nothing has ever left that ledger.",
      "The chart was \"handed over in a spirit of understanding\". The Houses understood the chart. The Society understood the wardens.",
    ],
    debrief: "At Saltmarket the surveyor came home, and the Houses kept his chart of their canals.",
    news: {
      head: ["{A} Keeps the Society's Chart; Calls It \"Hospitality, Returned\"", "Delta Survey Stays in the Delta; {A} Delighted, Quietly", "{A} Accepts a Map of Itself, With Thanks"],
      body: [
        "{A} has taken the Society's survey of its canals instead of dues, and let the surveyor go, with his hat. The chart is filed under 'Ours', {A}'s biggest heading.",
        "A map of the delta, made at the Society's cost, now belongs to {A}, who measured nothing. {b} has written to ask how it is done.",
        "{A} reports a friendly deal with the Society: the Society gave, {A} kept, and everyone went home. Some went home without their books.",
      ],
    },
  },
  survey_sold: {
    piece: { kind: "envelope", surface: "table", label: "The Houses' payment for the Delta Survey, and a postcard from Mr. Pellow-Brane, now a pilot. He is very happy." },
    memoryLine: [
      "I hear the Society sold its own surveyor to the Houses, with his books. I have never admired you more, or trusted you less.",
      "Word from the delta: your man is a pilot now, and the Houses own his chart. I hope the price was good. It usually is, for the buyer.",
    ],
    headlines: [
      "Society Sells Delta Survey to Houses; Surveyor Included, Free",
      "Mr. Pellow-Brane Becomes a Brine House Pilot; Society \"Delighted\"",
      "Lost Surveyor Found, Sold",
      "Delta Survey: Measured by the Society, Owned by the Houses",
    ],
    standfirsts: [
      "The rescue party reached the surveyor in the west reeds, talked with the Collector of Canal Dues, and sold the Houses his survey. He stayed on as a pilot. Purse: £{purse}. {spin}",
      "The Brine Houses have bought the Delta Survey, its books and its author. The author came free. He says he is 'very happy, eventually'. Purse: £{purse}. {spin}",
      "The Committee has received the Houses' payment and a postcard. The postcard is more cheerful. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society \"made money from its western survey\" by selling it, surveyor included.",
      "A surveyor was \"lent to local shipping\", at a salary the Society never mentions.",
    ],
    debrief: "At Saltmarket the Houses bought the Society's survey, and its surveyor stayed on as their pilot.",
    news: {
      head: ["{A} Buys a Survey and Gains a Pilot", "{A} Buys the Society's Map of Itself, and the Mapmaker", "Society Sells; {A} Buys; Surveyor Stays"],
      body: [
        "{A} has bought the Society's survey of its canals, for less than the dues would have been. It offered the surveyor a job. He took it, and a raise.",
        "The delta's canals are mapped, the map is {A}'s, and the mapmaker pilots its barges. {b} calls it the best deal on the water this year.",
        "{A} welcomes Mr. Augustus Pellow-Brane, late of the Society, as Second Pilot of the Western Reaches. He reads a tide, {A} says, the way other men read the paper.",
      ],
    },
  },
  survey_lost: {
    piece: { kind: "frame", surface: "wall", label: "A photograph of Mr. Pellow-Brane on the step of a reed-cutter's house, waving his theodolite. The water is up to the step." },
    memoryLine: [
      "I hear the Society left its surveyor in the delta for the tide to keep. The Houses will send him home in spring, with the bill. Stand well back from the bill.",
      "Word from the delta: your man is on an island now. I am told he is measuring it.",
    ],
    headlines: [
      "Delta Survey Lost to the Tide; Surveyor Expected in Spring",
      "Mr. Pellow-Brane Cut Off by the Tide; Society \"Watching Closely\"",
      "Rescue Party Returns Without the Man It Went to Rescue",
      "The Lost Survey Is Still Lost, Now Officially",
    ],
    standfirsts: [
      "The Society's rescue party has come back from the west reeds without its surveyor. The tide came first. The tide tables said it would. Purse: £{purse}. {spin}",
      "Mr. Augustus Pellow-Brane is still the Brine Houses' guest, now on an island. A passing barge brings word that he is 'measuring it'. Purse: £{purse}. {spin}",
      "The Committee regrets that the Delta Survey is lost in the reeds. It has started a fund for a second survey, to find the first. Purse: £{purse}. {spin}",
    ],
    siteLines: [
      "The Society's surveyor was \"left in the care of the local authorities\", who are the tide.",
      "The rescue \"came to a natural end\" in the west reeds. Nature ended it with a flood.",
    ],
    debrief: "At Saltmarket the Society's surveyor was left in the west reeds. The Houses will bill you for his keep.",
    news: {
      head: ["{A} Keeps the Society's Surveyor Another Season", "Tide Settles the Society's Account with {A}", "{A} Is Stuck With a Guest"],
      body: [
        "{A} confirms the Society's surveyor is still its guest. The tide closed the reeds before anyone could settle the bill. The tea goes on. So does the bill.",
        "The Society's attempt to fetch its surveyor ended at the water's edge. {A} has added a line to the bill: 'Spring: return of one gentleman, postage due'.",
        "{A} reports that Mr. Pellow-Brane is in good health, good spirits and on an island, and has been charged for all three. {b} has sent him a book.",
      ],
    },
  },
};

/** The ledger story's heading per template (>= 3 each), by the paper's `lastTemplate`. */
export const SALTMARKET_STORY_HEADS = {
  smuggling_run: ["The Quiet Barge, in Figures", "Saltmarket: the Customs Report", "On the Matter of a Cargo"],
  flooded_market: ["The High-Water Sale, in Figures", "Saltmarket: the Exchange Reports", "On the Matter of a Lot"],
  lost_survey: ["The Lost Survey, in Figures", "Saltmarket: the Reeds Report", "On the Matter of a Surveyor"],
} as const;

/** Signage of the delta (Latin capitals; the view letters these). */
export const SALTMARKET_SIGNS: readonly string[] = [
  "SALTMARKET QUAY. THE TIDE IS OURS. YOU ARE RENTING IT.",
  "CUSTOMS HOUSE. DECLARE EVERYTHING. WE WILL DECIDE WHAT IT WAS.",
  "THE EXCHANGE. LOTS CLOSE AT HIGH WATER. SO DOES THE EXCHANGE.",
  "NO WAKE. NO WEATHER. NO COMMENT.",
];

export const SALTMARKET_REGION: RegionCopy = {
  chartNote: (c: CampaignState): string => {
    const cargo = c.sites.ends.smuggling_run, market = c.sites.ends.flooded_market, survey = c.sites.ends.lost_survey;
    if (!c.history.some((h) => h.region === "saltmarket")) return "Not yet visited. River channels, warehouses on stilts, and a market hall that floods on schedule.";
    const parts: string[] = [];
    if (cargo !== undefined) parts.push(`the barge was ${cargo === "informed" ? "informed on" : cargo.replace("_", " ")}`);
    if (market !== undefined) parts.push(`the sale ${market === "lot_won" ? "went to you" : market === "consortium" ? "was shared" : market === "shorted" ? "was shorted" : market === "washed_out" ? "washed out" : "was left"}`);
    if (survey !== undefined) {
      const how = survey === "survey_home" ? "came home with his books" : survey === "chart_ceded" ? "came home without his chart" : survey === "survey_sold" ? "was sold, with his survey" : "was left to the reeds";
      parts.push(`the surveyor ${how}`);
    }
    return `Last time: ${parts.length ? parts.join("; ") : "an expedition that left no mark"}. The Houses keep the receipts.`;
  },
  presence: ["Day {day}: {party} at Saltmarket, bidding on weather", "Day {day}: {party} at Saltmarket, owing the Houses money"],
  parley: { heading: "A word on the quay", asked: "Price asked: £{price} · Round {round} · The Houses seem {mood}." },
};
