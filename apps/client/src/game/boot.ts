import { Controls } from "../input/Controls.ts";
import { Session } from "../net/Session.ts";
import { Stage } from "../render/Stage.ts";
import { CollisionWorld } from "@cb/shared";
import { decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { CreatorPreview } from "../render/CreatorPreview.ts";
import { CharacterCreator } from "../ui/CharacterCreator.ts";
import { Menu } from "../ui/Menu.ts";
import { Game } from "./Game.ts";

/** Boots the networked game: stage, controls and the create/join menu. */
export function bootGame(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const hud = document.querySelector<HTMLElement>("#hud")!;
  const menuEl = document.querySelector<HTMLElement>("#menu")!;
  const debugEl = document.querySelector<HTMLElement>("#debug")!;

  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
  const controls = new Controls(canvas, { sensitivity: 0.0022, padSensitivity: 1, holdToSprint: true });

  let game: Game | undefined;
  let session: Session | undefined;

  // ---- character look: remembered per browser, random for first-time players ----
  const loadLook = (): string => {
    try {
      const saved = localStorage.getItem("cb.look");
      if (saved && decodeSpec(saved)) return saved;
    } catch {
      /* storage unavailable */
    }
    return encodeSpec(generateCharacter(Math.floor(Math.random() * 1e9)));
  };
  const saveLook = (look: string): void => {
    try {
      localStorage.setItem("cb.look", look);
    } catch {
      /* ignore */
    }
  };
  let look = loadLook();
  saveLook(look);

  // Preview world: a flat field; replaced by the real arena once a session starts.
  stage.buildWorld(new CollisionWorld({ height: () => 0 }, [], 100));
  const preview = new CreatorPreview(stage, canvas);

  function showHud(s: Session): void {
    hud.hidden = false;
    const link = `${location.origin}${location.pathname}?join=${s.code}`;
    const bar = document.createElement("div");
    bar.className = "codebar";
    bar.innerHTML = `<span>Expedition No. <b>${s.code}</b></span><button type="button">Copy invite</button>`;
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
    preview.stop();
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
    onCreate: async (name) => enter(await Session.create(name, look)),
    onJoin: async (code, name) => enter(await Session.join(code, name, look)),
  });
  const initial = decodeSpec(look)!;
  new CharacterCreator(menu.creatorHost, initial, (spec) => {
    look = encodeSpec(spec);
    saveLook(look);
    preview.setSpec(spec);
  });
  preview.setSpec(initial);
  preview.start();
  void session;
  void game;
}
