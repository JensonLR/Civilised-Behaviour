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

// ---- severed limbs -------------------------------------------------------------------------------------------------------------------
// Two separate choices. The CAMPAIGN rule (whether limbs can come off at all) belongs to whoever founds the expedition and is enforced by the
// server. The PERSONAL setting (whether you SEE stumps and flying limbs) belongs to each player: with it hidden the same injuries show as
// the ordinary grievous-wound dressings, and gameplay is identical for everyone.

const readFlag = (key: string, param: string, fallback: boolean): boolean => {
  try {
    const v = new URLSearchParams(location.search).get(param) ?? localStorage.getItem(key);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    /* storage or location unavailable: default */
  }
  return fallback;
};
const writeFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
};

let showLimbs: boolean | undefined;
/** Personal: show stumps and flying limbs. */
export function getShowLimbs(): boolean {
  return (showLimbs ??= readFlag("cb.showLimbs", "limbs", true));
}
export function setShowLimbs(on: boolean): void {
  showLimbs = on;
  writeFlag("cb.showLimbs", on);
}

/** Campaign rule offered when founding an expedition (the server decides; joiners inherit it). */
export const getCampaignLimbLoss = (): boolean => readFlag("cb.campaignLimbLoss", "campaignLimbs", true);
export const setCampaignLimbLoss = (on: boolean): void => writeFlag("cb.campaignLimbLoss", on);
