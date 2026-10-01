import { onSettingChange } from "../settings.ts";
import { deviceTracker, glyphFor, PROMPT_IDS, wireGlyphPreference, type InputDevice, type PromptId } from "./devices.ts";
import "../ui/glyphs.css";

/**
 * Prompts in the DOM (D-038, package I). A prompt string may hold tokens: `{interact}`, `{fire}`, `{move}` (any `PromptId`; `{use}` is an alias of `{interact}`). `fillPrompt` swaps each
 * token for a glyph element of the device in use (a `<kbd>` key cap, or a pad glyph shaped by CSS: `.glyph-xbox-x`, `.glyph-ps-square`, `.glyph-bumper`...), and `bindPrompt` keeps it
 * current when the player picks up another device or rebinds a key. NO module in `ui/` writes a key name itself (a test scans for it): it writes a token. Text outside tokens is set as TEXT.
 */

const ALIAS: Readonly<Record<string, PromptId>> = { use: "interact" };
const TOKEN = /\{([a-zA-Z]+)\}/g;
const IDS: ReadonlySet<string> = new Set(PROMPT_IDS);

function resolveId(name: string): PromptId | undefined {
  const id = ALIAS[name] ?? name;
  return IDS.has(id) ? (id as PromptId) : undefined;
}

/** One glyph element: a key cap on the keyboard, a shaped pad button on a pad. Its text is the label; its `aria-label` is the long name (and says "hold" for a held control). */
export function glyphEl(prompt: PromptId, device: InputDevice, doc: Document = document): HTMLElement {
  const g = glyphFor(prompt, device);
  if (g.kind === "key") {
    const k = doc.createElement("kbd");
    k.className = "glyph glyph-key";
    k.dataset.prompt = prompt;
    k.setAttribute("aria-label", g.name);
    k.textContent = g.label;
    return k;
  }
  const s = doc.createElement("span");
  s.className = `glyph glyph-${g.shape}${g.hold ? " hold" : ""}`;
  s.dataset.prompt = prompt;
  s.dataset.control = g.control;
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", g.hold ? `hold ${g.name}` : g.name);
  s.textContent = g.label;
  return s;
}

/** The plain-text form of a prompt string for `device` (tokens become their label), for tests, tooltips and `aria-label`s. Unknown tokens stay as written. */
export function promptPlain(text: string, device: InputDevice = deviceTracker.effective): string {
  return text.replace(TOKEN, (whole, name: string) => {
    const id = resolveId(name);
    return id ? glyphFor(id, device).label : whole;
  });
}

/** Does `text` mention a prompt token? */
export const hasPromptToken = (text: string): boolean => {
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) if (resolveId(m[1]!)) return true;
  return false;
};

/** Fills `target` with `text`, tokens replaced by glyph elements for `device`. Skips the DOM write when nothing changed (cheap to call every frame). */
export function fillPrompt(target: HTMLElement, text: string, device: InputDevice = deviceTracker.effective): void {
  const key = `${device}\u0001${glyphsStamp}\u0001${text}`;
  if (target.dataset.promptKey === key) return;
  target.dataset.promptKey = key;
  const doc = target.ownerDocument;
  const parts: (string | Node)[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const id = resolveId(m[1]!);
    if (!id) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(glyphEl(id, device, doc));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  target.replaceChildren(...parts);
  target.setAttribute("data-device", device);
}

/** Bumped when a binding changes, so a cached render of the same text is rebuilt. */
let glyphsStamp = 0;

/**
 * Renders `build(device)` into `target` now and again whenever the device in use or a binding changes. Returns the function that stops it (call it when the element goes away).
 * `build` returns prompt text (tokens allowed); it is the module's own copy, so it may differ per device ("Hold {interact} to revive" is the same on both).
 */
export function bindPrompt(target: HTMLElement, build: (device: InputDevice) => string): () => void {
  const render = (): void => fillPrompt(target, build(deviceTracker.effective), deviceTracker.effective);
  render();
  return onPromptChange(render);
}

/** Calls `fn` whenever the device in use or a binding changes (for a module that renders several lines itself). Returns the unsubscribe function. Does not call `fn` now. */
export function onPromptChange(fn: (device: InputDevice) => void): () => void {
  const off1 = deviceTracker.onChange(fn);
  const off2 = onSettingChange((k) => (k === "bindings" || k === "padBindings" || k === "glyphs" || k === "all") && fn(deviceTracker.effective));
  return () => {
    off1();
    off2();
  };
}

// The root element carries the device in use, so CSS can show or hide what only fits one (`.kb-only`, `.pad-only`).
if (typeof document !== "undefined") {
  const mark = (d: InputDevice): void => {
    document.documentElement.dataset.device = d;
  };
  mark(deviceTracker.effective);
  deviceTracker.onChange(mark);
}
onSettingChange((k) => {
  if (k === "bindings" || k === "padBindings" || k === "all") glyphsStamp++;
});

// the player's `glyphs` setting (and `?glyphs=xbox|playstation|keyboard` for stills) pins the tracker as soon as any prompt can be drawn, with no game wiring
if (typeof document !== "undefined") wireGlyphPreference();

/** Re-exports so a UI module needs one import for prompts. */
export { deviceTracker };
export type { InputDevice, PromptId };
