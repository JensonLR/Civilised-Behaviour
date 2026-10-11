import { describe, expect, it } from "vitest";
import { buildFolk, buildLampsideFolk, createArena, createFolkClock, createKessarWorld, createVillagerPose, setFolkClock, standingHeight, villagerAt, villagerFright, type CollisionWorld, type Folk, type VillagerPose } from "@cb/shared";
import { FEAR, FRIGHT, createFright, eachFolkNoise, folkNoiseCount, hearFright, noteFolkNoise, stepFright, type Fright } from "./folkFright.ts";

/** D-122: the townsfolk under fire, as the planner runs it over the pure schedule (the crowd does exactly this each frame). */

interface Trace {
  /** Per frame, per villager: x, z, visible, mode. */
  frames: { x: number; y: number; z: number; vis: boolean; mode: number; act: string; sx: number; sz: number; svis: boolean }[][];
  frights: Fright[];
  heard: boolean[];
}

/** Runs the folk for `secs` seconds from `hour`, with a noise at (nx, nz) of reach `r` at `at` seconds in (and optionally a second one). */
function run(world: CollisionWorld, folk: Folk, hour: number, nx: number, nz: number, r: number, secs: number, extra?: { at: number; x: number; z: number }): Trace {
  const clock = createFolkClock();
  const dt = 1 / 30;
  const n = folk.roster.length;
  const frights = folk.roster.map(() => createFright());
  const poses: VillagerPose[] = folk.roster.map(() => createVillagerPose());
  const heard = folk.roster.map(() => false);
  const frames: Trace["frames"] = [];
  setFolkClock(clock, 7, 0, hour, 30);
  const hourSec = clock.hourSec;
  for (let k = 0; k * dt < secs; k++) {
    const t = 100 + k * dt;
    setFolkClock(clock, 7, t * 1000, hour + (k * dt) / hourSec, 30);
    for (let i = 0; i < n; i++) villagerAt(folk, i, clock, poses[i]!);
    const sched = poses.map((p) => ({ x: p.x, z: p.z, vis: p.visible }));
    if (k === 1) for (let i = 0; i < n; i++) heard[i] = hearFright(frights[i]!, poses[i]!, nx, nz, r, t, 1, i);
    if (extra && Math.abs(k * dt - extra.at) < dt / 2) for (let i = 0; i < n; i++) hearFright(frights[i]!, poses[i]!, extra.x, extra.z, r, t, 2, i);
    for (let i = 0; i < n; i++) stepFright(frights[i]!, folk, world, i, poses[i]!, t, dt);
    frames.push(poses.map((p, i) => ({ x: p.x, y: p.y, z: p.z, vis: p.visible, mode: frights[i]!.mode, act: p.act, sx: sched[i]!.x, sz: sched[i]!.z, svis: sched[i]!.vis })));
  }
  return { frames, frights, heard };
}

/** Where most people are about at `hour`: the middle of the visible ones. */
function crowd(folk: Folk, hour: number): { x: number; z: number } {
  const clock = createFolkClock();
  setFolkClock(clock, 7, 0, hour, 30);
  const p = createVillagerPose();
  let x = 0, z = 0, c = 0;
  for (let i = 0; i < folk.roster.length; i++) {
    villagerAt(folk, i, clock, p);
    if (!p.visible) continue;
    x += p.x;
    z += p.z;
    c++;
  }
  return { x: x / c, z: z / c };
}

const hollow = createArena(7);
const hFolk = buildFolk(hollow, 7);
const kessar = createKessarWorld(7);
const kFolk = buildLampsideFolk(kessar, 7);

