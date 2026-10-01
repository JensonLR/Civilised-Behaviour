import { attachUiSounds, startAmbience, startMusic } from "../audio/index.ts";
import { Controls } from "../input/Controls.ts";
import { applyDisplaySettings, getGfx, getReduceMotion, onSettingChange } from "../settings.ts";
import { motion, motionScale } from "../render/world/atmosphere.ts";
import { Session } from "../net/Session.ts";
import { Stage } from "../render/Stage.ts";
import { createArena, isRegionId, isTemplateId, type RegionId, type ScenarioTemplateId } from "@cb/shared";
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

/** Resolves after the browser has painted what was just added to the page (so a heavy step that follows cannot delay it). */
const afterPaint = (delayMs = 0): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, delayMs)));

const idleFor = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Boots the networked game in three steps so the page never waits on work it does not need yet:
 *  1. the front door (DOM only: name, buttons, settings, how-to) and the audio hooks; this paints first, so the page is usable at once;
 *  2. after that paint: the stage (WebGL context, sky), controls, the character creator and the figure, which start drawing;
 *  3. after another half second, if nobody has started a session (and the preset wants one): the camp behind the door (`createArena` +
 *     `Stage.buildWorld`, about a second of JS), its shaders linked in parallel.
 * A session that starts sooner waits for step 2 (it needs the stage) and builds its own world; step 3 is then never done.
 */
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
  attachUiSounds(document.body);
  startAmbience(); // sound begins at the first click or key press (browsers require a gesture); the front door has wind, birds and a fire
  startMusic("menu");
  window.addEventListener("keydown", (e) => {
    if (e.code === "F1" && !anyModalOpen()) {
      e.preventDefault();
      openHowTo();
    }
  });
  new SoundPlaque(document.body); // "Click anywhere to enable sound" until the audio context has had its gesture

  let stage!: Stage;
  let controls!: Controls;
  let preview!: CreatorPreview;
  let pause!: Pause;
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
  // `?region=kessar` founds the expedition already at that shore (dev, tests, screenshots); in play the party sails from the map room
  const startRegion: RegionId | undefined = isRegionId(params.get("region")) ? (params.get("region") as RegionId) : undefined;
  // `&scenario=<template id>` picks the contract offered at Kessar (dev, tests): in play the campaign ledger decides (shared/scenarios/registry.ts)
  const startScenario: ScenarioTemplateId | undefined = isTemplateId(params.get("scenario")) ? (params.get("scenario") as ScenarioTemplateId) : undefined;
  const realPlayers = (s: Session): number => {
    let n = 0;
    s.room.state.players.forEach((p) => {
      if (!p.npc) n++;
    });
    return n;
  };
  let look = loadLook();
  saveLook(look);

  let backdropWanted = true;
  let removeChrome: (() => void) | undefined;
  function showHud(s: Session): void {
    hud.hidden = false;
    removeChrome?.();
    removeChrome = buildHudChrome(hud, s.code, `${location.origin}${location.pathname}?join=${s.code}`);
  }

  // Step 2 (after the door has painted): everything that needs the GPU.
  const ready = afterPaint(80).then(() => {
    // (80 ms: creating the WebGL context alone can block the page for a second on some machines; let the door be seen and clicked first)
    stage = new Stage(canvas, getGfx());
    onSettingChange((k) => {
      if (k === "gfx" || k === "all") stage.setPreset(getGfx());
    });
    controls = new Controls(canvas, { sensitivity: 0.0022, padSensitivity: 1, holdToSprint: true });
    onInputBlocked((blocked) => (controls.blocked = blocked)); // a settings / pause / manual sheet is up: hands off the game
    new Captions(document.body);
    stage.setTime(17.2); // the front door sits at golden hour in the camp; a joined room's clock takes over (Game feeds it to the stage)
    pause = new Pause({
      canvas,
      invite: () => (session ? { code: session.code, link: `${location.origin}${location.pathname}?join=${session.code}`, present: realPlayers(session) } : undefined),
      leave: () => {
        session?.leave();
        location.assign(location.pathname); // back to the front door with a clean slate (the world, sockets and audio all restart)
      },
    });
    preview = new CreatorPreview(stage, canvas);
    const initial = decodeSpec(look)!;
    new CharacterCreator(menu.creatorHost, initial, (spec) => {
      look = encodeSpec(spec);
      saveLook(look);
      preview.setSpec(spec);
    });
    preview.setSpec(initial);
    preview.start();
  });

  // Step 3 (after the next paint): the real camp behind the door. The world is built hidden and its shaders are linked in parallel, so the door
  // keeps animating and the camp appears whole.
  void ready
    .then(() => afterPaint())
    .then(async () => {
      if (!backdropWanted || !stage.menuBackdrop) return;
      await idleFor(500); // the door is usable first; anyone who clicks "New campaign" in that time never pays for a camp they will not see
      if (!backdropWanted) return;
      const world = createArena(7);
      await stage.buildWorldAsync(world, () => backdropWanted);
      if (!backdropWanted) return;
      preview.setGround((x, z) => world.terrainHeight(x, z));
      canvas.dataset.backdrop = "ready";
    })
    .catch((e) => console.error("backdrop failed", e));

  async function enter(s: Session): Promise<void> {
    backdropWanted = false;
    menu.progress("Surveying the territory...");
    await ready;
    // let the working card paint before the (synchronous) world build blocks the page
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    preview.stop();
    session = s;
    game = new Game(stage, s, controls, hud, debugEl);
    showHud(s);
    s.room.onLeave((code) => {
      if (code !== 4000) console.warn("Left room", code);
    });
    await stage.precompile(); // link the game's shaders in parallel instead of one stall per first draw
    game.start();
    canvas.focus();
    startMusic("game");
    pause.active = true;
    if (import.meta.env.MODE !== "production") {
      (window as unknown as Record<string, unknown>).__cb = { session: s, game, stage, controls, pause };
    }
  }

  const menu = new Menu(menuEl, {
    onCreate: async (name, rules, progress) => {
      backdropWanted = false; // (from the click, not from the session: the camp behind the door is not worth building now)
      progress("Posting the telegram...");
      const s = await Session.create(name, look, { ...rules, ...(startRegion ? { region: startRegion } : {}), ...(startScenario ? { scenario: startScenario } : {}) });
      progress("Reply received. Packing the trunks...");
      await enter(s);
    },
    onJoin: async (code, name, progress) => {
      backdropWanted = false;
      progress("Presenting your code...");
      const s = await Session.join(code, name, look);
      progress("Reply received. Packing the trunks...");
      await enter(s);
    },
  });
}
