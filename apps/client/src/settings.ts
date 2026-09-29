import type { GoreLevel } from "@cb/procedural/three";

/**
 * Player-facing options that gameplay code reads every frame. Persisted per browser; a `?gore=` URL parameter overrides
 * for the session (tests, screenshots) without touching the saved choice.
 * Rule from the brief: gameplay must never depend on gore for readability, so every level keeps the same dressings and
 * timing and only changes the colour and amount of the mess.
 */
export const GORE_LEVELS: readonly GoreLevel[] = ["full", "reduced", "off"];

const isGore = (v: unknown): v is GoreLevel => typeof v === "string" && (GORE_LEVELS as readonly string[]).includes(v);

let gore: GoreLevel | undefined;

export function getGore(): GoreLevel {
  if (gore) return gore;
  let v: unknown;
  try {
    v = new URLSearchParams(location.search).get("gore") ?? localStorage.getItem("cb.gore");
  } catch {
    /* storage or location unavailable: default */
  }
  gore = isGore(v) ? v : "full";
  return gore;
}

export function setGore(level: GoreLevel): void {
  gore = level;
  try {
    localStorage.setItem("cb.gore", level);
  } catch {
    /* ignore */
  }
}
