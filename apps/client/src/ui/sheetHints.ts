import { bindPrompt } from "../input/glyphDom.ts";

/**
 * The one-line pad hint under a sheet ("A Choose   B Close   LB RB Page"): shown only while a pad is the device in use (`.pad-only`), written with prompt tokens so it follows the family
 * (Xbox or PlayStation) and a change of device with no reload. The sheets (pause, how-to, newspaper, loadout, map room, parley) each put one in their panel. Returns the element and the
 * function that stops it following the device.
 */
export interface SheetHints {
  readonly el: HTMLElement;
  dispose(): void;
}

export function sheetHints(opts: { tabs?: boolean; choose?: string; close?: string } = {}): SheetHints {
  const el = document.createElement("p");
  el.className = "hintbar pad-only";
  el.setAttribute("aria-hidden", "true"); // a visual aid: the controls are all reachable and named without it
  const choose = opts.choose ?? "Choose";
  const close = opts.close ?? "Close";
  const off = bindPrompt(el, () => `{confirm} ${choose}   {cancel} ${close}${opts.tabs ? "   {tabPrev} {tabNext} Page" : ""}`);
  return { el, dispose: off };
}
