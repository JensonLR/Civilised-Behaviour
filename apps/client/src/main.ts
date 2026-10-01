import "@fontsource/im-fell-english/latin-400.css";
import "@fontsource/im-fell-english/latin-400-italic.css";
import "@fontsource/im-fell-english-sc/latin-400.css";
import "@fontsource/special-elite/latin-400.css";
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
} else if (params.get("showcase") === "weapons") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runWeapons } = await import("./showcase/Weapons.ts");
  runWeapons(canvas, params);
} else if (params.get("showcase") === "hud") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runHud } = await import("./showcase/Hud.ts");
  runHud(canvas, params);
} else if (params.get("showcase") === "fx") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runFx } = await import("./showcase/Fx.ts");
  runFx(canvas, params);
} else if (params.get("showcase") === "viewmodel") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runViewModel } = await import("./showcase/ViewModel.ts");
  runViewModel(canvas, params);
} else if (params.get("showcase") === "world") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runWorld } = await import("./showcase/World.ts");
  runWorld(canvas, params);
} else if (params.get("showcase") === "horses") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runHorses } = await import("./showcase/Horses.ts");
  runHorses(canvas, params);
} else {
  const { bootGame } = await import("./game/boot.ts");
  bootGame(canvas, params);
}
export {};
