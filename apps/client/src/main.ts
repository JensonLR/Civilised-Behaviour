import "@fontsource/im-fell-english/latin-400.css";
import "@fontsource/im-fell-english/latin-400-italic.css";
import "@fontsource/im-fell-english-sc/latin-400.css";
import "@fontsource/special-elite/latin-400.css";
import figuresUrl from "@fontsource/special-elite/files/special-elite-latin-400-normal.woff2?url";
import { paletteCssVars } from "@cb/shared";

/** Publishes the shared palette as CSS custom properties so the interface and the 3D world can never drift apart. */
for (const [name, value] of Object.entries(paletteCssVars())) document.documentElement.style.setProperty(name, value);
// the phone's own bars take the backdrop's colour (D-049; from the palette, like every colour)
document.querySelector<HTMLMetaElement>("meta[name=theme-color]")?.setAttribute("content", paletteCssVars()["--backdrop"]!);

// D-086: the HUD's figures come from the typewriter face (IM Fell's old-style zero reads as a letter: "(o of 3)", "N ooo"); plate.css puts this face first in the HUD's stacks
document.fonts?.add(new FontFace("CB Figures", `url(${figuresUrl})`, { unicodeRange: "U+0030-0039" }));

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
