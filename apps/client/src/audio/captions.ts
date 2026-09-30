import { bearingWord, type SpatialOut } from "./spatial.ts";

/**
 * Captions for the sounds that matter to play: the ones a Deaf or hard-of-hearing player (or someone with the sound off) would otherwise miss.
 * Pure selection logic; the DOM lives in ui/Captions.ts. Written in the telegram idiom, in brackets, with the bearing the sound came from.
 */

interface CaptionDef {
  text: string;
  /** Sounds heard beyond this range get no caption. */
  range: number;
  /** Seconds before the same caption can appear again. */
  gap: number;
  /** Positional captions carry a bearing. Non-positional sounds (UI, your own hurt) never do. */
  bearing: boolean;
}

const D = (text: string, range = 80, gap = 0.6, bearing = true): CaptionDef => ({ text, range, gap, bearing });

export const CAPTIONS: Readonly<Record<string, CaptionDef>> = {
  musket_shot: D("musket shot"),
  pistol_shot: D("pistol shot"),
  blunderbuss_shot: D("blunderbuss"),
  cannon_shot: D("cannon fire", 400, 1),
  explosion: D("explosion", 400, 1),
  sabre_hit: D("steel on steel", 30, 0.5),
  hurt: D("a cry of pain", 35, 0.8),
  down: D("someone goes down", 35, 1.2),
  limb_sever: D("a limb parts company", 35, 1.2),
  notice: D("telegram bell", 1e9, 2, false),
  telegram_bell: D("telegram bell", 1e9, 2, false),
  revive_done: D("comrade revived", 40, 1.5),
  thunder: D("thunder", 1e9, 3, false),
  pickup: D("something lifted", 8, 0.8),
};

/** `[musket shot, left]`; null when the sound has no caption, is out of range, or (for positional sounds) is right on top of you. */
export function captionFor(name: string, rel: Pick<SpatialOut, "dist" | "az"> | null): string | null {
  const def = CAPTIONS[name];
  if (!def) return null;
  if (rel && rel.dist > def.range) return null;
  const far = rel !== null && rel.dist > 60 ? "distant " : "";
  if (!def.bearing || rel === null || rel.dist < 1.2) return `[${far}${def.text}]`;
  return `[${far}${def.text}, ${bearingWord(rel.az)}]`;
}

/** Per-name cool-down so a volley is a handful of lines, not fifty. Allocation-free after a name has been seen once. */
export class CaptionGate {
  private readonly last = new Map<string, number>();
  accept(name: string, now: number): boolean {
    const def = CAPTIONS[name];
    if (!def) return false;
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < def.gap) return false;
    this.last.set(name, now);
    return true;
  }
  reset(): void {
    this.last.clear();
  }
}
