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
