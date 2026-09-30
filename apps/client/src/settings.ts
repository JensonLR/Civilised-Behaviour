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
  emitSetting("gore");
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
  emitSetting("showLimbs");
}

/** Campaign rule offered when founding an expedition (the server decides; joiners inherit it). */
export const getCampaignLimbLoss = (): boolean => readFlag("cb.campaignLimbLoss", "campaignLimbs", true);
export const setCampaignLimbLoss = (on: boolean): void => writeFlag("cb.campaignLimbLoss", on);

// ---- camera ----------------------------------------------------------------------------------------------------------------------------
// Third person is the default. `?view=first` (or `third`) overrides for the session without touching the saved choice, like `?gore=`.

export type ViewMode = "third" | "first";
export const VIEW_MODES: readonly ViewMode[] = ["third", "first"];
const isView = (v: unknown): v is ViewMode => v === "third" || v === "first";

let view: ViewMode | undefined;
export function getView(): ViewMode {
  if (view) return view;
  let v: unknown;
  try {
    v = new URLSearchParams(location.search).get("view") ?? localStorage.getItem("cb.view");
  } catch {
    /* storage or location unavailable: default */
  }
  view = isView(v) ? v : "third";
  return view;
}
export function setView(mode: ViewMode): void {
  view = mode;
  try {
    localStorage.setItem("cb.view", mode);
  } catch {
    /* ignore */
  }
  emitSetting("view");
}

let headBob: boolean | undefined;
/**
 * First-person head bob. Defaults to on, or off for players whose system asks for reduced motion; an explicit choice (menu, or
 * `?headbob=0|1`) always wins over that default.
 */
export function getHeadBob(): boolean {
  if (headBob !== undefined) return headBob;
  let reduced = false;
  try {
    reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    /* no matchMedia: assume motion is fine */
  }
  return (headBob = readFlag("cb.headBob", "headbob", !reduced));
}
export function setHeadBob(on: boolean): void {
  headBob = on;
  writeFlag("cb.headBob", on);
  emitSetting("headBob");
}

// =====================================================================================================================================
// Change notification and the generic value kinds. Everything below persists the same way as the settings above: a `?param=` URL override
// for the session (tests, screenshots) that never touches the saved choice, then localStorage, then the default; every read and write is
// guarded because storage can be blocked. `onSettingChange` lets the audio engine, the camera, the stage and the DOM follow a change live.
// =====================================================================================================================================

const listeners = new Set<(key: string) => void>();
const resets: (() => void)[] = [];

