import { Vector3 } from "three";
import { FLAG } from "@cb/shared";
import { WAGON, hitchPoint } from "@cb/shared";
import { generateCharacter, horseFromSeed } from "@cb/procedural";
import { CharacterAnimator, HandPoser, HorseAnimator, buildCharacter, buildHorse, buildWagon, newRideInput, type CharacterRig, type HorseRig, type WagonRig } from "@cb/procedural/three";
import { LabStage } from "./LabStage.ts";

/**
 * Horse showcase (`?showcase=horses`). Deterministic: the same URL gives the same picture.
 *   n=6 seed=1        a row of n horses (coats from seed + i); sp=3.4 spacing in metres
 *   gait=walk|trot|canter|gallop|idle|jump|rear|bolt   what every horse does (steps=N settles the animation first, default 90; live=1 keeps it running)
 *   rider=1           a rider on each horse
 *   wagon=1           a harnessed horse hitched to a wagon (cargo=3 crates shown, default 3); the first horse of the row
 *   view=side|front|three|rear|top   camera (side: every horse in profile)
 *   outline=0         switch the ink hull off; amb=1 idle life on (ears, tail, pawing)
 *   close=1           frame the first horse tightly; elev=20 raises the camera (degrees)
 */
export function runHorses(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new LabStage(canvas);
  stage.buildWorld();
  const n = Number(params.get("n") ?? 6);
  const seed = Number(params.get("seed") ?? 1);
  const gait = params.get("gait") ?? "idle";
  const view = params.get("view") ?? "three";
  const rider = params.get("rider") === "1";
  const wagon = params.get("wagon") === "1";
  const SPEED: Record<string, number> = { idle: 0, walk: 3, trot: 6.4, canter: 8.9, gallop: 10.5, jump: 8, rear: 0, bolt: 10.5 };
  const speed = SPEED[gait] ?? 0;
  const spacing = Number(params.get("sp") ?? 3.4);
  const yaw = ({ side: Math.PI / 2, front: Math.PI, three: Math.PI * 0.72, rear: 0, top: Math.PI / 2 } as Record<string, number>)[view] ?? Math.PI * 0.72;
  const outline = params.get("outline") !== "0";

  interface Unit {
    horse: HorseRig;
    hAnim: HorseAnimator;
    rider?: { rig: CharacterRig; anim: CharacterAnimator; hands: HandPoser };
    wagon?: WagonRig;
    ride: ReturnType<typeof newRideInput>;
  }
  const units: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const harness = wagon && i === 0;
    const horse = buildHorse(horseFromSeed(seed + i * 7919, { harness }), { outline });
    horse.root.position.set((i - (n - 1) / 2) * spacing, 0, 0);
    horse.root.rotation.y = yaw;
    if (params.get("nohorse") !== "1") stage.scene.add(horse.root);
    const hAnim = new HorseAnimator(horse, i);
    if (params.get("amb") !== "1") hAnim.ambient = false;
    const u: Unit = { horse, hAnim, ride: newRideInput() };
    if (rider && !harness) {
      const rig = buildCharacter(generateCharacter(seed * 31 + i * 17, i % 6), { outline });
      rig.root.position.copy(horse.root.position);
      rig.root.rotation.y = yaw;
      stage.scene.add(rig.root);
      const anim = new CharacterAnimator(rig);
      anim.autoBlink = false;
      u.rider = { rig, anim, hands: new HandPoser(rig) };
    }
    if (harness) {
      const w = buildWagon({ coat: seed % 12, cargo: Number(params.get("cargo") ?? 3), outline });
      const back = { x: 0, z: 0 };
      hitchPoint(0, 0, 0, back);
      const dist = WAGON.hitchBack + WAGON.len;
      w.root.position.set(horse.root.position.x + Math.sin(yaw) * dist, 0, horse.root.position.z + Math.cos(yaw) * dist);
      w.root.rotation.y = yaw;
      stage.scene.add(w.root);
      u.wagon = w;
    }
    units.push(u);
  }

  const bolting = gait === "bolt";
  const input = { speed, grounded: gait !== "jump", vy: gait === "jump" ? 2.5 : 0, rear: gait === "rear" ? 1 : 0, ridden: rider, turn: 0, bolting, hitched: wagon, load: wagon ? 0.6 : 0 };
  let travelled = 0;
  const tick = (dt: number): void => {
    travelled += speed * dt;
    for (const u of units) {
      u.hAnim.update(dt, { ...input, ridden: input.ridden && !u.wagon, hitched: !!u.wagon });
      if (u.wagon) u.wagon.roll(travelled);
      if (u.rider) {
        const m = u.hAnim.motion;
        u.ride.bob = m.bob;
        u.ride.bodyZ = m.bodyZ;
        u.ride.pitch = m.pitch;
        u.ride.roll = m.roll;
        u.ride.speed01 = Math.min(1, speed / 10.5);
        u.ride.scale = u.horse.scale;
        u.rider.anim.update(dt, { speed: 0, flags: FLAG.GROUNDED, vy: 0, ride: u.ride });
        u.rider.hands.update(dt, FLAG.GROUNDED | 4096, 0, "neutral");
      }
    }
  };
  const steps = Number(params.get("steps") ?? 90);
  for (let k = 0; k < steps; k++) tick(1 / 30);

  const cam = stage.camera;
  cam.fov = 30;
  cam.updateProjectionMatrix();
  const w = Math.max(6, n * spacing);
  const target = new Vector3(0, 0.8, 0);
  const d = Math.max(6, w * 1.1) * (wagon ? 1.3 : 1);
  if (view === "top") cam.position.set(0, d, 0.1);
  else if (view === "side") cam.position.set(0, 1.0, d);
  else cam.position.set(0, 1.4 + d * 0.06, d);
  if (params.get("close") === "1") {
    const h0 = units[0]!.horse.root.position;
    target.set(h0.x, 1.0, h0.z);
    cam.position.set(h0.x + Number(params.get("cx") ?? 0), 1.2 + Number(params.get("cy") ?? 0.4), h0.z + Number(params.get("cd") ?? 5));
  }
  const elev = Number(params.get("elev") ?? 0);
  if (elev !== 0) {
    const off = cam.position.clone().sub(target);
    const len = off.length();
    const e0 = Math.asin(off.y / len) + (elev * Math.PI) / 180;
    const a = Math.atan2(off.x, off.z);
    cam.position.set(target.x + len * Math.cos(e0) * Math.sin(a), target.y + len * Math.sin(e0), target.z + len * Math.cos(e0) * Math.cos(a));
  }
  cam.lookAt(target);
  stage.followShadow(new Vector3(0, 0, 0));
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (params.get("live") === "1") tick(dt);
    stage.followShadow(new Vector3(0, 0, 0));
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = {
    ready: true,
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, horseTriangles: units.map((u) => u.horse.triangles), horseMeshes: units.map((u) => u.horse.meshCount), wagonMeshes: units[0]?.wagon?.meshCount }),
  };
}
