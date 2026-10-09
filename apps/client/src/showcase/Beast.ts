import { Vector3 } from "three";
import { FLAG, type PlayerStateType } from "@cb/shared";
import { BeastView } from "../render/BeastView.ts";
import { LabStage } from "./LabStage.ts";

/**
 * D-094: the Great Grey (`?showcase=beast`). Four of him in a row, left to right: grazing (standing a while), walking, at a run, and down on his side. Deterministic: the
 * same URL gives the same picture. view=side|three|front; outline=0 drops the ink hull.
 */
export function runBeast(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new LabStage(canvas);
  stage.buildWorld();
  const beasts = new BeastView(stage.scene, params.get("outline") !== "0");
  const view = params.get("view") ?? "three";
  const facing = ({ side: Math.PI / 2, front: 0, three: Math.PI * 0.75 } as Record<string, number>)[view] ?? Math.PI * 0.75;
  const SP = 4.2;
  const rows = new Map<string, PlayerStateType>();
  const speeds = [0, 1.6, 6, 0];
  for (let i = 0; i < 4; i++) rows.set(`npc:grey-${i}`, { x: (i - 1.5) * SP, y: 0, z: 0, facing, flags: FLAG.GROUNDED | FLAG.BEAST | (i === 3 ? FLAG.DOWNED : 0) } as unknown as PlayerStateType);
  // run the animation on: the walkers move along their heading, the grazer stands long enough to lower his head, the fallen one settles
  const dt = 1 / 30;
  const along = { x: -Math.sin(facing), z: -Math.cos(facing) };
  const t0 = [...rows.values()].map((r) => ({ x: r.x, z: r.z }));
  for (let k = 0; k < Number(params.get("steps") ?? 150); k++) {
    let i = 0;
    for (const r of rows.values()) {
      const s = speeds[i]!;
      // walkers stay in their place in the row (a treadmill): the view reads speed from movement, so they are moved and put back
      r.x = t0[i]!.x + along.x * s * dt * (k % 2);
      r.z = t0[i]!.z + along.z * s * dt * (k % 2);
      i++;
    }
    beasts.update(dt, rows, (p, key) => (p as unknown as Record<string, number>)[key]!);
  }
  const cam = stage.camera;
  cam.fov = 30;
  cam.updateProjectionMatrix();
  const target = new Vector3(0, 0.9, 0);
  cam.position.set(0, 2.2, 21);
  cam.lookAt(target);
  stage.followShadow(new Vector3(0, 0, 0));
  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const info = stage.renderer.info;
  (window as unknown as Record<string, unknown>).__showcase = { ready: true, stats: () => ({ calls: info.render.calls, triangles: info.render.triangles }) };
}
