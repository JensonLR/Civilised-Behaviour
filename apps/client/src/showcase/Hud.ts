import { Vector3 } from "three";
import { CASUALTY, CARRIED, FLAG, LIMB, WEAPON, createArena, spawnPoint } from "@cb/shared";
import { applyDisplaySettings } from "../settings.ts";
import { Stage } from "../render/Stage.ts";
import { Captions } from "../ui/Captions.ts";
import { CombatHud } from "../ui/CombatHud.ts";
import { Hud } from "../ui/Hud.ts";
import { buildHudChrome } from "../ui/hudChrome.ts";
import { previewCaption } from "../audio/index.ts";

/**
 * Interface review scene (`?showcase=hud`): the real HUD (gauge, injury tag, heading strip, telegram stack, armoury card, sight, hit and bearing marks,
 * prompt, captions, the expedition plaque) over the real arena, in a state chosen by the URL, frozen. Deterministic. Parameters:
 *   hp=100..0        health;  down=1 the mourning card;  wounds=N (packed mask; 0b...) ;  missing=N
 *   w=0..4|-1        weapon in hand;  ammo=N&reserve=N&reload=0..100;  pad=1 shows the gamepad hints
 *   prompt="..."     the contextual ticket;  revive=40 a progress bar;  fp=1 the first-person dot
 *   notices=3        that many telegrams (a fourth waits);  caption=1 shows sample captions
 *   hit=hit|head|down|sever|behead  a hit marker;  bearing=deg[,deg]  the directions blows came from (0 = ahead, 90 = to the right)
 *   yaw=0.4          camera yaw (heading strip);  x,z= the player's place (default the spawn)
 *   ui=1.25&cvd=1&contrast=1&largetext=1&reducemotion=1   the display settings (as in the game)
 *   bg=world|flat    the backdrop (world = the real arena at golden hour)
 */
export function runHud(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  applyDisplaySettings();
  const hudEl = document.querySelector<HTMLElement>("#hud")!;
  hudEl.hidden = false;
  const num = (k: string, d: number): number => {
    const v = params.get(k);
    return v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v);
  };

  if (params.get("bg") !== "flat") {
    const stage = new Stage(canvas, "low");
    stage.buildWorld(createArena(7));
    const sp = spawnPoint(0, 4);
    const eye = new Vector3(sp.x, 1.6, sp.z);
    stage.camera.position.copy(eye);
    stage.camera.rotation.order = "YXZ";
    stage.camera.rotation.set(-0.04, num("yaw", 0.4), 0);
    stage.camera.fov = 70;
    stage.camera.updateProjectionMatrix();
    stage.setTime(num("time", 17.2));
    const loop = (): void => {
      stage.followShadow(eye);
      stage.render();
      requestAnimationFrame(loop);
    };
    loop();
  }

  new Captions(document.body);
  const chrome = buildHudChrome(hudEl, "K7M2Q", "http://localhost/?join=K7M2Q");
  const hud = new Hud(hudEl);
  const combat = new CombatHud(hudEl);
  void chrome;

  const w = num("w", 1);
  const hp = num("hp", 100);
  const down = params.get("down") === "1";
  const pad = params.get("pad") === "1";
  const flags = FLAG.GROUNDED | (down ? FLAG.DOWNED : 0);
  const revive = num("revive", -1);
  hud.update({
    flags,
    health: down ? 0 : hp,
    reviveProgressOnMe: 0,
    reviveProgressByMe: revive,
    prompt: params.get("prompt") ?? "",
    reviverName: "",
    patientName: "Mrs Ffoulkes-Crumb",
    usingGamepad: pad,
    firstPerson: params.get("fp") === "1",
    armed: w >= 0,
    wounds: num("wounds", 0),
    missing: num("missing", 0) & (LIMB.ARM_L | LIMB.ARM_R | LIMB.LEG_L | LIMB.LEG_R),
    yaw: num("yaw", 0.4),
    x: num("x", spawnPoint(0, 4).x),
    z: num("z", spawnPoint(0, 4).z),
  });
  const owned = CARRIED.reduce<number>((m, id) => m | (1 << id), 0);
  combat.updateArms({ weapon: w, owned, ammo: num("ammo", 1), reserve: num("reserve", 12), reload: num("reload", 0), wait: 0, gamepad: pad, busy: down });
  combat.updateSight({ visible: w >= 0 && !down, gap: num("gap", 10), aiming: params.get("aim") === "1" });
  const hit = params.get("hit");
  if (hit) combat.hitMarker(hit === "head" || hit === "behead" ? 0 : 1, hit === "down" || hit === "behead", hit === "sever", false, hit === "behead");
  for (const b of (params.get("bearing") ?? "").split(",").filter(Boolean)) combat.damageFrom((Number(b) * Math.PI) / 180, 0.8);
  for (let i = 0; i < num("notices", 0); i++) hud.showNotice(["The Society regrets to announce that Sir Reginald is no longer in charge.", "Mrs Ffoulkes-Crumb has been improved.", "A comrade has fallen; the ground is not yet improved.", "The pot is on."][i % 4]!, 60);
  // the telegram queue moves on a timer; a still wants it settled
  if (params.get("caption") === "1") {
    previewCaption("[musket shot, left]");
    previewCaption("[footsteps, behind you]");
  }
  void CASUALTY;
  void WEAPON;
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, hud, combat };
}
