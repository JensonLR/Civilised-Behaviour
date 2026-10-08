import { REAL_WORLD_RE } from "@cb/shared";
import v8 from "node:v8";
import vm from "node:vm";
import { CAMP } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { ALL_DONE, ORIENT_BARS, ORIENT_STEPS, OrientationSampler, currentStep, doneCount, isActive, isDone, newOrientation, orientationStep, parseOrientation, serializeOrientation, skipOrientation, type Device, type OrientStep, type OrientationSample, type OrientationState } from "./orientationLogic.ts";
import { promptPlain } from "../input/glyphDom.ts";
import { ORIENT_HINT, ORIENT_STEP_NAME, ORIENT_TEXT } from "./orientationCopy.ts";
import { yawTo } from "./compassLogic.ts";
import * as copy from "./orientationCopy.ts";

const sample = (o: Partial<OrientationSample> = {}): OrientationSample => ({ walked: false, turned: false, pinned: false, sheet: "none", region: "hollowmere", down: false, device: "keyboard", ...o });
const run = (s: OrientationState, ...a: Partial<OrientationSample>[]): OrientationState => a.reduce((acc, x) => orientationStep(acc, sample(x)), s);

/** What each step needs, as the sample that completes it and the one that does not. */
const TABLE: [OrientStep, Partial<OrientationSample>, Partial<OrientationSample>][] = [
  ["move", { walked: true }, { walked: false }],
  ["look", { turned: true }, { turned: false }],
  ["pin", { pinned: true }, { pinned: false }],
  ["board", { sheet: "paper" }, { sheet: "other" }],
  ["supply", { sheet: "loadout" }, { sheet: "none" }],
  ["map", { sheet: "map" }, { sheet: "other" }],
];

