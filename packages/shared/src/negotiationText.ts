import type { ResolutionId, FactionStance } from "./campaignTypes.ts";
import type { NeedId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";

/**
 * Authored words for the Lamp-Warden's parleys. A fictional institution speaking: dry, proud, bureaucratic, not stupid.
 * Placeholders: {toll} the price on the table, {cost} the sum changing hands. Nothing here refers to any real place or people.
 */

/** Fill {key} placeholders. Unknown keys are left out (empty), so a typo shows up in tests as a short line, never as "{key}" on screen. */
export function fillTemplate(t: string, vars: Readonly<Record<string, string | number>>): string {
  return t.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : ""));
}

export const pickFrom = <T>(list: readonly T[], seed: number, a: number, b: number): T => list[hash3(seed, a, b) % list.length]!;

export const OPEN: Record<FactionStance, readonly string[]> = {
  hostile: [
    "Ah. You. The toll is £{toll}, and I have added a small charge for your face.",
    "£{toll}. Do not say 'improvement' within earshot of my lamps.",
    "Stop there. The price is £{toll}, and I am not in the mood to be educated.",
    "You again. £{toll}. The bridge remembers everything it has been asked to carry.",
  ],
  wary: [
    "Toll is £{toll}. I keep a ledger, and you are in it.",
    "Crossing is £{toll}. Keep your hands where the lamps can see them.",
    "£{toll} to cross. Smile if you like; it is not priced in.",
    "State your business, then pay £{toll}. In that order, if you please.",
  ],
  neutral: [
    "Good day. The crossing is £{toll}. Receipts are free; everything else is not.",
    "Welcome to Kessar Reach. £{toll}, and mind the parapet. It has opinions.",
    "Toll is £{toll}. Nine lamps, one bridge, no exceptions, several.",
    "£{toll} for the crossing. I am told that is very reasonable. I was the one who told them.",
  ],
  warm: [
    "Ah, the Society's friends. £{toll}, and the tea is on the house. The tea.",
    "For you, £{toll}. It is the same as everyone's, but I say it more kindly.",
    "£{toll}. Do come through; the lamps are pleased to see you. Nobody else is.",
    "Welcome back. £{toll}, and I will pretend this is difficult for me.",
  ],
  allied: [
    "My friends. £{toll}, which I am required to say aloud. Put it in the dish and we shall call it a blessing.",
    "Friend of the Nine Lamps! £{toll}. The bridge would carry you for free, but it has a mortgage.",
    "£{toll}, dear allies, and a salute from the whole wall. They do practise.",
    "You have been good to the Ward. £{toll}; I shall round down when I write it up.",
  ],
};

export const NEED_LINE: Record<NeedId, readonly string[]> = {
  coin: ["The walls want mortar and the mortar wants money.", "The Ward's purse has a draught in it."],
  arms: ["We are short of pikes, and of people who enjoy holding them.", "Our armoury is mostly enthusiasm."],
  medicine: ["Half my garrison is bandaged and the other half is thinking about it.", "The infirmary is out of lint, and out of patience."],
  deference: ["A proper salute would not go amiss. We are owed some ceremony.", "No one has saluted the lamps correctly since the Society arrived."],
};

/** What she remembers of your last visit. */
export const MEMORY_LINE: Record<ResolutionId, readonly string[]> = {
  paid: ["You paid promptly last time. I noticed.", "You paid without a murmur last time. It was unsettling."],
  bargained: ["You haggled well last time. I have been practising.", "Last time you talked me down. I have since had words with my arithmetic."],
  bribed: ["Last time you bought my quartermaster. He has been unbearable since.", "I have seen my quartermaster's new boots. I have questions."],
  forced: ["Last time you came with guns. The wall still has the dents.", "The infirmary has a bed named after you. It is not a compliment."],
  sabotaged: ["You dropped my bridge. It is promised back by spring. It was an optimistic spring.", "I have a bridge-shaped hole in my accounts, and you were standing next to it."],
  rival_secured: ["Last time you dawdled, and the Syndicate bought the crossing from under us both.", "You were late, and the Syndicate was not. Think on that."],
  abandoned: ["Last time you walked away. Do it again and I shall stop setting a place.", "You left without paying. The lamps noticed, and so did I."],
};
export const LIES_LINE: readonly string[] = [" I am told you do not always keep your word.", " Your promises have been discussed at some length."];

export const REPLY = {
  flatterOk: [
    "Hm. Manners. Very well: £{toll}, and I shall say it was my idea.",
    "That was almost a compliment. £{toll}. Do not spoil it.",
    "Nobody says that to me. £{toll}, and thank you.",
    "You flatter a tired woman. £{toll}.",
  ],
  flatterFail: [
    "Flattery is cheap. £{toll} is what it will cost you now.",
    "You mistake me for someone with a weak spot. £{toll}.",
    "Charming. The price is now £{toll}, to cover the charm.",
    "I have been complimented by experts. £{toll}.",
  ],
  threatenOk: [
    "There is no need to wave that about. £{toll}. Put it away before the lamps see.",
    "You have made your point, with some emphasis. £{toll}, and we shall call it a discount.",
    "Very persuasive. £{toll}. My people will remember this, but not today.",
  ],
  threatenSoft: [
    "Is that all? £{toll}, and do hold the thing properly.",
    "You are holding it the wrong way up. £{toll}, for the insult.",
    "I have been threatened by better. £{toll}.",
  ],
  hostile: [
    "Then we are finished talking. Lamps up!",
    "You have made your choice. So, regrettably, have the pikes.",
    "I did ask you not to. Sound the horn.",
  ],
  paid: [
    "Paid. A receipt, in triplicate. The bridge is yours.",
    "£{cost}, received. Cross, and leave the bridge as you found it.",
    "Excellent. The lamps thank you. So does the roof.",
  ],
  bargained: [
    "£{cost}, agreed. I shall tell the ledger it was generosity.",
    "Done at £{cost}. You drive a fair bargain, for a visitor.",
    "£{cost}. The ledger weeps, but it balances.",
  ],
  bribed: [
    "I did not see that. Nor did the quartermaster, who now owns a lovely hat.",
    "A gift to the garrison welfare fund. Go through, quietly.",
    "The bridge is open. The ledger is, regrettably, somewhere else.",
  ],
  walk: [
    "As you wish. The bridge will be here. It has nowhere else to be.",
    "Going? Mind the road. It has not been improved.",
    "Of course. Do come back when you have found some manners.",
  ],
  lastCall: [
    "I have a queue, you know. Well, I have a dog. Decide.",
    "The lamps are getting restless. Decide.",
  ],
} as const;

export const LABEL = {
  pay: "Pay the £{cost} toll",
  haggle_flatter: "Flatter the Lamp-Warden",
  haggle_threaten: "Show them the guns",
  bribe: "Slip the quartermaster £{cost}",
  walk_away: "Walk away",
} as const;

export const HINT = {
  pay: "Safe. The Ward is a stickler, not a thief.",
  haggle_flatter: "She likes being asked nicely.",
  haggle_threaten: "Needs a steady hand and a steady crowd. A bluff called ends the talking.",
  bribe: "Cheap and quiet, until it is neither.",
  walk_away: "Nothing lost, nothing crossed.",
} as const;