function checkRun(world: CollisionWorld, folk: Folk, hour: number, label: string): Trace {
  const c = crowd(folk, hour);
  const tr = run(world, folk, hour, c.x, c.z, FRIGHT.shotR, 75);
  const first = tr.frames[0]!;
  let frightened = 0;
  for (let i = 0; i < folk.roster.length; i++) {
    const p = first[i]!;
    const inRange = p.vis && p.act !== "sleep" && Math.hypot(p.x - c.x, p.z - c.z) <= FRIGHT.shotR;
    expect(tr.heard[i], `${label} ${folk.roster[i]!.name} in range ${inRange}`).toBe(inRange);
    if (inRange) frightened++;
  }
  expect(frightened, label).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < folk.roster.length; i++) {
    const v = folk.roster[i]!;
    let maxStep = 0;
    let off = 0;
    for (let k = 1; k < tr.frames.length; k++) {
      const a = tr.frames[k - 1]![i]!, b = tr.frames[k]![i]!;
      if (b.mode !== FEAR.none && b.vis && (b.mode === FEAR.flee || b.mode === FEAR.back || b.mode === FEAR.chase || b.mode === FEAR.blend)) {
        // wherever a frightened person moves to, a person can stand (nobody runs through a wall or into the water); where they froze is the schedule's own place
        if (Math.hypot(b.x - b.sx, b.z - b.sz) > 0.05 && standingHeight(world, b.x, b.z, b.y + 0.3) === undefined) off++;
      }
      if (a.vis && b.vis) maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.z - a.z));
    }
    expect(off, `${label} ${v.name}: drawn where nobody can stand`).toBe(0);
    // never faster than a run (nobody pops from place to place while in sight)
    expect(maxStep, `${label} ${v.name}: fastest step`).toBeLessThan((FRIGHT.runChild * 1.15 / 30) * 1.6 + 0.02);
  }
  // by the end everybody is back at ease, exactly where the schedule has them
  const last = tr.frames[tr.frames.length - 1]!;
  for (let i = 0; i < folk.roster.length; i++) {
    expect(tr.frights[i]!.mode, `${label} ${folk.roster[i]!.name} calm again`).toBe(FEAR.none);
    expect(Math.hypot(last[i]!.x - last[i]!.sx, last[i]!.z - last[i]!.sz), `${label} ${folk.roster[i]!.name} back in the schedule`).toBeLessThan(1e-6);
  }
  return tr;
}

