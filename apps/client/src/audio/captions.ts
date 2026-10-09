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
  crank_shot: D("crank gun fire"),
  bellow: D("a beast bellows", 160, 1.2),
  explosion: D("explosion", 400, 1),
  bridge_collapse: D("the bridge collapses", 520, 1),
  sabre_hit: D("steel on steel", 30, 0.5),
  hurt: D("a cry of pain", 35, 0.8),
  down: D("someone goes down", 35, 1.2),
  limb_sever: D("a limb parts company", 35, 1.2),
  notice: D("telegram bell", 1e9, 2, false),
  telegram_bell: D("telegram bell", 1e9, 2, false),
  revive_done: D("comrade revived", 40, 1.5),
  thunder: D("thunder", 1e9, 3, false),
  pickup: D("something lifted", 8, 0.8),
  // the expedition's world (D-035): every new sound has one; a keyed sound may have a line per key (`name:key`), else the plain `name` line serves
  hoof: D("hoofbeats", 45, 2.5),
  tack_jingle: D("tack jingling", 14, 2),
  sail_creak: D("the ship creaks and slops", 1e9, 8, false),
  gull: D("a gull cries", 1e9, 6, false),
  paper_rustle: D("paper rustles", 25, 2),
  bell: D("a bell tolls", 450, 3),
  "bell:hq": D("the day bell tolls at camp", 450, 3),
  "bell:outpost": D("an outpost bell rings", 300, 3),
  parley_stamp: D("a rubber stamp falls", 1e9, 1, false),
  fanfare: D("a brass fanfare for the Empire", 1e9, 2.5, false),
  crew_shout: D("the gun crew shouts", 70, 1.5),
  wagon_roll: D("a wagon rattles along", 40, 3),
  "wagon_roll:creak": D("a wagon creaks", 25, 3),
  "crew_shout:stand_clear": D('the gun crew: "Stand clear!"', 70, 1.5),
  "crew_shout:loading": D('the gun crew: "Loading!"', 70, 1.5),
  "crew_shout:fire": D('the gun crew: "Fire!"', 70, 1.5),
  // the grit pass (D-038, A): every new sound has a line; the gore ones read the same at every Gore setting (the words never depend on the mess)
  gore_flesh_heavy: D("a heavy blow lands", 40, 0.6),
  gore_flesh_light: D("a blow lands", 30, 0.8),
  gore_bone: D("something cracks", 35, 0.8),
  "gore_bone:off": D("a wooden knock", 35, 0.8),
  gore_sever_wet: D("a messy parting", 35, 1.2),
  "gore_sever_wet:off": D("a rubbery boing", 35, 1.2),
  gore_blood_ground: D("a splash on the ground", 12, 1.5),
  "gore_blood_ground:off": D("a soft pat on the ground", 12, 1.5),
  gore_body_fall: D("a body falls", 40, 1.2),
  gore_bad_breath: D("a rattling breath", 14, 3),
  "gore_bad_breath:off": D("a long wheeze", 14, 3),
  impact_splinter: D("wood splinters", 40, 0.6),
  impact_chip: D("stone chips", 40, 0.6),
  impact_ring: D("metal rings", 50, 0.8),
  impact_splash: D("a splash", 30, 0.8),
  foley_cloth: D("cloth rustles", 8, 4),
  foley_gear: D("gear clinks", 10, 4),
  foley_holster: D("a weapon is holstered", 14, 1.5),
  foley_draw: D("a weapon is drawn", 20, 1.5),
  foley_ramrod: D("a ramrod scrapes", 18, 3),
  foley_powder: D("powder is poured", 14, 3),
  foley_cock: D("a hammer is cocked", 20, 1.5),
  foley_shell: D("a casing drops", 8, 2),
  footstep_mud: D("boots in mud", 10, 6),
  footstep_sand: D("boots in sand", 10, 6),
  explosion_tail: D("the blast rolls away", 500, 3),
  "explosion_tail:cannon": D("the shot echoes off the hills", 500, 3),
  amb_mill: D("the mill wheel turns", 100, 30),
  amb_lamp_chain: D("lamps clink on their chains", 100, 30),
  amb_herd_bell: D("herd bells clonk", 130, 30),
  amb_far_horn: D("a far horn sounds", 600, 40),
  amb_drip: D("water drips", 40, 40),
  amb_timber_creak: D("timber groans", 70, 30),
  amb_halyard: D("rigging taps a mast", 80, 30),
  amb_wind_pump: D("a wind-pump clanks", 100, 30),
  amb_frog: D("frogs croak", 90, 40),
  amb_surf: D("surf breaks on the shore", 220, 40),
  amb_lap: D("water laps", 60, 40),
  amb_gust: D("wind gusts through the grass", 140, 40),
  "amb_gust:canyon": D("wind moans in the gorge", 140, 40),
};

/** The caption line a sound plays under: its `name:key` line when it has one, else its plain `name` line. */
export const captionName = (name: string, key?: string): string => (key !== undefined && CAPTIONS[`${name}:${key}`] !== undefined ? `${name}:${key}` : name);

/** `[musket shot, left]`; null when the sound has no caption, is out of range, or (for positional sounds) is right on top of you. */
export function captionFor(name: string, rel: Pick<SpatialOut, "dist" | "az"> | null, key?: string): string | null {
  const def = CAPTIONS[captionName(name, key)];
  if (!def) return null;
  if (rel && rel.dist > def.range) return null;
  const far = rel !== null && rel.dist > 60 ? "distant " : "";
  if (!def.bearing || rel === null || rel.dist < 1.2) return `[${far}${def.text}]`;
  return `[${far}${def.text}, ${bearingWord(rel.az)}]`;
}

/** Per-name cool-down so a volley is a handful of lines, not fifty. Allocation-free after a name has been seen once. */
export class CaptionGate {
  private readonly last = new Map<string, number>();
  accept(name: string, now: number, key?: string): boolean {
    const line = captionName(name, key);
    const def = CAPTIONS[line];
    if (!def) return false;
    const prev = this.last.get(line);
    if (prev !== undefined && now - prev < def.gap) return false;
    this.last.set(line, now);
    return true;
  }
  reset(): void {
    this.last.clear();
  }
}