describe("the orientation machine", () => {
  it("starts with nothing done, the first step current, and is active", () => {
    const s = newOrientation();
    expect(s).toEqual({ done: 0, skipped: false, finished: false });
    expect(currentStep(s)).toBe("move");
    expect(isActive(s)).toBe(true);
    expect(doneCount(s)).toBe(0);
    expect([...ORIENT_STEPS]).toEqual(["move", "look", "pin", "board", "supply", "map"]);
  });

  for (const device of ["keyboard", "pad"] as Device[]) {
    it(`every step completes from its sample and only from it (${device}): every transition`, () => {
      for (const [id, enough, short] of TABLE) {
        expect(isDone(run(newOrientation(), { ...short, device }), id), `${id} just short`).toBe(false);
        const done = run(newOrientation(), { ...enough, device });
        expect(isDone(done, id), `${id} enough`).toBe(true);
        // (D-040: opening the map room also finds it: the playtest's card kept "Find the map room" open after the room had been used)
        const implied: OrientStep[] = id === "map" ? ["pin"] : [];
        for (const i of implied) expect(isDone(done, i), `${id} implies ${i}`).toBe(true);
        expect(doneCount(done), `${id} ticks off only itself`).toBe(1 + implied.length);
        // the others are untouched and the current step is the first not done
        expect(currentStep(done)).toBe(id === "move" ? "look" : "move");
      }
    });
  }

  it("is a monotone fold: any order, never undone, and the same OBJECT comes back when nothing changed", () => {
    let s = newOrientation();
    const order = [...TABLE].reverse();
    for (const [id, enough] of order) {
      const next = orientationStep(s, sample(enough));
      if (!isDone(s, id)) expect(next).not.toBe(s); // (the map room, done first here, has already found itself)
      expect(isDone(next, id)).toBe(true);
      expect(orientationStep(next, sample(enough))).toBe(next); // nothing new: the same state, no allocation
      expect(orientationStep(next, sample())).toBe(next); // the sample dropping back undoes nothing
      s = next;
    }
    expect(s.finished).toBe(true);
    expect(s.done).toBe(ALL_DONE);
    expect(currentStep(s)).toBeUndefined();
    expect(isActive(s)).toBe(false);
  });

  it("finishing needs all six; five is not finished", () => {
    let s = newOrientation();
    for (const [, enough] of TABLE.slice(0, 5)) s = orientationStep(s, sample(enough));
    expect(s.finished).toBe(false);
    expect(doneCount(s)).toBe(5);
    s = orientationStep(s, sample(TABLE[5]![1]));
    expect(s.finished).toBe(true);
  });

  it("a skipped or finished orientation never moves again; skipping twice is the same state", () => {
    const skipped = skipOrientation(newOrientation());
    expect(skipped).toMatchObject({ skipped: true, finished: false });
    expect(isActive(skipped)).toBe(false);
    expect(orientationStep(skipped, sample({ walked: true, turned: true, pinned: true, sheet: "map" }))).toBe(skipped);
    expect(skipOrientation(skipped)).toBe(skipped);
    const mid = run(newOrientation(), { walked: true });
    const skippedMid = skipOrientation(mid);
    expect(skippedMid.done).toBe(mid.done); // what was done stays recorded
    const finished = run(newOrientation(), ...TABLE.map(([, e]) => e));
    expect(orientationStep(finished, sample({ sheet: "map" }))).toBe(finished);
  });

  it("is frozen away from HQ (the steps are about the camp) and while down, and resumes after", () => {
    for (const away of [{ region: "kessar" }, { down: true }]) {
      expect(orientationStep(newOrientation(), sample({ ...away, walked: true, sheet: "map" }))).toEqual(newOrientation());
    }
    const s = run(newOrientation(), { region: "kessar", walked: true }, { walked: true });
    expect(isDone(s, "move")).toBe(true);
  });

  it("resume: a stored state round-trips, and hostile storage is a fresh start that never throws", () => {
    for (const s of [newOrientation(), run(newOrientation(), { walked: true }), skipOrientation(run(newOrientation(), { sheet: "map" })), run(newOrientation(), ...TABLE.map(([, e]) => e))]) {
      expect(parseOrientation(serializeOrientation(s))).toEqual(s);
    }
    const junk: unknown[] = [null, undefined, 7, "", "x", "{", "[]", "null", '{"done":"3"}', '{"done":-1}', '{"done":64}', '{"done":1.5}', '{"done":1e99}', '{"done":null,"skipped":1}', "x".repeat(10_000), {}, [], true];
    for (const j of junk) expect(parseOrientation(j)).toEqual(newOrientation());
    for (let i = 0; i < 2000; i++) {
      const r = parseOrientation(Math.random() < 0.5 ? JSON.stringify({ done: Math.floor(Math.random() * 200) - 50, skipped: Math.random() < 0.5 }) : String.fromCharCode(...Array.from({ length: i % 40 }, () => 32 + Math.floor(Math.random() * 90))));
      expect(r.done).toBeGreaterThanOrEqual(0);
      expect(r.done).toBeLessThanOrEqual(ALL_DONE);
      expect(r.finished).toBe(r.done === ALL_DONE);
    }
  });

  it("the copy covers every step on both devices, fills the live keys, and names a hint for each device", () => {
    for (const id of ORIENT_STEPS) {
      expect(ORIENT_STEP_NAME[id].length).toBeGreaterThan(3);
      for (const d of ["keyboard", "pad"] as Device[]) expect(ORIENT_TEXT[id][d].length, `${id}/${d}`).toBeGreaterThan(20);
    }
    for (const d of ["keyboard", "pad"] as Device[]) expect(ORIENT_HINT[d].length).toBeGreaterThan(10);
    // the copy is written with prompt tokens, and each device fills them with its own glyph words
    const filled = promptPlain(ORIENT_TEXT.move.keyboard, "keyboard");
    expect(filled).toContain("W A S D");
    expect(filled).not.toContain("{");
    expect(promptPlain(ORIENT_TEXT.board.keyboard, "keyboard")).toContain("(E)");
    expect(promptPlain(ORIENT_TEXT.board.pad, "playstation")).toContain("(□)");
    expect(promptPlain(ORIENT_TEXT.board.pad, "xbox")).toContain("(X)");
    for (const id of ORIENT_STEPS) {
      expect(ORIENT_TEXT[id].pad).not.toMatch(/Mouse|mouse|\bE\b/); // the pad never reads a keyboard word
      for (const dev of ["keyboard", "xbox", "playstation"] as const) expect(promptPlain(ORIENT_TEXT[id][dev === "keyboard" ? "keyboard" : "pad"], dev), `${id}/${dev}`).not.toContain("{");
    }
    expect(promptPlain(ORIENT_HINT.pad, "playstation")).toContain("Share");
  });
});

