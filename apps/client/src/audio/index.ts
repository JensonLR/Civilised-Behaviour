import { getCaptions, getGore, getMuteUnfocused, getVolume, onSettingChange, VOLUME_KEYS } from "../settings.ts";
import { ambience } from "./ambience.ts";
import { engine, type AudioState, type PlayOpts } from "./engine.ts";
import { music } from "./music.ts";
import type { MusicMode } from "./musicScore.ts";
import { stepVolume } from "./stride.ts";
import type { Surface } from "./surface.ts";
import type { VolumeChannel } from "./volume.ts";

/**
 * Public surface of the audio system (design, sound list and weak spots: docs/_notes/audio-ui.md).
 *
 * Everything is synthesised at runtime (no audio files), created lazily on the first user gesture, and safe to call when there is no
 * AudioContext at all: nothing here throws, and captions (which do not need sound) keep working.
 */
export type { AudioState, PlayOpts } from "./engine.ts";
export type { MusicMode } from "./musicScore.ts";
export type { Surface } from "./surface.ts";

let wired = false;
/** Reads the saved volumes/toggles into the engine and keeps them in step with the settings screen. Idempotent. */
function wire(): void {
  if (wired) return;
  wired = true;
  const sync = (): void => {
    for (const k of VOLUME_KEYS) engine.volumes[k] = getVolume(k);
    engine.muteUnfocused = getMuteUnfocused();
    engine.captionsOn = getCaptions();
    engine.applyVolumes();
  };
  sync();
  onSettingChange(sync);
}

/** Plays a sound effect by name. `opts.x/y/z` places it in the world (relative to the listener); without them it is heard in the centre. */
export function playSfx(name: string, opts?: PlayOpts): void {
  wire();
  if (name === "limb_sever" && opts?.key === undefined) opts = { ...opts, key: getGore() };
  engine.play(name, opts);
}

/** Stops a looping sound (`revive_hold`) at once instead of waiting for it to lapse. */
export function stopSfx(name: string): void {
  engine.stop(name);
}

/** Where the player is and which way the camera faces (yaw as CameraRig reports it). Call once a frame; it only stores four numbers. */
export function setListener(pos: { x: number; y: number; z: number }, yaw: number): void {
  const l = engine.listener;
  l.x = pos.x;
  l.y = pos.y;
  l.z = pos.z;
  l.yaw = yaw;
}

/** Slider positions (0..1); the engine applies a squared curve. The settings screen calls the setters in settings.ts, which reach here through onSettingChange. */
export function setMasterVolume(v: number): void {
  engine.setVolume("master", v);
}
export function setChannelVolume(channel: Exclude<VolumeChannel, "master">, v: number): void {
  engine.setVolume(channel, v);
}

export function startAmbience(): void {
  wire();
  resumeOnGesture();
  ambience.start();
}
export function stopAmbience(): void {
  ambience.stop();
}

export function startMusic(mode: MusicMode): void {
  wire();
  resumeOnGesture();
  music.start(mode);
}
export function stopMusic(): void {
  music.stop();
}

/** Installs the one-shot gesture listeners that create and resume the AudioContext. Safe to call any number of times. */
export function resumeOnGesture(): void {
  wire();
  engine.resumeOnGesture();
}

/** One footfall on `surface` at `speed` m/s (louder when faster). Cadence is the caller's: see Stride in stride.ts and game/GameAudio.ts. */
export function footstep(surface: Surface, speed: number, opts?: PlayOpts & { crouching?: boolean }): void {
  playSfx(`footstep_${surface}`, { ...opts, volume: (opts?.volume ?? 1) * stepVolume(speed, opts?.crouching ?? false) });
}

/** Subscribes to caption text for key sounds ("[musket shot, left]"). Returns the unsubscribe function. */
export function onCaption(fn: (text: string) => void): () => void {
  wire();
  engine.captionSinks.push(fn);
  return () => {
    engine.captionSinks = engine.captionSinks.filter((s) => s !== fn);
  };
}

/** Shows a caption without playing anything (the settings screen's preview). */
export function previewCaption(text: string): void {
  for (const s of engine.captionSinks) s(text);
}

export function audioState(): AudioState {
  return engine.state;
}

let uiBound = false;
/**
 * Clicks, hovers and focus moves inside `root` make the interface sounds: brass tick on a button, paper tick on hover/focus, a stamp for
 * `.primary`. One delegated listener per root, no per-element wiring.
 */
export function attachUiSounds(root: HTMLElement): void {
  wire();
  resumeOnGesture();
  if (uiBound && root.dataset.uiSounds) return;
  root.dataset.uiSounds = "1";
  uiBound = true;
  const target = (e: Event): HTMLElement | null => (e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("button, select, input, [role=tab]") : null);
  root.addEventListener("click", (e) => {
    const t = target(e);
    if (!t || (t as HTMLButtonElement).disabled) return;
    if (t.matches("button.primary")) playSfx("ui_confirm");
    else if (t.matches("input[type=range]")) return;
    else playSfx("ui_click");
  });
  let lastHover: Element | null = null;
  root.addEventListener("pointerover", (e) => {
    const t = target(e);
    if (t && t !== lastHover && !(t as HTMLButtonElement).disabled) playSfx("ui_hover");
    lastHover = t;
  });
  root.addEventListener("focusin", (e) => {
    const t = target(e);
    if (t && (e.target as HTMLElement).matches(":focus-visible")) playSfx("ui_hover");
  });
}

/** Dev/test hook: the engine, for reading voice counts and the bank. Not part of the game's API. */
export const __engine = engine;
