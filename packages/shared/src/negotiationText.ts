import type { ResolutionId, FactionStance } from "./campaignTypes.ts";
import type { NeedId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";
import { pluck } from "./regionEndings.ts";
import { ENGINE_COPY } from "./engineText.ts";
import { RAID_COPY } from "./raidText.ts";
import { SIEGE_COPY } from "./siegeText.ts";
import { TRIG_COPY } from "./trigText.ts";
import { HUNT_COPY } from "./huntText.ts";
import { REAPERS_COPY } from "./reapersText.ts";
import { SALTMARKET_COPY } from "./saltmarketText.ts";
import { VESPER_COPY } from "./vesperText.ts";

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
    "Ah. You. The toll to cross is £{toll}. I added a small charge for your face.",
    "Back again? The toll to cross is £{toll}. And do not try to 'improve' anything while you are here.",
    "Stop there. The toll to cross is £{toll}. I do not want a lecture from your Society today.",
    "You again. The toll to cross is £{toll}. The bridge remembers you, and so do I.",
  ],
  wary: [
    "The toll to cross is £{toll}. I keep a book of visitors, and you are in it.",
    "It costs £{toll} to cross. Keep your hands where the lamps can see them.",
    "It costs £{toll} to cross. You may smile, but it will not lower the price.",
    "Tell me your business, then pay the £{toll} toll. In that order, please.",
  ],
  neutral: [
    "Good day. It costs £{toll} to cross my bridge. The receipt is free. Nothing else is.",
    "Welcome to Kessar Reach. The toll to cross is £{toll}. Please do not lean on the wall; it is older than your Society.",
    "The toll to cross is £{toll}. Nine lamps, one bridge, and everybody pays.",
    "The toll to cross is £{toll}. I am told that is very fair. I am the one who told them.",
  ],
  warm: [
    "Ah, friends. The toll to cross is £{toll}, and the tea is free. Only the tea.",
    "For you, the toll is £{toll}. Everyone pays that, but I say it more kindly to you.",
    "The toll to cross is £{toll}. Do come through. The lamps are pleased to see you, even if nobody else is.",
    "Welcome back. The toll to cross is £{toll}, and I will pretend it hurts me to ask.",
  ],
  allied: [
    "My friends. The toll is £{toll}; the rules make me say it. Put it in the dish and we will call it a gift.",
    "Friends of the Nine Lamps! The toll is £{toll}. I would let you cross for free, but the bridge has bills to pay.",
    "The toll is £{toll}, dear allies. The guards on the wall will salute you. They have been practising.",
    "You have been good to the Ward. The toll is £{toll}, and I will round it down in the books.",
  ],
};

export const NEED_LINE: Record<NeedId, readonly string[]> = {
  coin: ["The Ward is short of money. The walls need mending, and bricks are not free.", "The Ward is short of money. Our purse has more holes than our walls."],
  arms: ["The Ward is short of weapons, and of people who like holding them.", "The Ward is short of weapons. Our armoury is mostly hope."],
  medicine: ["The Ward is short of medicine. Half my guards are bandaged, and the other half are worried.", "The Ward is short of medicine. The sick room has run out of bandages, and patience."],
  deference: ["The Ward wants respect. A proper salute would not hurt.", "The Ward wants respect. Nobody has saluted the lamps properly since your Society arrived."],
};