/** Subscribes to every setting change (the key is the setting's id, or "all" after a reset). Returns the unsubscribe function. */
export function onSettingChange(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitSetting(key: string): void {
  for (const fn of [...listeners]) {
    try {
      fn(key);
    } catch (e) {
      console.warn("setting listener failed", key, e);
    }
  }
}
/** Registers something to undo when the player picks "restore defaults" (used by the key bindings). */
export function registerReset(fn: () => void): void {
  resets.push(fn);
}

export function readStored(key: string, param?: string): string | null {
  try {
    const fromUrl = param ? new URLSearchParams(location.search).get(param) : null;
    return fromUrl ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const clampTo = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface NumSetting {
  get(): number;
  set(v: number): void;
  reset(): void;
  readonly def: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}
function numSetting(id: string, key: string, param: string | undefined, def: number, min: number, max: number, step: number): NumSetting {
  let v: number | undefined;
  const s: NumSetting = {
    def, min, max, step,
    get() {
      if (v === undefined) {
        const raw = readStored(key, param);
        const n = raw === null || raw === "" ? NaN : Number(raw);
        v = Number.isFinite(n) ? clampTo(n, min, max) : def;
      }
      return v;
    },
    set(n) {
      v = clampTo(Number.isFinite(n) ? n : def, min, max);
      writeStored(key, String(v));
      emitSetting(id);
    },
    reset() {
      v = def;
      writeStored(key, null);
      emitSetting(id);
    },
  };
  resets.push(() => (v = def, writeStored(key, null)));
  return s;
}

interface FlagSetting {
  get(): boolean;
  set(on: boolean): void;
  reset(): void;
}
function flagSetting(id: string, key: string, param: string | undefined, def: () => boolean): FlagSetting {
  let v: boolean | undefined;
  const s: FlagSetting = {
    get() {
      if (v === undefined) {
        const raw = readStored(key, param);
        v = raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : def();
      }
      return v;
    },
    set(on) {
      v = on;
      writeStored(key, on ? "1" : "0");
      emitSetting(id);
    },
    reset() {
      v = undefined;
      writeStored(key, null);
      emitSetting(id);
    },
  };
  resets.push(() => (v = undefined, writeStored(key, null)));
  return s;
}

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
};

// ---- audio -----------------------------------------------------------------------------------------------------------------------------

export type VolumeKey = "master" | "music" | "sfx" | "ambience";
export const VOLUME_KEYS: readonly VolumeKey[] = ["master", "music", "sfx", "ambience"];
const volumes: Record<VolumeKey, NumSetting> = {
  master: numSetting("vol.master", "cb.vol.master", "vol", 0.8, 0, 1, 0.05),
  music: numSetting("vol.music", "cb.vol.music", "musicvol", 0.6, 0, 1, 0.05),
  sfx: numSetting("vol.sfx", "cb.vol.sfx", "sfxvol", 0.9, 0, 1, 0.05),
  ambience: numSetting("vol.ambience", "cb.vol.ambience", "ambvol", 0.8, 0, 1, 0.05),
};
/** Slider position 0..1 for a channel (the audio engine squares it into a gain, see audio/volume.ts). */
export const getVolume = (k: VolumeKey): number => volumes[k].get();
export const setVolume = (k: VolumeKey, v: number): void => volumes[k].set(v);
export const volumeSpec = (k: VolumeKey): NumSetting => volumes[k];

const muteUnfocused = flagSetting("muteUnfocused", "cb.muteUnfocused", "muteblur", () => true);
export const getMuteUnfocused = (): boolean => muteUnfocused.get();
export const setMuteUnfocused = (on: boolean): void => muteUnfocused.set(on);

// ---- video -----------------------------------------------------------------------------------------------------------------------------

/**
 * Graphics presets. `test` is NOT a player option: it is the software-renderer preset for the e2e suite and headless tooling (`?gfx=test`; no
 * shadows, sky clouds, ground cover, ambient life or villagers, see `PRESETS.test`), so the Settings screen lists `GFX_PLAYER_LEVELS` only.
 */
export type Gfx = "low" | "medium" | "high" | "test";
export const GFX_PLAYER_LEVELS: readonly Gfx[] = ["low", "medium", "high"];
export const GFX_LEVELS: readonly Gfx[] = [...GFX_PLAYER_LEVELS, "test"];
let gfx: Gfx | undefined;
/** Graphics preset. `?gfx=` overrides for the session (the e2e suite runs on `test`). */
export function getGfx(): Gfx {
  if (gfx) return gfx;
  const raw = readStored("cb.gfx", "gfx");
  gfx = raw === "low" || raw === "medium" || raw === "high" || raw === "test" ? raw : "medium";
  return gfx;
}
export function setGfx(level: Gfx): void {
  gfx = level;
  writeStored("cb.gfx", level);
  emitSetting("gfx");
}
resets.push(() => {
  gfx = undefined;
  writeStored("cb.gfx", null);
});

const uiScale = numSetting("uiScale", "cb.uiScale", "ui", 1, 0.8, 1.5, 0.05);
export const getUiScale = (): number => uiScale.get();
export const setUiScale = (v: number): void => uiScale.set(v);
export const uiScaleSpec = uiScale;

const reduceMotion = flagSetting("reduceMotion", "cb.reduceMotion", "reducemotion", prefersReducedMotion);
/** Reduced motion: no interface animation, no camera shake beyond a whisper. Defaults to the system's preference; an explicit choice wins. */
export const getReduceMotion = (): boolean => reduceMotion.get();
export const setReduceMotion = (on: boolean): void => reduceMotion.set(on);

const fov = numSetting("fov", "cb.fov", "fov", 65, 50, 100, 1);
export const getFov = (): number => fov.get();
export const setFov = (v: number): void => fov.set(v);
export const fovSpec = fov;

// ---- controls --------------------------------------------------------------------------------------------------------------------------

/** Radians of look per pixel of mouse movement at sensitivity 1.0 (what CameraRig has always used). */
export const BASE_SENSITIVITY = 0.0022;
const sensitivity = numSetting("sensitivity", "cb.sensitivity", "sens", 1, 0.25, 3, 0.05);
export const getSensitivity = (): number => sensitivity.get();
export const setSensitivity = (v: number): void => sensitivity.set(v);
export const sensitivitySpec = sensitivity;
const padSensitivity = numSetting("padSensitivity", "cb.padSensitivity", "padsens", 1, 0.25, 3, 0.05);
export const getPadSensitivity = (): number => padSensitivity.get();
export const setPadSensitivity = (v: number): void => padSensitivity.set(v);
export const padSensitivitySpec = padSensitivity;
const invertY = flagSetting("invertY", "cb.invertY", "inverty", () => false);
export const getInvertY = (): boolean => invertY.get();
export const setInvertY = (on: boolean): void => invertY.set(on);
const holdToSprint = flagSetting("holdToSprint", "cb.holdToSprint", "holdsprint", () => true);
export const getHoldToSprint = (): boolean => holdToSprint.get();
export const setHoldToSprint = (on: boolean): void => holdToSprint.set(on);

// ---- accessibility ---------------------------------------------------------------------------------------------------------------------

const cvd = flagSetting("cvd", "cb.cvd", "cvd", () => false);
/** Colour-blind-safe mode: severity charts swap red/brown fills for ink hatching and shape marks (the interface never relied on colour alone; this makes the difference obvious at a glance). */
export const getCvd = (): boolean => cvd.get();
export const setCvd = (on: boolean): void => cvd.set(on);
const highContrast = flagSetting("highContrast", "cb.highContrast", "contrast", () => false);
export const getHighContrast = (): boolean => highContrast.get();
export const setHighContrast = (on: boolean): void => highContrast.set(on);
const largeText = flagSetting("largeText", "cb.largeText", "largetext", () => false);
export const getLargeText = (): boolean => largeText.get();
export const setLargeText = (on: boolean): void => largeText.set(on);
const captions = flagSetting("captions", "cb.captions", "captions", () => false);
/** On-screen captions for the sounds that matter ("[musket shot, left]"). */
export const getCaptions = (): boolean => captions.get();
export const setCaptions = (on: boolean): void => captions.set(on);
const shake = numSetting("shake", "cb.shake", "shake", 1, 0, 1, 0.05);
export const getShake = (): number => shake.get();
export const setShake = (v: number): void => shake.set(v);
export const shakeSpec = shake;

/** Camera shake amount actually applied: the slider, and a whisper of it when motion is reduced. */
export const effectiveShake = (): number => (getReduceMotion() ? Math.min(getShake(), 0.2) : getShake());

/** Interface scale multipliers: the player's scale times a 1.2 bump for "larger text". */
export const TEXT_BUMP = 1.2;
export const rootScale = (): number => getUiScale() * (getLargeText() ? TEXT_BUMP : 1);

interface DisplayRoot {
  style: { setProperty(name: string, value: string): void };
  dataset: Record<string, string | undefined>;
}
/** Writes the display settings onto the document root as one CSS variable and a few data attributes (style.css keys everything off these). */
export function applyDisplaySettings(root: DisplayRoot = document.documentElement): void {
  root.style.setProperty("--ui-scale", String(rootScale()));
  const set = (name: string, on: boolean, value = "1"): void => {
    if (on) root.dataset[name] = value;
    else delete root.dataset[name];
  };
  set("cvd", getCvd());
  set("contrast", getHighContrast(), "high");
  set("largeText", getLargeText());
  set("motion", getReduceMotion(), "reduced");
}

/** Restores every setting in this file (and the key bindings) to its default. */
export function resetAllSettings(): void {
  for (const r of resets) r();
  gore = undefined;
  showLimbs = undefined;
  view = undefined;
  headBob = undefined;
  for (const k of ["cb.gore", "cb.showLimbs", "cb.view", "cb.headBob"]) writeStored(k, null);
  emitSetting("all");
}
