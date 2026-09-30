import { playSfx } from "../../audio/index.ts";

/**
 * The one door from combat visuals to sound. Everything here is cosmetic and fire-and-forget: a sound is placed in the world by name
 * (audio/sounds.ts owns the names) and never awaited; if the audio system is absent or throws, the game simply stays quiet.
 */
export interface SfxPos {
  x: number;
  y: number;
  z: number;
}

export const fx = {
  sound(name: string, pos?: SfxPos, volume?: number): void {
    try {
      playSfx(name, pos ? { x: pos.x, y: pos.y, z: pos.z, ...(volume === undefined ? {} : { volume }) } : volume === undefined ? undefined : { volume });
    } catch {
      /* the game must not depend on sound */
    }
  },
};

/** Sound name for the report of a weapon (see WEAPON in @cb/shared). */
export const REPORT: Record<number, string> = {
  0: "pistol_shot",
  1: "musket_shot",
  2: "blunderbuss_shot",
  5: "cannon_shot",
};

/** Impact sound by SURFACE id. */
export const IMPACT_SOUND = ["impact_earth", "impact_wood", "impact_iron", "impact_iron", "impact_earth", "impact_flesh"] as const;