/** What she remembers of your last visit. */
export const MEMORY_LINE: Record<ResolutionId, readonly string[]> = {
  ...pluck(VESPER_COPY, "memoryLine"), ...pluck(SALTMARKET_COPY, "memoryLine"), ...pluck(REAPERS_COPY, "memoryLine"), ...pluck(ENGINE_COPY, "memoryLine"), ...pluck(RAID_COPY, "memoryLine"), ...pluck(HUNT_COPY, "memoryLine"), ...pluck(SIEGE_COPY, "memoryLine"), ...pluck(TRIG_COPY, "memoryLine"),   // D-037 (regionEndings.ts)
  paid: ["You paid on time last time. I noticed.", "Last time you paid without a word of complaint. It worried me."],
  bargained: ["You talked the price down last time. I have been practising since.", "Last time you talked me down. I have had a stern word with my sums."],
  bribed: ["Last time you bribed my quartermaster. He has been unbearable since.", "My quartermaster has new boots since your last visit. I have questions."],
  forced: ["Last time you came with guns. The wall still has the dents.", "Last time you hurt my guards. The sick room has a bed named after you. It is not an honour."],
  sabotaged: ["Last time you dropped my bridge in the river. It will be rebuilt by spring. Some spring.", "Last time my bridge fell down, and you were standing right next to it."],
  rival_secured: ["Last time you were too slow, and the Syndicate bought the crossing first.", "Last time you were late, and the Syndicate was not. Think about that."],
  abandoned: ["Last time you walked away. Do it again and I will stop expecting you.", "Last time you left without paying. The lamps noticed, and so did I."],
  // what she heard about the other business at Kessar (D-034): the Ward keeps a ledger of everybody's trouble
  ransomed: ["You paid deserters to give back a surveyor. Now they think kidnapping is a business. Thank you.", "I hear you bought a man back from the deserters at the Orchard. How much? It is for my records."],
  rescued: ["You cleared the deserters out of the Orchard. The Ward would have done it too, after the paperwork.", "A surveyor came home over the ford with a rifle on each side. We have a form for that."],
  slipped_away: ["You got a man out of the Orchard without firing a shot. I did not think your Society could.", "Somebody crept through my scrubland without paying a penny. I almost admire it."],
  hostage_lost: ["Last time a man died in the Orchard while you were meant to save him. I wrote it down.", "Mr. Quim never came home. Your Society calls it 'an unexpected resignation'."],
  seized: ["Last time you took a Syndicate wagon in the Cut. We are not unhappy. Officially, we are neutral.", "That Syndicate wagon you took was not yours. It was not mine either, so I am not sure how to feel."],
  tipped_off: ["You warned my ford post about a Syndicate wagon, and we stopped it. In private, I call that teamwork.", "Last time you sent me a warning, and I sent two soldiers. We are even."],
  burned: ["Last time a wagon blew up in the Cut. I am told nobody did it. The barrel did it by itself.", "I smelled gunpowder from the hill. The paper says the wagon exploded by itself. Wagons do not do that."],
  passed: ["Last time a Syndicate wagon crossed my ford while you watched. I noticed who watched.", "You let a Syndicate wagon go past. We could have used your help."],
  mediated: ["You got the Ward and the Syndicate to sign one paper. I have it framed, facing the wall.", "Last time you made peace at the Marker Stone. It was rude of you, but it worked."],
  sided_ward: ["You told my patrol the Syndicate's plan. Thank you. You still do not get a discount.", "Last time you came to us first. We noticed, and we wrote it down."],
  sided_syndicate: ["You moved Marker Stone No. 4 for the Syndicate. The stone is missing. So is my patience.", "I know about the Syndicate's envelope. I even know how thick it was."],
  provoked: ["Last time you fired on a border patrol. The sergeant and the surveyor still do not speak.", "Last time you fired first at the ford. Nobody has forgotten who started it."],
  escalated: ["Last time the ford became a battle while you stood and watched. Watching is a skill, I suppose.", "Last time my patrol and the Syndicate fought at the Stone, and your Society took notes."],
  // D-036: news from the highlands reaches Kessar late and secondhand; the Lamp-Warden files it under the Society's character
  backed_elder: ["I hear you put the elder heir on the throne at Highmark. Officially, we have no opinion.", "I hear the elder heir got the throne at Highmark. I approve of age, in principle."],
  backed_younger: ["I hear you put the younger heir on the throne at Highmark. Youth is a gamble. I hope you like gambling.", "They say you crowned the young one at Highmark. My lamps have no opinion, and nor do I."],
  regency: ["I hear Highmark is now ruled by three people at once. We will see who holds the pen.", "You gave Highmark a throne run by a committee. I am impressed, and a little afraid."],
  usurped: ["I hear the throne at Highmark was seized, and your Society was in the room. I know that look.", "I hear the Highmark throne changed hands in the night. Nobody saw a thing, of course."],
  crown_sold: ["The Syndicate bought the crown at Highmark. Next they will want my bridge.", "The Syndicate bought a crown with a cheque. I have seen cheaper deals, but not many."],
};
export const LIES_LINE: readonly string[] = [" I hear you do not always keep your promises.", " People say your promises are worth very little."];

