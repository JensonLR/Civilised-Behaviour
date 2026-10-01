import { bindPrompt } from "../input/glyphDom.ts";
import type { InputDevice } from "../input/devices.ts";

/**
 * The parts of the in-game HUD that are not the gauge and the cards: the expedition number with its "Copy invite" button (top right) and the line of
 * hints (bottom right). The hints are prompt tokens (input/glyphDom.ts): they take the glyphs of the device in use and the player's own bindings, and are rewritten
 * when a key is rebound or the player picks up the other device. Returns a function that removes
 * both and stops listening (leaving an expedition, tests).
 */
export function buildHudChrome(hud: HTMLElement, code: string, link: string): () => void {
  const bar = document.createElement("div");
  bar.className = "codebar";
  bar.innerHTML = `<span>Expedition No. <b></b></span><button type="button">Copy invite</button>`;
  bar.querySelector("b")!.textContent = code;
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
    device === "keyboard"
      ? "{pause} pause · F1 manual · {move} move · {sprint} sprint · {jump} jump · {crouch} crouch · {view} view"
      : "{pause} pause · {move} move · {jump} jump · {aim} aim · {fire} fire · {interact} use · {view} view";
  const offHints = bindPrompt(help, hints);
  hud.append(help);
  return () => {
    offHints();
    window.clearTimeout(timer);
    bar.remove();
    help.remove();
  };
}
