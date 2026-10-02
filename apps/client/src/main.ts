import "@fontsource/im-fell-english/latin-400.css";
import "@fontsource/im-fell-english/latin-400-italic.css";
import "@fontsource/im-fell-english-sc/latin-400.css";
import "@fontsource/special-elite/latin-400.css";
import { faviconSvg, paletteCssVars } from "@cb/shared";

/** Publishes the shared palette as CSS custom properties so the interface and the 3D world can never drift apart. */
for (const [name, value] of Object.entries(paletteCssVars())) document.documentElement.style.setProperty(name, value);
document.querySelector<HTMLLinkElement>("link[rel=icon]")?.setAttribute("href", `data:image/svg+xml,${encodeURIComponent(faviconSvg())}`);

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const params = new URLSearchParams(location.search);
// Showcases (and the `?region=` / `?scenario=` levers in boot.ts) are QA tools: a production build ignores them.
const showcase = import.meta.env.MODE !== "production" ? params.get("showcase") : null;

if (showcase === "lineup") {
  // Marketing/QA scene: no networking, no menu.
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runLineup } = await import("./showcase/Lineup.ts");
  runLineup(canvas, params);
} else if (showcase === "peoples") {
  // D-038: the fictional peoples of each region (a wrapper over the lineup)
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runPeoples } = await import("./showcase/Peoples.ts");
  runPeoples(canvas, params);
} else if (showcase === "gore") {
  // D-038: the field after a fight at each Gore level (pools, spray, drag marks, craters, mud, soot, open wounds)
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runGore } = await import("./showcase/Gore.ts");
  runGore(canvas, params);
} else if (showcase === "weapons") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runWeapons } = await import("./showcase/Weapons.ts");
  runWeapons(canvas, params);
} else if (showcase === "hud") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runHud } = await import("./showcase/Hud.ts");
  runHud(canvas, params);
} else if (showcase === "fx") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runFx } = await import("./showcase/Fx.ts");
  runFx(canvas, params);
} else if (showcase === "viewmodel") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runViewModel } = await import("./showcase/ViewModel.ts");
  runViewModel(canvas, params);
} else if (showcase === "world") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runWorld } = await import("./showcase/World.ts");
  runWorld(canvas, params);
} else if (showcase === "horses") {
  document.querySelector<HTMLElement>("#menu")!.hidden = true;
  const { runHorses } = await import("./showcase/Horses.ts");
  runHorses(canvas, params);
} else {
  const { bootGame } = await import("./game/boot.ts");
  bootGame(canvas, params);
}
export {};
