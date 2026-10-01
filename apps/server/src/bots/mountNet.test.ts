import { describe, expect, it } from "vitest";
import { BUTTON, CollisionWorld, FLAG } from "@cb/shared";
import { MOUNT_FLAG } from "@cb/shared";
import { MountRoom, NetSim, frame } from "./mount.ts";

/**
 * Prediction under latency for a mounted rider, in process. The real-room version (a `Bot` riding through `mountRider`) needs the room wired for mounts (integrator step 3);
 * this one runs the same shared steps, the same INTERACT rule and the same `Mounts` system through a latency model whose client predicts and replays exactly as the reconciler
 * does (reset to the server's float32 state, replay the unacknowledged inputs), so what it measures is the property the design relies on: a ridden horse adds no prediction
 * error of its own, only the one flag correction at the moment the server mounts, dismounts or throws.
 */

const world = (): CollisionWorld => new CollisionWorld({ height: (x: number, z: number) => Math.sin(x * 0.05) * 0.4 + Math.cos(z * 0.04) * 0.3 }, [{ kind: "circle", x: 12, z: -90, r: 1.5, y0: -2, y1: 4 }], 400);

/** Mount, trot, gallop (steady), jump twice, gallop on, brake, dismount, walk away. */
function ride(rtt: number) {
  const room = new MountRoom(world(), 5);
  const p = room.addPlayer("a", 0, 100);
  room.mounts.spawnHorse({ x: 1.2, z: 100, yaw: 0 }, { coat: 3 });
  const net = new NetSim(room, "a", rtt);
  const MOUNT_T = 40;
  const DISMOUNT_T = 560;
  const frames: number[] = [];
  for (let t = 0; t < 640; t++) {
    let buttons = 0;
    let f = 0;
    if (t === MOUNT_T || t === DISMOUNT_T) buttons |= BUTTON.INTERACT;
    if (t > MOUNT_T && t < 520) f = 1;
    if (t >= 100 && t < 500) buttons |= BUTTON.SPRINT;
    if (t === 300 || t === 380) buttons |= BUTTON.JUMP;
    if (t > DISMOUNT_T) f = 1;
    // a gentle weave: the camera yaw drifts, so the steering is exercised too
    const yaw = Math.sin(t * 0.02) * 0.4;
    net.step(frame(f, 0, yaw, buttons));
    frames.push(p.z);
  }
  return { net, p, frames };
}

describe("a mounted rider under latency (client replay equals the server)", () => {
  for (const rtt of [0, 100, 150]) {
    it(`RTT ${rtt} ms: worst riding correction <= 0.5 m, none at all while the ride is steady, the mount costs one flag correction, the dismount a 1 m placement`, () => {
      const { net, p } = ride(rtt);
      const s = net.stats;
      expect(s.flagFlips).toBe(2); // mounted, dismounted: nothing else changed the flags
      expect(s.worstRiding).toBeLessThanOrEqual(0.5); // mounting, riding, jumping: one flag correction at the mount, nothing else
      expect(s.worst).toBeLessThanOrEqual(1.1); // ... and the dismount's deliberate 1 m placement beside the horse
      expect(s.steadyReconciles).toBeGreaterThan(100);
      // identical replay: the only difference left is float32 rounding of the snapshot (the schema's width)
      expect(s.worstSteady).toBeLessThan(1e-3);
      expect(p.flags & (MOUNT_FLAG.MOUNTED | MOUNT_FLAG.GALLOPING)).toBe(0);
      // the client ends where the server is
      expect(Math.hypot(net.predicted.x - p.x, net.predicted.z - p.z)).toBeLessThan(0.6);
    });
  }

  it("the ride really galloped, jumped and went somewhere (the test is not vacuous)", () => {
    const { frames } = ride(100);
    expect(frames[0]! - frames[520]!).toBeGreaterThan(120); // 120+ m north in 16 s
  });

  it("a jump taken at 150 ms RTT is replayed to the same arc: no correction when the server catches up", () => {
    const room = new MountRoom(world(), 5);
    const p = room.addPlayer("a", 0, 100);
    room.mounts.spawnHorse({ x: 1.2, z: 100, yaw: 0 }, { coat: 3 });
    const net = new NetSim(room, "a", 150);
    for (let t = 0; t < 400; t++) net.step(frame(t > 30 ? 1 : 0, 0, 0, (t === 30 ? BUTTON.INTERACT : 0) | (t > 90 ? BUTTON.SPRINT : 0) | (t === 250 ? BUTTON.JUMP : 0)));
    expect(net.stats.worstSteady).toBeLessThan(1e-3);
    expect((p.flags & FLAG.GROUNDED) !== 0 || p.y > 0).toBe(true);
  });

  it("a throw is the one server-side surprise: the client takes it as a single correction and is consistent again afterwards", () => {
    const w = new CollisionWorld({ height: () => 0 }, [{ kind: "box", x: 0, z: 0, hx: 30, hz: 0.5, yaw: 0, y0: -1, y1: 3 }], 400);
    const room = new MountRoom(w, 5);
    const p = room.addPlayer("a", 0, 120);
    room.mounts.spawnHorse({ x: 1.2, z: 120, yaw: 0 }, { coat: 3 });
    const net = new NetSim(room, "a", 100);
    for (let t = 0; t < 520; t++) net.step(frame(t > 30 ? 1 : 0, 0, 0, (t === 30 ? BUTTON.INTERACT : 0) | (t > 60 ? BUTTON.SPRINT : 0)));
    expect((p.flags & MOUNT_FLAG.MOUNTED) !== 0).toBe(false); // thrown by the wall
    expect(net.stats.flagFlips).toBeGreaterThanOrEqual(2);
    // after the throw the walker on both sides agree again
    const before = net.stats.worstSteady;
    for (let t = 0; t < 120; t++) net.step(frame(0, 0, 0));
    expect(Math.hypot(net.predicted.x - p.x, net.predicted.z - p.z)).toBeLessThan(0.05);
    expect(net.stats.worstSteady).toBeLessThan(before + 1e-3);
  });
});
