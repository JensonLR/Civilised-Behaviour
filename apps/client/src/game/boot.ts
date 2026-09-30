import { attachUiSounds, startAmbience, startMusic } from "../audio/index.ts";
import { Controls } from "../input/Controls.ts";
import { applyDisplaySettings, getGfx, getReduceMotion, onSettingChange } from "../settings.ts";
import { motion, motionScale } from "../render/world/atmosphere.ts";
import { Session } from "../net/Session.ts";
import { Stage } from "../render/Stage.ts";
import { createArena } from "@cb/shared";
import { decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { CreatorPreview } from "../render/CreatorPreview.ts";
import { Captions } from "../ui/Captions.ts";
import { CharacterCreator } from "../ui/CharacterCreator.ts";
import { openHowTo } from "../ui/HowTo.ts";
import { anyModalOpen, onInputBlocked } from "../ui/modal.ts";
import { Pause } from "../ui/Pause.ts";
import { buildHudChrome } from "../ui/hudChrome.ts";
import { Menu } from "../ui/Menu.ts";
import { SoundPlaque } from "../ui/SoundPlaque.ts";
import { Game } from "./Game.ts";

/** Boots the networked game: stage, controls and the create/join menu. */
export function bootGame(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const hud = document.querySelector<HTMLElement>("#hud")!;
  const menuEl = document.querySelector<HTMLElement>("#menu")!;
  const debugEl = document.querySelector<HTMLElement>("#debug")!;

  // Display options (UI scale, contrast, larger text, colour-blind marks, reduced motion) are attributes on <html>; the stylesheet does the rest.
  applyDisplaySettings();
  // the motion preference (reduce motion in the settings) also scales the world's sway, birds and cloth, live
  const applyMotion = (): void => void (motion.value = motionScale(params, getReduceMotion()));
  onSettingChange(() => {
    applyDisplaySettings();
    applyMotion();
  });
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
  stage.setTime(17.2); // the front door sits at golden hour in the camp; a joined room's clock takes over (Game feeds it to the stage)
  new SoundPlaque(document.body); // "Click anywhere to enable sound" until the audio context has had its gesture

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

  // The front door's backdrop is the real camp (arena seed 7). Building the world takes about a second, so the door is drawn first (the golden sky and the
  // figure) and the camp is built after that first paint; a session that starts sooner simply builds its own world and this one is never made.
  const preview = new CreatorPreview(stage, canvas);
  let backdropWanted = true;
  const buildBackdrop = (): void => {
    if (!backdropWanted) return;
    const world = createArena(7);
    stage.buildWorld(world);
    preview.setGround((x, z) => world.terrainHeight(x, z));
    canvas.dataset.backdrop = "ready";
  };
  requestAnimationFrame(() => setTimeout(buildBackdrop, 60));

  let removeChrome: (() => void) | undefined;
  function showHud(s: Session): void {
    hud.hidden = false;
    removeChrome?.();
    removeChrome = buildHudChrome(hud, s.code, `${location.origin}${location.pathname}?join=${s.code}`);
  }

  async function enter(s: Session): Promise<void> {
    backdropWanted = false;
    menu.progress("Surveying the territory...");
    // let the working card paint before the (synchronous) world build blocks the page
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
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
    onCreate: async (name, rules, progress) => {
      progress("Posting the telegram...");
      const s = await Session.create(name, look, rules);
      progress("Reply received. Packing the trunks...");
      await enter(s);
    },
    onJoin: async (code, name, progress) => {
      progress("Presenting your code...");
      const s = await Session.join(code, name, look);
      progress("Reply received. Packing the trunks...");
      await enter(s);
    },
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
