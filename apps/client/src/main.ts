import { Controls } from "./input/Controls.ts";
import { Game } from "./game/Game.ts";
import { Session } from "./net/Session.ts";
import { Stage } from "./render/Stage.ts";
import { Menu } from "./ui/Menu.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const menuEl = document.querySelector<HTMLElement>("#menu")!;
const debugEl = document.querySelector<HTMLElement>("#debug")!;

const stage = new Stage(canvas, (new URLSearchParams(location.search).get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
const controls = new Controls(canvas, { sensitivity: 0.0022, padSensitivity: 1, holdToSprint: true });

let game: Game | undefined;
let session: Session | undefined;

function showHud(s: Session): void {
  hud.hidden = false;
  const link = `${location.origin}${location.pathname}?join=${s.code}`;
  const bar = document.createElement("div");
  bar.className = "codebar";
  bar.innerHTML = `<span>Expedition code <b>${s.code}</b></span><button type="button">Copy invite</button>`;
  bar.querySelector("button")!.addEventListener("click", (e) => {
    void navigator.clipboard?.writeText(link);
    (e.target as HTMLButtonElement).textContent = "Copied";
  });
  hud.prepend(bar);
  const help = document.createElement("div");
  help.className = "help";
  help.textContent = "WASD move · Shift sprint · Space jump · C crouch · mouse look (click to capture) · F3 stats";
  hud.append(help);
}

async function enter(s: Session): Promise<void> {
  session = s;
  game = new Game(stage, s, controls, hud, debugEl);
  showHud(s);
  s.room.onLeave((code) => {
    if (code !== 4000) console.warn("Left room", code);
  });
  game.start();
  canvas.focus();
  if (import.meta.env.MODE !== "production") {
    (window as unknown as Record<string, unknown>).__cb = { session: s, game, stage, controls };
  }
}

const menu = new Menu(menuEl, {
  onCreate: async (name) => enter(await Session.create(name)),
  onJoin: async (code, name) => enter(await Session.join(code, name)),
});
void menu;
void session;
void game;
