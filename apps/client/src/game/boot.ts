import { attachUiSounds, startAmbience, startMusic } from "../audio/index.ts";
import { Controls } from "../input/Controls.ts";
import { applyDisplaySettings, getGfx, getReduceMotion, onSettingChange } from "../settings.ts";
import { motion, motionScale } from "../render/world/atmosphere.ts";
import { Session, serverUrl } from "../net/Session.ts";
import { pickPlatform } from "../platform/Platform.ts";
import { PlatformLink } from "../platform/PlatformLink.ts";
import { isDemo, isDesktop, wishlistLink } from "../platform/flags.ts";
import { probeServer, reachText } from "../platform/serverReach.ts";
import { REACH_CHECKING } from "../platform/reachCopy.ts";
import { Wishlist } from "../ui/Wishlist.ts";
import { Stage } from "../render/Stage.ts";
import { DEMO, createArena, isRegionId, isTemplateId, parseCampaign, type RegionId, type ScenarioTemplateId } from "@cb/shared";
import { decodeSpec, encodeSpec, generateCharacter } from "@cb/procedural";
import { CreatorPreview } from "../render/CreatorPreview.ts";
import { Captions } from "../ui/Captions.ts";
import { CharacterCreator } from "../ui/CharacterCreator.ts";
import { openHowTo } from "../ui/HowTo.ts";
import { anyModalOpen, onInputBlocked } from "../ui/modal.ts";
import { Pause } from "../ui/Pause.ts";
import { buildHudChrome } from "../ui/hudChrome.ts";
import { Menu } from "../ui/Menu.ts";
import { listExpeditions, noteExpedition } from "../ui/expeditions.ts";
import { isDormantSave } from "../ui/menuLogic.ts";
import type { SaveStatus } from "../net/saveStatus.ts";
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
  // D-036: the storefront seam (a no-op on the web). A friend's invite arrives as a valid join code and nothing else: at the front door it joins, in a game it returns to the door with
  // the code filled in (leaving a live expedition is never done on a click from outside).
  const link = new PlatformLink(pickPlatform(), (code) => {
    if (session) location.assign(`${location.pathname}?join=${code}`);
    else void menu?.joinWith(code);
  });
  link.presence({ where: "menu", party: 1, day: 0 });
  window.addEventListener("pagehide", () => link.dispose());

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
  // Dev and test builds only: a production build never sends the levers (the server ignores them without debug commands anyway).
  const devBuild = import.meta.env.MODE !== "production";
  const startRegion: RegionId | undefined = devBuild && isRegionId(params.get("region")) ? (params.get("region") as RegionId) : undefined;
  // `&scenario=<template id>` picks the contract offered at Kessar (dev, tests): in play the campaign ledger decides (shared/scenarios/registry.ts)
  const startScenario: ScenarioTemplateId | undefined = devBuild && isTemplateId(params.get("scenario")) ? (params.get("scenario") as ScenarioTemplateId) : undefined;
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
    // (the demo saves nothing, so its bar carries no "Saved" line)
    removeChrome = buildHudChrome(hud, s.code, `${location.origin}${location.pathname}?join=${s.code}`, isDemo() ? undefined : { status: () => s.saves.current, subscribe: (fn) => s.saves.subscribe(fn) });
  }

  /**
   * D-039: this browser remembers the expedition (the front door's Continue and list, and the orientation card's per-campaign state). Refreshed when the server says it saved (every
   * ledger change), every half minute and when the page goes, so the region and the day on the list are close to what they were. A demo saves nothing, so it is not recorded.
   */
  function rememberExpedition(s: Session, name: string): void {
    if (isDemo()) return;
    const sync = (): void => {
      const day = parseCampaign(s.room.state.campaign)?.day;
      noteExpedition(s.code, { name: s.local?.name || name, region: s.room.state.region, ...(day === undefined ? {} : { day }) });
    };
    sync();
    s.saves.subscribe(() => sync());
    window.setInterval(sync, 30_000);
    window.addEventListener("pagehide", sync);
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
      invite: () => (session ? { code: session.code, link: `${location.origin}${location.pathname}?join=${session.code}`, present: realPlayers(session), seed: session.room.state.seed } : undefined),
      // where the save stands and "Save now" / "Save and quit" (the demo saves nothing: its sheet has no save controls)
      ...(isDemo()
        ? {}
        : {
            save: {
              status: (): SaveStatus => session?.saves.current ?? { kind: "unknown" },
              now: (): Promise<SaveStatus> => (session ? session.saveNow() : Promise.resolve<SaveStatus>({ kind: "unknown" })),
              subscribe: (fn: (s: SaveStatus) => void): (() => void) => session?.saves.subscribe(fn) ?? (() => undefined),
            },
          }),
      // the demo's pause sheet carries a way to the wish-list card
      ...(isDemo() ? { wishlist: () => new Wishlist({ url: wishlistLink() }).show() } : {}),
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

  async function enter(s: Session, name = ""): Promise<void> {
    backdropWanted = false;
    // (a demo that ran out while the world was still being built: the close has already happened, so the card is shown the moment the game exists)
    let demoClosed = false;
    s.room.onLeave((code) => {
      if (code === DEMO.closeCode) demoClosed = true;
    });
    menu.progress("Surveying the territory...");
    await ready;
    // let the working card paint before the (synchronous) world build blocks the page
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    preview.stop();
    session = s;
    rememberExpedition(s, name); // (before the Game: its orientation card reads this campaign's entry)
    game = new Game(stage, s, controls, hud, debugEl, link);
    if (demoClosed) game.endDemo();
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

  const menu: Menu = new Menu(menuEl, {
    onCreate: async (name, rules, progress) => {
      backdropWanted = false; // (from the click, not from the session: the camp behind the door is not worth building now)
      progress("Posting the telegram...");
      const s = await Session.create(name, look, { ...rules, ...(startRegion ? { region: startRegion } : {}), ...(startScenario ? { scenario: startScenario } : {}) });
      progress("Reply received. Packing the trunks...");
      await enter(s, name);
    },
    onJoin: async (code, name, progress) => {
      backdropWanted = false;
      progress("Presenting your code...");
      const s = await Session.join(code, name, look);
      progress("Reply received. Packing the trunks...");
      await enter(s, name);
    },
    // a dormant campaign comes back by its code, for a former member only (D-035): the expedition resumes at HQ with its ledger
    // (a demo saves nothing, so there is nothing to resume: the handler is absent and the door never offers it)
    ...(isDemo()
      ? {}
      : {
          onResume: async (code: string, name: string, progress: (step: string) => void) => {
            backdropWanted = false;
            progress("Consulting the Society's files...");
            // (a campaign left a moment ago may still be putting its last save away: for an expedition played in the last half minute, ask again a few times before giving up)
            const recent = (listExpeditions().find((e) => e.code === code)?.lastPlayed ?? 0) > Date.now() - 30_000;
            let s: Session | undefined;
            for (let attempt = 0; !s; attempt++) {
              try {
                s = await Session.create(name, look, { resume: code });
              } catch (e) {
                if (!recent || attempt >= 4 || !isDormantSave(e instanceof Error ? e.message : "")) throw e;
                progress("The file is being put away. Asking again...");
                await idleFor(700);
              }
            }
            progress("The file is found. Packing the trunks...");
            await enter(s, name);
          },
        }),
  });
  // The desktop build loads from disk with no network at all: the door says whether a server can be reached, and asks again on request.
  if (isDesktop()) {
    const ask = (): void => {
      menu.setReach(REACH_CHECKING);
      void probeServer(serverUrl()).then((r) => menu.setReach(reachText(r), r === "down" ? ask : undefined));
    };
    ask();
  }
}
