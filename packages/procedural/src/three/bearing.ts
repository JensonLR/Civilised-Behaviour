import { PALETTE } from "@cb/shared";
import * as C from "../catalog.ts";
import type { CharacterSpec } from "../spec.ts";

/**
 * D-066: BEARING, how a body carries itself when it stands about: its resting stance, the small things it does with its hands, the roll of its walk. The Society's caricatures check
 * pocket watches and touch their hat brims; the peoples never did, and until now every native stood and fidgeted exactly like an explorer. A bearing is read from the DRESS (a people's
 * own garment, or failing that its hat): a native always wears one (peoples.ts), and a player never can (spec.ts `societyDress`), so the split needs no field on the wire and cannot
 * disagree with what the figure wears. Pure data and one lookup; the animator applies it.
 */
export type BearingId = "society" | "mereborn" | "kessarine" | "marchers" | "vesperine" | "brinefolk";
/** A resting pose for the arms: hang (as they fall), clasp (hands together in front at the waist), fold (arms folded high), akimbo (hands on the hips), behind (hands clasped at the back). */
export type Stance = "hang" | "clasp" | "fold" | "akimbo" | "behind";
/** The animator's idle acts (animator.ts IDLE_ACTS), by name. */
export type IdleActName = "look" | "shrug" | "hat" | "watch" | "behind" | "stretch" | "shuffle" | "scratch" | "lookUp" | "tap" | "sway";

export interface Bearing {
  stance: Stance;
  /** The small actions this body picks from when it has stood still a while. */
  acts: readonly IdleActName[];
  /** Multiplies the walk's side-to-side roll of the hips (a wader's roll, a lamp-keeper's glide). */
  roll: number;
  /** Head pitch at rest, radians (+ bows the head; - lifts the chin). */
  bow: number;
  /**
   * D-067: what the land does to the cloth. The hem of a people's garment fades into its ground (river mud, delta silt, coastal sand, savannah dust, red canyon dust) by `amount`
   * at the very hem, thinning to nothing a third of the way up. The Society's coats are pressed by a valet; theirs is undefined.
   */
  wear?: { color: number; amount: number };
}

export const BEARINGS: Readonly<Record<BearingId, Bearing>> = {
  // (the explorers keep every habit they had: the watch, the brim, the hands behind the back)
  society: { stance: "hang", acts: ["look", "shrug", "hat", "watch", "behind", "stretch", "shuffle", "scratch", "lookUp", "tap", "sway"], roll: 1, bow: 0 },
  // stone-cutters at their own pace: arms folded, a stretch for the back, a shrug for the Society
  mereborn: { stance: "fold", acts: ["look", "shrug", "stretch", "scratch", "sway"], roll: 1.2, bow: 0, wear: { color: PALETTE.world.mud, amount: 0.75 } },
  // lamp-keepers: upright, hands together at the waist, an eye on the sky; they glide
  kessarine: { stance: "clasp", acts: ["look", "lookUp", "sway"], roll: 0.45, bow: -0.06, wear: { color: PALETTE.kessar.sand, amount: 0.7 } },
  // herders: hands behind the back like a man surveying his own field, a tapping foot, a look at the weather
  marchers: { stance: "behind", acts: ["look", "lookUp", "tap", "shuffle", "stretch"], roll: 1.4, bow: 0, wear: { color: PALETTE.world.dust, amount: 0.65 } },
  // mourners: head bowed, hands clasped low, and very little else
  vesperine: { stance: "clasp", acts: ["look", "sway"], roll: 0.8, bow: 0.2, wear: { color: PALETTE.vesper.strataRust, amount: 0.7 } },
  // waders: hands on the hips, a rolling walk, a shrug and a scratch
  brinefolk: { stance: "akimbo", acts: ["shrug", "scratch", "sway", "shuffle", "look"], roll: 2.2, bow: 0, wear: { color: PALETTE.saltmarket.silt, amount: 0.8 } },
};

const BY_JACKET: Readonly<Record<string, BearingId>> = { "Stone Smock": "mereborn", "Lamp Robe": "kessarine", "Herd Cloak": "marchers", "Crepe Shawl": "vesperine", "Wading Smock": "brinefolk" };
const BY_HAT: Readonly<Record<string, BearingId>> = { "Reed Brim": "mereborn", "Lamp Hood": "kessarine", "Sheaf Hat": "marchers", "Dust Wrap": "vesperine", "Tide Hat": "brinefolk", "Net Cap": "brinefolk", "Bell Crown": "marchers", "Tiered Hat": "mereborn" };

/** Whose bearing a figure has, from its dress (the garment first; a grand Court Cloak is told by its hat; anything else, and every player, is the Society's). */
export function bearingOf(spec: CharacterSpec): BearingId {
  const j = BY_JACKET[C.JACKETS[spec.jacket] ?? ""];
  if (j) return j;
  const native = (C.JACKETS[spec.jacket] ?? "") === "Court Cloak" || (C.TROUSERS[spec.trousers] ?? "") === "Wrap Skirt";
  const h = BY_HAT[C.HATS[spec.hat] ?? ""];
  return h ?? (native ? "mereborn" : "society");
}
