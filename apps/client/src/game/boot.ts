import { attachUiSounds, startAmbience, startMusic } from "../audio/index.ts";
import { getBindings, keyLabel } from "../input/bindings.ts";
import { Controls } from "../input/Controls.ts";
import { applyDisplaySettings, getGfx, onSettingChange } from "../settings.ts";
import { Session } from "../net/Session.ts";
import { Stage } from "../render/Stage.ts";
import { CollisionWorld } from "@cb/shared";
import { decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { CreatorPreview } from "../render/CreatorPreview.ts";
import { Captions } from "../ui/Captions.ts";
import { CharacterCreator } from "../ui/CharacterCreator.ts";
import { openHowTo } from "../ui/HowTo.ts";
import { anyModalOpen, onInputBlocked } from "../ui/modal.ts";
import { Pause } from "../ui/Pause.ts";
import { Menu } from "../ui/Menu.ts";
import { Game } from "./Game.ts";

/** Boots the networked game: stage, controls and the create/join menu. */
export function bootGame(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const hud = document.querySelector<HTMLElement>("#hud")!;
  const menuEl = document.querySelector<HTMLElement>("#menu")!;
  const debugEl = document.querySelector<HTMLElement>("#debug")!;

  // Display options (UI scale, contrast, larger text, colour-blind marks, reduced motion) are attributes on <html>; the stylesheet does the rest.
  applyDisplaySettings();
  onSettingChange(() => applyDisplaySettings());
  const stage = new Stage(canvas, getGfx());
  onSettingChange((k) => {
    if (k === "gfx" || k === "all") stage.setPreset(getGfx());
  });
  const controls = new Controls(canvas, { sensitivity: 0.0022, padSensitivity: 1, holdToSprint: true });
  onInputBlocked((blocked) => (controls.blocked = blocked)); // a settings / pause / manual sheet is up: hands off the game
  new Captions(document.body);
  attachUiSounds(document.body);
  startAmbience(); // sound begins at the first click or key press (browsers require a gesture); the front door has wind, birds and a fire
  startMusic("menu");
  window.addEventListener("keydown", (e) => {
    if (e.code === "F1" && !anyModalOpen()) {
      e.preventDefault();
      openHowTo();
    }
  });
  stage.setTime(13); // the menu and the creator sit at a calm, fixed hour; a joined room's clock takes over (Game feeds it to the stage)

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
    const k = (id: "forward" | "sprint" | "jump" | "crouch" | "view"): string => keyLabel(getBindings()[id][0]);
    const writeHelp = (): void => {
      const move = (["forward", "left", "back", "right"] as const).map((id) => keyLabel(getBindings()[id][0])).join("");
      help.textContent = `Esc pause · F1 manual · ${move} move · ${k("sprint")} sprint · ${k("jump")} jump · ${k("crouch")} crouch · ${k("view")} view`;
    };
    writeHelp();
    onSettingChange((key) => (key === "bindings" || key === "all") && writeHelp());
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
    startMusic("game");
    pause.active = true;
    if (import.meta.env.MODE !== "production") {
      (window as unknown as Record<string, unknown>).__cb = { session: s, game, stage, controls, pause };
    }
  }

  const pause = new Pause({
    canvas,
    invite: () => (session ? { code: session.code, link: `${location.origin}${location.pathname}?join=${session.code}`, present: session.room.state.players.size } : undefined),
    leave: () => {
      session?.leave();
      location.assign(location.pathname); // back to the front door with a clean slate (the world, sockets and audio all restart)
    },
  });

  const menu = new Menu(menuEl, {
    onCreate: async (name, rules) => enter(await Session.create(name, look, rules)),
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
