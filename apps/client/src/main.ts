import { paletteCssVars } from "@cb/shared";

/** Publishes the shared palette as CSS custom properties so the interface and the 3D world can never drift apart. */
for (const [name, value] of Object.entries(paletteCssVars())) document.documentElement.style.setProperty(name, value);

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const params = new URLSearchParams(location.search);

if (params.get("showcase") === "lineup") {
  // Marketing/QA scene: no networking, no menu.
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runLineup } = await import("./showcase/Lineup.ts");
  runLineup(canvas, params);
} else {
  const { bootGame } = await import("./game/boot.ts");
  bootGame(canvas, params);
}
export {};
