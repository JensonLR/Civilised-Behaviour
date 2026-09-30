import { getBindings, keyLabel } from "../input/bindings.ts";
import { onSettingChange } from "../settings.ts";

/**
 * The parts of the in-game HUD that are not the gauge and the cards: the expedition number with its "Copy invite" button (top right) and the line of
 * key hints (bottom right). The hints are written from the CURRENT key bindings and rewritten when a key is rebound. Returns a function that removes
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
  const k = (id: "sprint" | "jump" | "crouch" | "view"): string => keyLabel(getBindings()[id][0]);
  const write = (): void => {
    const move = (["forward", "left", "back", "right"] as const).map((id) => keyLabel(getBindings()[id][0])).join("");
    help.textContent = `Esc pause · F1 manual · ${move} move · ${k("sprint")} sprint · ${k("jump")} jump · ${k("crouch")} crouch · ${k("view")} view`;
  };
  write();
  const off = onSettingChange((key) => (key === "bindings" || key === "all") && write());
  hud.append(help);
  return () => {
    off();
    window.clearTimeout(timer);
    bar.remove();
    help.remove();
  };
}