export const REPLY = {
  flatterOk: [
    "Hm. Good manners. Fine: the toll is now £{toll}, and I will say it was my idea.",
    "That was almost a compliment. The toll is now £{toll}. Do not spoil it.",
    "Nobody ever says that to me. Thank you. The toll is now £{toll}.",
    "You are kind to a tired woman. The toll is now £{toll}.",
  ],
  flatterFail: [
    "Flattery is cheap. The toll is not: it is now £{toll}.",
    "Nice try, but I have no soft side. The toll is now £{toll}.",
    "Charming. The toll is now £{toll}, to pay for the charm.",
    "Experts have praised me, and you are not one. The toll is now £{toll}.",
  ],
  threatenOk: [
    "No need to wave that about. Fine, the toll is now £{toll}. Put it away.",
    "You have made your point. The toll is now £{toll}. We will call it a discount.",
    "Very persuasive. The toll is now £{toll}. My people will remember this.",
  ],
  threatenSoft: [
    "Is that all? The toll is now £{toll}. And hold that thing properly.",
    "You are holding it upside down. The toll is now £{toll}, for the insult.",
    "Better people have threatened me. The toll is now £{toll}.",
  ],
  hostile: [
    "Then we are done talking. Guards, to the bridge!",
    "You have made your choice. Sadly, so have my guards.",
    "I asked you not to. Sound the alarm!",
  ],
  paid: [
    "Paid, thank you. Here is your receipt, in three copies. You may cross.",
    "£{cost} received. You may cross. Leave the bridge as you found it.",
    "Paid, thank you. You may cross. The lamps thank you, and so does the leaky roof.",
  ],
  bargained: [
    "£{cost} it is. You may cross. I will write it down as generosity.",
    "Done: £{cost}. You may cross. You bargain well, for a visitor.",
    "£{cost} received. You may cross. My accounts weep, but they add up.",
  ],
  bribed: [
    "I did not see that. My quartermaster did, and he now owns a lovely hat. Go through.",
    "A gift for the guards' welfare fund, is it? Go through, quietly.",
    "The bar is up. You may cross. The record of this has gone missing, sadly.",
  ],
  walk: [
    "As you wish. The bridge will be here. It has nowhere else to be.",
    "Leaving? Watch the road. Your Society has not 'improved' it yet.",
    "Of course. Do come back when you have found some manners.",
  ],
  // D-047: a party short of the toll turns out its pockets
  pleadOk: [
    "£{cost}, a button and a promise. Fine, you may cross. Go, before I change my mind.",
    "I will write it down as £{cost} and a sad story. You may cross. Do not make a habit of it.",
    "£{cost} will do. The Ward is not a charity, but we know empty pockets. Cross.",
  ],
  pleadFail: [
    "I have heard that story before, from a better liar. The toll is still £{toll}.",
    "Empty pockets are not money. The toll is still £{toll}.",
    "Very touching. The toll is still £{toll}. The lamps are not moved.",
  ],
  lastCall: [
    "I have a queue, you know. Well, I have a dog. Last chance: decide now.",
    "The lamps are getting restless. Last chance: decide now.",
  ],
} as const;

export const LABEL = {
  pay: "Pay the £{cost} toll",
  haggle_flatter: "Flatter the Lamp-Warden",
  haggle_threaten: "Threaten her with your guns",
  bribe: "Bribe the quartermaster (£{cost})",
  plead: "Offer all you have (£{cost})",
  walk_away: "Walk away",
} as const;

export const HINT = {
  pay: "Safe. You cross. The Ward is strict, but honest.",
  haggle_flatter: "Compliment her to lower the toll. If it fails, the toll goes up.",
  haggle_threaten: "Big discount if it works. If not, the toll goes up, or her guards attack.",
  bribe: "Cheaper than the toll, and you cross. She will hear about it one day.",
  plead: "You are short of the toll. She may accept what you have.",
  walk_away: "You keep your money, but you do not cross.",
} as const;
