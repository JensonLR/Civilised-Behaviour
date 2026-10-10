import { hash3 } from "./rng.ts";

/**
 * D-087: THE SOCIETY SPEAKS. The party's gentlemen (and ladies) exclaim at the moments a player would: a foe dropped, a hat removed by a bullet, a keg chain,
 * a colleague shot by mistake, their own fall. The voice is pompous gibberish (formant babble, apps/client/src/audio/babble.ts: no recordings, no licence);
 * the WORDS are these, printed on a slip over the speaker's head, so a clip reads with the sound off. The server says who speaks and why (Mayhem, a cosmetic
 * `bark` event); the client picks the line. The joke is the Empire's own bluster (D-085): never a people abroad.
 */

export type BarkKind = "triumph" | "headshot" | "brolly" | "limb" | "chain" | "down" | "flung" | "friendly" | "commission" | "finisher" | "rope" | "boot" | "grudge" | "trample" | "shield" | "holdup" | "yield";
export const BARK_KINDS: readonly BarkKind[] = ["triumph", "headshot", "brolly", "limb", "chain", "down", "flung", "friendly", "commission", "finisher", "rope", "boot", "grudge", "trample", "shield", "holdup", "yield"];
export const isBarkKind = (k: unknown): k is BarkKind => typeof k === "string" && (BARK_KINDS as readonly string[]).includes(k);

/** The shape of the babble that carries a line: a boast rises and swoops, an exclamation is short and high, a mutter is low, a harrumph is a harrumph. */
export type BabbleKey = "boast" | "exclaim" | "question" | "mutter" | "harrumph";
export const BABBLE_KEYS: readonly BabbleKey[] = ["boast", "exclaim", "question", "mutter", "harrumph"];

export const BARK_LINES: Readonly<Record<BarkKind, { key: BabbleKey; lines: readonly string[] }>> = {
  triumph: { key: "exclaim", lines: ["Splendid!", "Jolly good!", "Capital!", "Down he goes, what!", "One for the Gazette!", "That's the stuff!", "Tally-ho!", "By gum!"] },
  headshot: { key: "exclaim", lines: ["Right through the hat!", "The Hatters will be thrilled!", "Clean as a whistle!", "Mind your hat, sir! Too late."] },
  brolly: { key: "boast", lines: ["Never travel without one!", "And it isn't even raining!", "Forty years of umbrella drill!", "Furled, and fatal."] },
  limb: { key: "boast", lines: ["I believe that's yours!", "For the Museum!", "Someone label that!", "He won't be needing it."] },
  chain: { key: "exclaim", lines: ["Rule, Britannia!", "Mind your eyebrows!", "That'll be in the Gazette!", "Whitehall will hear that!"] },
  down: { key: "exclaim", lines: ["I say, I'm hit!", "Bother!", "Not the waistcoat!", "Tell Pall Mall I tried!", "Most inconvenient!"] },
  flung: { key: "exclaim", lines: ["Wheeeee!", "I can see London from here!", "Not again!", "Put me down this instant!"] },
  friendly: { key: "mutter", lines: ["Terribly sorry, old chap!", "My mistake, frightfully sorry!", "He moved!", "We'll tell the Gazette it was the weather."] },
  commission: { key: "boast", lines: ["Hear, hear!", "The Society is grateful!", "Pall Mall will be in raptures!", "Put it on the account!"] },
  rope: { key: "exclaim", lines: ["Got you, sir!", "Come along quietly!", "Mind the rope, it's new!", "In the name of the Society!", "Hold still, there's a good chap!"] },
  boot: { key: "boast", lines: ["This is Pall Mall!", "Off you pop!", "Mind the step!", "Manners!", "Make way for the Society!"] },
  trample: { key: "exclaim", lines: ["View halloo!", "Gangway!", "Mind the horse!", "Charge, by gum!", "Sorry! Can't stop!"] },
  holdup: { key: "boast", lines: ["Hands up, there's a good fellow!", "In the name of the Society!", "Drop it, old chap!", "You are hereby civilised!", "Steady now. Steady."] },
  yield: { key: "exclaim", lines: ["Enough! Enough!", "I yield!", "Hold your fire!", "Don't shoot!", "Peace! Peace!"] },
  shield: { key: "boast", lines: ["Nobody move!", "Steady on, old chap!", "He's with me!", "Mind your colleague!", "Diplomatic immunity!"] },
  grudge: { key: "exclaim", lines: ["You! I remember you!", "We meet again!", "Remember me, do you?", "I've been practising!", "Not so clever now!"] },
  finisher: { key: "boast", lines: ["And stay down!", "Fair and square, old chap!", "My compliments to your mother!", "That's quite enough of that!", "Do mind the boots!"] },
};

/** The line and its babble for a bark: deterministic in (kind, salt), so every client in the party shows the same words for the same moment. */
export function barkLine(kind: BarkKind, salt: number): { text: string; key: BabbleKey } {
  const b = BARK_LINES[kind];
  return { text: b.lines[hash3(salt >>> 0, kind.length, 0xba4) % b.lines.length]!, key: b.key };
}

/** The babble shape for a spoken line from its punctuation (a parley speaker): a question rises, an exclamation is short and high, the rest is a boast. */
export function babbleKeyFor(line: string): BabbleKey {
  const t = line.trim();
  if (t.endsWith("?")) return "question";
  if (t.endsWith("!")) return "exclaim";
  return t.length < 28 ? "harrumph" : "boast";
}

/** Server-side spacing: a speaker barks at most once in this many seconds, the party at most once in `PARTY_GAP_S` (a fight is a few voices, not a choir). */
export const BARK_GAP_S = 5;
export const PARTY_GAP_S = 1.5;
