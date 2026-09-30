import { Vector3 } from "three";
import { CAMP, PALETTE, WEAPON, createArena, spawnPoint } from "@cb/shared";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import { ViewModel, type ViewModelFrame } from "../render/ViewModel.ts";
import { MODE, type Mode } from "../render/viewPose.ts";
import { Stage } from "../render/Stage.ts";

/**
 * First-person viewmodel review scene (`?showcase=viewmodel`): the real arena seen from a fixed eye, with the viewmodel drawn exactly as the game
 * draws it (a second pass over the world), frozen at a chosen instant so a still can be judged. Deterministic. Parameters:
 *   w=0..4|-1        weapon (0 pistol, 1 rifle, 2 blunderbuss, 3 sabre, 4 umbrella, -1 bare hands)
 *   state=hip|ads|sprint|reload|fire|swing|bash|draw|carry|kneel|drag|crew    what the player is doing
 *   u=0.5            progress 0..1 of a reload or a blow, or how much of the recoil is left after `fire`, or how far a draw has come
 *   kind=0|1|2       which blow (swing)
 *   seed=N           the character (sleeves and skin come from the look)
 *   gfx=low|medium|high, time=17.2, weather=..., fov=78
 *   cam=x,y,z&yaw=&pitch=   where the eye is (default: near the camp, looking at the tents)
 *   wall=0.35        a wall this far from the eye (metres) to prove the hands never sink into it
 *   wounds=N&missing=N   packed wound mask / lost-limb mask on the arms
 */
export function runViewModel(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
  const seed = Number(params.get("seed") ?? 5);
  const world = createArena(7);
  stage.buildWorld(world);
  const look = encodeSpec(generateCharacter(seed));
  const vm = new ViewModel(stage);

  const w = Number(params.get("w") ?? 1);
  const state = params.get("state") ?? "hip";
  const u = Number(params.get("u") ?? 0.5);
  const sp = spawnPoint(0, 4);
  const cam = stage.camera;
  const cp = (params.get("cam") ?? `${sp.x},${world.terrainHeight(sp.x, sp.z) + 1.6},${sp.z}`).split(",").map(Number);
  const yaw = Number(params.get("yaw") ?? 0.35);
  const pitch = Number(params.get("pitch") ?? 0.02);
  cam.position.set(cp[0]!, cp[1]!, cp[2]!);
  const fov = Number(params.get("fov") ?? 78);
  const aiming = state === "ads";
  cam.fov = fov * (aiming ? 0.9 : 1);
  cam.near = 0.05;
  cam.updateProjectionMatrix();
  cam.rotation.order = "YXZ";
  cam.rotation.set(-pitch, yaw, 0);
  cam.updateMatrixWorld(true);
  void CAMP;

  const mode: Mode = state === "carry" ? MODE.CARRY : state === "kneel" ? MODE.KNEEL : state === "drag" ? MODE.DRAG : state === "crew" ? MODE.CREW : MODE.FREE;
  const frame: ViewModelFrame = {
    weapon: w,
    aiming,
    sprinting: state === "sprint",
    speed: state === "sprint" ? 5.5 : 0,
    grounded: true,
    reload: state === "reload" ? Math.min(0.999, Math.max(0.001, u)) : 0,
    mode,
    yaw,
    pitch,
    shown: true,
    look,
    gore: (params.get("gore") as "full" | "reduced" | "off" | null) ?? "full",
    wounds: Number(params.get("wounds") ?? 0),
    missing: Number(params.get("missing") ?? 0),
    userFov: fov,
    motion: 1,
    bob: 1,
  };

  if (params.get("wall")) {
    // a slab across the view: the viewmodel's depth clear must keep the hands and the weapon in front of it
    import("three").then(({ Mesh, BoxGeometry, MeshToonMaterial }) => {
      const d = Number(params.get("wall"));
      const wall = new Mesh(new BoxGeometry(4, 3, 0.2), new MeshToonMaterial({ color: PALETTE.world.rockPale }));
      const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      wall.position.copy(cam.position).addScaledVector(fwd, d + 0.1);
      wall.quaternion.copy(cam.quaternion);
      stage.scene.add(wall);
    });
  }

  stage.followShadow(cam.position);
  stage.render();
  // settle the blends, then hold the requested instant
  vm.update(0.001, frame);
  const step = (dt: number): void => vm.update(dt, frame);
  if (state === "draw") {
    // a fresh draw: start lowered, then raise to `u`
    frame.weapon = -1;
    for (let k = 0; k < 30; k++) step(1 / 30);
    frame.weapon = w;
    for (let t = 0; t < 0.14; t += 1 / 120) step(1 / 120); // lowered (nothing to lower: swapped at once)
    for (let t = 0; t < 0.24 * u; t += 1 / 120) step(1 / 120);
  } else {
    for (let k = 0; k < 90; k++) step(1 / 30);
    if (state === "fire") {
      vm.fire(w);
      for (let t = 0; t < (w === WEAPON.PISTOL ? 0.24 : 0.36) * (1 - u); t += 1 / 120) step(1 / 120);
    }
    if (state === "swing" || state === "bash") {
      const def = { windup: state === "bash" ? 0.2 : 0.2 };
      // the kind of blow: burn the counter so the requested variant is the one drawn
      for (let k = 0; k < Number(params.get("kind") ?? 0); k++) vm.swing(def.windup, false), vm.update(1.0, frame);
      vm.swing(def.windup, state === "bash");
      const total = (def.windup / 0.36) * u;
      for (let t = 0; t < total; t += 1 / 120) step(1 / 120);
    }
  }
  stage.followShadow(cam.position);
  // (a review aid) hide=L|R hides an arm, so a stray shape can be traced to its owner
  const hide = params.get("hide") ?? "";
  if (vm.armsRig) {
    if (hide.includes("L")) vm.armsRig.joints.shoulderL.visible = false;
    if (hide.includes("R")) vm.armsRig.joints.shoulderR.visible = false;
  }

  const loop = (): void => {
    stage.followShadow(cam.position);
    stage.render();
    vm.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  info.autoReset = false;
  (window as unknown as Record<string, unknown>).__showcase = {
    ready: true,
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }),
    vm,
  };
}
