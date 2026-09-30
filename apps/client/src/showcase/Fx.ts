import { Vector3 } from "three";
import { SURFACE, WEAPON, createArena, spawnPoint } from "@cb/shared";
import { HitFx } from "../render/HitFx.ts";
import { Stage } from "../render/Stage.ts";
import { setAtmosphere } from "../render/world/atmosphere.ts";
import { ShotFx } from "../render/weapons/ShotFx.ts";

/**
 * Impact-effect review scene (`?showcase=fx`): the real arena from a fixed eye, one effect spawned on the ground ahead and played to a chosen instant,
 * frozen there so a still can judge it. Deterministic timing (`t`), random detail (the particles' own dice). Parameters:
 *   fx=impact|muzzle|hit|explosion|whizz     what to spawn (default impact)
 *   w=0..2,5         weapon (pistol, rifle, blunderbuss, cannon)
 *   s=0..5           surface for an impact (0 earth, 1 wood, 2 iron, 3 stone, 4 cloth)
 *   t=0.35           seconds after the event to freeze on
 *   n=3              how many, in a row across the view
 *   dist=5           metres ahead
 *   wind=0..1        the atmosphere's wind (smoke drifts with it)
 *   gore=full|reduced|off   for fx=hit
 *   time=13|17.2     hour;   gfx=low|medium|high
 */
export function runFx(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
  const world = createArena(7);
  stage.buildWorld(world);
  const groundAt = (x: number, z: number): number => world.terrainHeight(x, z);
  const shot = new ShotFx(stage.scene, groundAt, 1);
  const hit = new HitFx(stage.scene, groundAt);

  const kind = params.get("fx") ?? "impact";
  const w = Number(params.get("w") ?? 1);
  const surface = Number(params.get("s") ?? SURFACE.EARTH);
  const t = Number(params.get("t") ?? 0.35);
  const n = Number(params.get("n") ?? 3);
  const dist = Number(params.get("dist") ?? 5);
  const wind = Number(params.get("wind") ?? 0.35);
  setAtmosphere({ wind });

  const sp = spawnPoint(0, 4);
  const yaw = Number(params.get("yaw") ?? 0.35);
  const eye = new Vector3(sp.x, groundAt(sp.x, sp.z) + 1.6, sp.z);
  const cam = stage.camera;
  cam.position.copy(eye);
  cam.rotation.order = "YXZ";
  cam.rotation.set(-Number(params.get("pitch") ?? 0.16), yaw, 0);
  cam.fov = Number(params.get("fov") ?? 60);
  cam.near = 0.05;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  stage.followShadow(eye);
  stage.render();

  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * Number(params.get("gap") ?? 1.8);
    const p = eye.clone().addScaledVector(fwd, dist).addScaledVector(right, off);
    p.y = groundAt(p.x, p.z);
    if (kind === "impact") shot.impact(surface as never, p.x, p.y + 0.02, p.z, 0, 1, 0, w);
    else if (kind === "explosion") shot.explosion(p.x, p.y, p.z, 6);
    else if (kind === "hit") hit.burst(p.x, p.y + 1, p.z, 0, -1, 0.9, (params.get("gore") as "full" | "reduced" | "off" | null) ?? "full");
    else if (kind === "muzzle") shot.muzzle(w, p.x, p.y + 1.3, p.z, fwd.x, 0, fwd.z);
  }
  const step = 1 / 60;
  for (let k = 0; k * step < t; k++) {
    shot.update(step);
    hit.update(step);
  }

  const loop = (): void => {
    stage.followShadow(eye);
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, stats: () => shot.live, WEAPON };
}
