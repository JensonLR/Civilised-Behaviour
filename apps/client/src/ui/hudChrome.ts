import { bindPrompt } from "../input/glyphDom.ts";
import type { InputDevice } from "../input/devices.ts";
import { SAVE_NOTE, saveLabel, type SaveStatus } from "../net/saveStatus.ts";

/**
 * The parts of the in-game HUD that are not the gauge and the cards: the expedition number with its "Copy invite" button (top right) and the line of
 * hints (bottom right). The hints are prompt tokens (input/glyphDom.ts): they take the glyphs of the device in use and the player's own bindings, and are rewritten
 * when a key is rebound or the player picks up the other device. Returns a function that removes
 * both and stops listening (leaving an expedition, tests). The bar also carries the "Saved" line (D-039): `status` is where the save stands now, `subscribe` follows it; both are optional
 * (the demo saves nothing and shows no line). The line is honest: it says "Not saved" when the server keeps nothing or the last attempt failed.
 */
export interface SaveFeed {
  status(): SaveStatus;
  subscribe(fn: (s: SaveStatus) => void): () => void;
}

export function buildHudChrome(hud: HTMLElement, code: string, link: string, saves?: SaveFeed): () => void {
  const bar = document.createElement("div");
  bar.className = "codebar";
  bar.innerHTML = `<span>Expedition No. <b></b></span><span class="saveline" hidden></span><button type="button">Copy invite</button>`;
  bar.querySelector("b")!.textContent = code;
  const line = bar.querySelector<HTMLElement>(".saveline")!;
  const drawSave = (s: SaveStatus): void => {
    const text = saveLabel(s, undefined, true);
    line.hidden = text === "";
    line.textContent = text;
    line.dataset.state = s.kind;
    line.title = `${saveLabel(s)}. ${SAVE_NOTE}`;
  };
  const offSave = saves ? saves.subscribe(drawSave) : undefined;
  if (saves) drawSave(saves.status());
  const button = bar.querySelector("button")!;
  let timer = 0;
  button.addEventListener("click", () => {
    void navigator.clipboard?.writeText(link);
    button.textContent = "Copied";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (button.textContent = "Copy invite"), 2500);
  });
  hud.prepend(bar);
  const help = document.createElement("div");
  help.className = "help";
  const hints = (device: InputDevice): string =>
    device === "touch"
      ? "" // (the on-screen buttons carry their own words: D-049)
      : device === "keyboard"
      ? "{pause} pause · F1 manual · {move} move · {sprint} sprint · {jump} jump · {crouch} crouch · {view} view"
      : "{pause} pause · {move} move · {jump} jump · {aim} aim · {fire} fire · {interact} use · {view} view";
  const offHints = bindPrompt(help, hints);
  hud.append(help);
  return () => {
    offHints();
    offSave?.();
    window.clearTimeout(timer);
    bar.remove();
    help.remove();
  };
}