describe("D-122: the townsfolk under fire", () => {
  it("Hollowmere: a shot among the villagers frightens exactly those within earshot; they run along the walks or get down, stand only where a person can, never pop, and are all back in their day a minute later", () => {
    const tr = checkRun(hollow, hFolk, 11, "hollowmere");
    // the old get down where they are; children run (home, where it is near: then they are out of sight)
    for (let i = 0; i < hFolk.roster.length; i++) {
      if (!tr.heard[i]) continue;
      const modes = new Set(tr.frames.map((f) => f[i]!.mode));
      const v = hFolk.roster[i]!;
      if (v.age === "elder") expect(modes.has(FEAR.flee), `${v.name} is too old to run`).toBe(false);
      if (v.age === "child") expect(modes.has(FEAR.flee) || modes.has(FEAR.cower), v.name).toBe(true);
    }
    const all = new Set(tr.frames.flatMap((f) => f.map((p) => p.mode)));
    for (const m of [FEAR.startle, FEAR.cower, FEAR.flee, FEAR.hidden]) expect(all.has(m), `somebody ${m}`).toBe(true);
    expect(tr.frames.some((f) => f.some((p) => p.act === "cower"))).toBe(true);
  });

  it("Lampside: the same in Kessar's lower town (the Kessarine go in by their back doors)", () => {
    const tr = checkRun(kessar, kFolk, 10.5, "lampside");
    expect(tr.frames.some((f) => f.some((p) => p.mode === FEAR.hidden))).toBe(true);
  });

  it("a shot carries 42 m and a blast 75: a shot off at the edge of the village frightens only those near it, a blast there the whole street", () => {
    const c = crowd(hFolk, 11);
    const x = c.x + 45, z = c.z;
    const shot = run(hollow, hFolk, 11, x, z, FRIGHT.shotR, 0.2);
    const blast = run(hollow, hFolk, 11, x, z, FRIGHT.blastR, 0.2);
    let deaf = 0;
    for (let i = 0; i < hFolk.roster.length; i++) {
      const p = shot.frames[0]![i]!;
      if (!p.vis || p.act === "sleep") continue;
      const d = Math.hypot(p.x - x, p.z - z);
      expect(shot.heard[i], hFolk.roster[i]!.name).toBe(d <= FRIGHT.shotR);
      expect(blast.heard[i], hFolk.roster[i]!.name).toBe(d <= FRIGHT.blastR);
      if (d > FRIGHT.shotR) deaf++;
    }
    expect(deaf, "people out of a shot's earshot").toBeGreaterThanOrEqual(3);
    expect(blast.heard.filter(Boolean).length).toBeGreaterThan(shot.heard.filter(Boolean).length);
  });

  it("a second shot while they are coming back out sends them down again, and the quiet starts over", () => {
    const c = crowd(hFolk, 11);
    const once = run(hollow, hFolk, 11, c.x, c.z, FRIGHT.shotR, 75);
    // (the first person back out: shoot again just as they are)
    let back = -1, when = Infinity;
    for (let i = 0; i < hFolk.roster.length; i++) {
      const k = once.frames.findIndex((f) => f[i]!.mode === FEAR.back || f[i]!.mode === FEAR.blend);
      if (k > 0 && k < when) {
        when = k;
        back = i;
      }
    }
    expect(back).toBeGreaterThanOrEqual(0);
    const p = once.frames[when]![back]!;
    const twice = run(hollow, hFolk, 11, c.x, c.z, FRIGHT.shotR, 75, { at: (when + 2) / 30, x: p.x, z: p.z });
    const after = twice.frames.slice(when + 3, when + 30).map((f) => f[back]!.mode);
    expect(after.some((m) => m === FEAR.startle || m === FEAR.cower || m === FEAR.flee)).toBe(true);
    // and they stay out of their day longer than the first time
    const calm1 = once.frames.findIndex((f, k) => k > 2 && f[back]!.mode === FEAR.none);
    const calm2 = twice.frames.findIndex((f, k) => k > when + 3 && f[back]!.mode === FEAR.none);
    expect(calm2 === -1 || calm2 > calm1).toBe(true);
  });

  it("is deterministic (two clients that hear the same shot see the same panic) and nobody asleep or indoors hears anything", () => {
    const c = crowd(hFolk, 11);
    const a = run(hollow, hFolk, 11, c.x, c.z, FRIGHT.blastR, 20);
    const b = run(hollow, hFolk, 11, c.x, c.z, FRIGHT.blastR, 20);
    expect(JSON.stringify(b.frames)).toBe(JSON.stringify(a.frames));
    // at three in the morning the village is in bed
    const night = run(hollow, hFolk, 3, c.x, c.z, FRIGHT.blastR, 2);
    for (let i = 0; i < hFolk.roster.length; i++) if (!night.frames[0]![i]!.vis) expect(night.heard[i]).toBe(false);
  });

  it("the noise ring: shots and blasts carry their own distance, a reader sees each once, and nonsense is ignored", () => {
    const seen: number[] = [];
    let at = folkNoiseCount();
    noteFolkNoise(1, 2, "shot");
    noteFolkNoise(3, 4, "blast");
    noteFolkNoise(Number.NaN, 0, "shot");
    at = eachFolkNoise(at, (_x, _z, r) => void seen.push(r));
    expect(seen).toEqual([FRIGHT.shotR, FRIGHT.blastR]);
    expect(eachFolkNoise(at, () => void seen.push(-1))).toBe(at);
    expect(seen).toHaveLength(2);
    // a reader far behind sees only the last 32
    const start = folkNoiseCount();
    for (let i = 0; i < 40; i++) noteFolkNoise(i, i, "shot");
    let count = 0;
    eachFolkNoise(start, () => void count++);
    expect(count).toBe(32);
  });

  it("what they cry out is their own people's (the Mereborn's and the Kessarine's), never the same pool", () => {
    const h = new Set(hFolk.roster.map((v, i) => villagerFright(v, i)));
    const k = new Set(kFolk.roster.map((v, i) => villagerFright(v, i)));
    for (const line of k) expect(h.has(line), line).toBe(false);
    expect(h.size).toBeGreaterThan(2);
    expect(k.size).toBeGreaterThan(2);
  });
});