describe("the orientation copy is fictional abroad (the Empire is London's: D-085)", () => {
  it("names no real nation, city, faith or flag but the Empire's own home", () => {
    const RE = REAL_WORLD_RE;
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(copy);
    expect(strings.length).toBeGreaterThan(20);
    for (const t of strings) expect(RE.test(t), t).toBe(false);
  });
});

describe("the sampler", () => {
  const table = CAMP.mapTable;

  it("a spawn is not a walk: the first frame only learns where you stand", () => {
    const sm = new OrientationSampler();
    sm.feed(1 / 60, 50, 50, 0, "hollowmere", "none", false, "keyboard");
    expect(sm.walkedMetres).toBe(0);
    expect(sm.turnedRadians).toBe(0);
  });

  it("walking adds its metres (a teleport is not a walk), turning adds its radians the short way round, and neither counts away from HQ or when down", () => {
    const sm = new OrientationSampler();
    sm.feed(1 / 60, 0, 0, 0, "hollowmere", "none", false, "keyboard");
    for (let i = 1; i <= 30; i++) sm.feed(1 / 60, i * 0.2, 0, 0, "hollowmere", "none", false, "keyboard");
    expect(sm.walkedMetres).toBeCloseTo(6, 6);
    expect(sm.sample.walked).toBe(true); // the bar is 6 m
    sm.feed(1 / 60, 100, 100, 0, "hollowmere", "none", false, "keyboard"); // a respawn
    expect(sm.walkedMetres).toBeCloseTo(6, 6);
    const t0 = sm.turnedRadians;
    sm.feed(1 / 60, 100, 100, 3.1, "hollowmere", "none", false, "keyboard");
    sm.feed(1 / 60, 100, 100, -3.1, "hollowmere", "none", false, "keyboard"); // across the wrap: 0.083, not 6.2
    expect(sm.turnedRadians - t0).toBeCloseTo(3.1 + (2 * Math.PI - 6.2), 6);
    const before = [sm.walkedMetres, sm.turnedRadians];
    sm.feed(1 / 60, 110, 100, 0, "kessar", "none", false, "keyboard");
    sm.feed(1 / 60, 120, 100, 1, "hollowmere", "none", true, "keyboard");
    expect([sm.walkedMetres, sm.turnedRadians]).toEqual(before);
    expect(sm.sample.sheet).toBe("none");
    // just short of each bar is not enough
    const short = new OrientationSampler();
    short.feed(1 / 60, 0, 0, 0, "hollowmere", "none", false, "keyboard");
    for (let i = 1; i <= 29; i++) short.feed(1 / 60, i * 0.2, 0, 0.0, "hollowmere", "none", false, "keyboard"); // 5.8 m
    expect(short.sample.walked).toBe(false);
    short.feed(1 / 60, 29 * 0.2 + 0.2, 0, 1.19, "hollowmere", "none", false, "keyboard"); // 6.0 m, 1.19 rad
    expect(short.sample.walked).toBe(true);
    expect(short.sample.turned).toBe(false);
    short.feed(1 / 60, 29 * 0.2 + 0.2, 0, 1.2, "hollowmere", "none", false, "keyboard");
    expect(short.sample.turned).toBe(true);
  });

  it("the survey table counts only dead ahead (within about 20 degrees) and within range, accumulates while it is, and drains when you look away", () => {
    const sm = new OrientationSampler();
    const x = 0;
    const z = 10;
    const ahead = yawTo(x, z, table.x, table.z);
    sm.feed(1 / 60, x, z, ahead + 1, "hollowmere", "none", false, "keyboard"); // first frame
    for (let i = 0; i < 30; i++) sm.feed(1 / 60, x, z, ahead + 1, "hollowmere", "none", false, "keyboard"); // looking elsewhere
    expect(sm.tableSeconds).toBe(0);
    expect(sm.sample.pinned).toBe(false);
    for (let i = 0; i < 30; i++) sm.feed(1 / 60, x, z, ahead + 0.2, "hollowmere", "none", false, "keyboard"); // half a second: not yet
    expect(sm.sample.pinned).toBe(false);
    for (let i = 0; i < 30; i++) sm.feed(1 / 60, x, z, ahead + 0.2, "hollowmere", "none", false, "keyboard");
    expect(sm.tableSeconds).toBeCloseTo(1, 1);
    expect(sm.sample.pinned).toBe(true);
    for (let i = 0; i < 60; i++) sm.feed(1 / 60, x, z, ahead + 1.5, "hollowmere", "none", false, "keyboard");
    expect(sm.tableSeconds).toBe(0); // drained
    // just outside the cone: never
    const edge = new OrientationSampler();
    edge.feed(1 / 60, x, z, ahead + 0.4, "hollowmere", "none", false, "keyboard");
    for (let i = 0; i < 300; i++) edge.feed(1 / 60, x, z, ahead + ORIENT_BARS.pinCone + 0.05, "hollowmere", "none", false, "keyboard");
    expect(edge.sample.pinned).toBe(false);
    // out of range: never
    const far = new OrientationSampler();
    for (let i = 0; i < 120; i++) far.feed(1 / 60, table.x, table.z + 80, yawTo(table.x, table.z + 80, table.x, table.z), "hollowmere", "none", false, "keyboard");
    expect(far.tableSeconds).toBe(0);
    expect(far.sample.pinned).toBe(false);
  });

  it("a real play-through completes every movement step: walk, look round, centre the pin, then the three sheets", () => {
    const sm = new OrientationSampler();
    let s = newOrientation();
    const feed = (dt: number, x: number, z: number, yaw: number, sheet: OrientationSample["sheet"] = "none"): void => {
      s = orientationStep(s, sm.feed(dt, x, z, yaw, "hollowmere", sheet, false, "pad"));
    };
    feed(1 / 60, 2, 2, 0);
    for (let i = 1; i <= 40; i++) feed(1 / 60, 2 - i * 0.2, 2, 0); // eight metres west
    expect(isDone(s, "move")).toBe(true);
    for (let i = 1; i <= 40; i++) feed(1 / 60, -6, 2, i * 0.05); // two radians round
    expect(isDone(s, "look")).toBe(true);
    const ahead = yawTo(-6, 2, table.x, table.z);
    for (let i = 0; i < 60; i++) feed(1 / 60, -6, 2, ahead);
    expect(isDone(s, "pin")).toBe(true);
    feed(1 / 60, -6, 2, ahead, "paper");
    feed(1 / 60, -6, 2, ahead, "loadout");
    expect(s.finished).toBe(false);
    feed(1 / 60, -6, 2, ahead, "map");
    expect(s.finished).toBe(true);
  });

  it("hostile numbers are ignored, reset forgets everything, and a frame allocates nothing", () => {
    const sm = new OrientationSampler();
    sm.feed(1 / 60, 0, 0, 0, "hollowmere", "none", false, "keyboard");
    for (const [dt, x, z, yaw] of [[NaN, 1, 1, 1], [1 / 60, NaN, 0, 0], [1 / 60, 0, Infinity, 0], [1 / 60, 0, 0, NaN], [-1, 1, 1, 1], [Infinity, 1, 1, 1]] as const) {
      expect(() => sm.feed(dt, x, z, yaw, "hollowmere", "none", false, "keyboard")).not.toThrow();
    }
    expect(Number.isFinite(sm.walkedMetres + sm.turnedRadians + sm.tableSeconds)).toBe(true);
    sm.reset();
    expect(sm.sample).toMatchObject({ walked: false, turned: false, pinned: false });
    expect([sm.walkedMetres, sm.turnedRadians, sm.tableSeconds]).toEqual([0, 0, 0]);

    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    let st = newOrientation();
    // (the arguments are numbers boxed ONCE, in arrays that also hold a string so their elements stay pointers: computing a double on the spot, or reading one out of a plain double
    // array, and passing it to a function that is not inlined boxes it per call, which would be the TEST allocating, not the sampler)
    const XS = [0.01, 0.0137, 0.0121, 0.0158, "pad"] as (number | string)[];
    const YS = [0.0013, 0.0029, 0.0021, 0.0037, "pad"] as (number | string)[];
    const frame = (i: number): void => {
      st = orientationStep(st, sm.feed(1 / 60, XS[i & 3] as number, 0, YS[(i >> 2) & 3] as number, "hollowmere", "none", false, "keyboard"));
    };
    for (let i = 0; i < 50_000; i++) frame(i);
    const deltas: number[] = [];
    for (let k = 0; k < 5; k++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 10_000; i++) frame(i);
      deltas.push(process.memoryUsage().heapUsed - before);
    }
    deltas.sort((a, b) => a - b);
    expect(deltas[2]!).toBeLessThan(64 * 1024);
  });
});
