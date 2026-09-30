import { describe, expect, it } from "vitest";
import { CAMP, HILL } from "@cb/shared";
import { DEG, distanceText, headingDegrees, headingName, headingName16, isCardinal, landmarks, stackRows, stripPlace, wrapPi, yawTo, type StripPlace } from "./compassLogic.ts";
import { describeError, stepAt } from "./menuLogic.ts";
import { TelegramQueue, readingTime } from "./telegramQueue.ts";
import { VITALS_LABEL, vitalsLevel } from "./vitals.ts";
import { plaqueVisible } from "./SoundPlaque.ts";

describe("heading strip maths", () => {
  it("yaw 0 looks north (-Z); a positive yaw turns left, so east (+X) is yaw -90 degrees", () => {
    expect(headingDegrees(0)).toBe(0);
    expect(headingName(0)).toBe("N");
    expect(headingDegrees(-Math.PI / 2)).toBe(90);
    expect(headingName(90)).toBe("E");
    expect(headingDegrees(Math.PI / 2)).toBe(270);
    expect(headingDegrees(Math.PI)).toBe(180);
    expect(headingDegrees(Math.PI * 4 + 0.01)).toBe(359);
    expect(headingName16(337)).toBe("NNW");
    expect(headingName16(22)).toBe("NNE");
  });

  it("yawTo points the camera at a place: standing at the origin, a point due east is yaw -90, due north yaw 0", () => {
    expect(yawTo(0, 0, 10, 0) * DEG).toBeCloseTo(-90, 6);
    expect(yawTo(0, 0, 0, -10)).toBeCloseTo(0, 9);
    expect(Math.abs(yawTo(0, 0, 0, 10))).toBeCloseTo(Math.PI, 9);
    // and looking that way makes the heading agree with the compass
    expect(headingDegrees(yawTo(5, 5, 15, 5))).toBe(90);
  });

  it("a bearing ahead sits in the middle notch, left is negative, right positive, and far ones pin to the edge and say so", () => {
    const p: StripPlace = { x: 0, inside: true };
    stripPlace(0.3, 0.3, 150, p);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.inside).toBe(true);
    stripPlace(0, 0.5, 150, p); // the place is 28 degrees to the LEFT of the view
    expect(p.x).toBeLessThan(0);
    stripPlace(0, -0.5, 150, p);
    expect(p.x).toBeGreaterThan(0);
    stripPlace(0, Math.PI * 0.9, 150, p);
    expect(p.inside).toBe(false);
    expect(Math.abs(p.x)).toBe(1);
    // wraps: 359 degrees round the clock is the same as -1
    stripPlace(Math.PI - 0.01, -Math.PI + 0.01, 150, p);
    expect(p.inside).toBe(true);
    expect(wrapPi(7 * Math.PI)).toBeCloseTo(Math.PI, 9);
  });

  it("knows the camp, Hollowmere and the Observatory from the shared plan, each a real distance from the spawn", () => {
    const l = landmarks();
    expect(l.map((x) => x.id)).toEqual(["camp", "village", "observatory"]);
    expect(l[0]).toMatchObject({ x: CAMP.fire.x, z: CAMP.fire.z });
    expect(l[2]).toMatchObject({ x: HILL.x, z: HILL.z });
    for (const m of l) expect(Number.isFinite(m.x + m.z)).toBe(true);
    expect(Math.hypot(l[1]!.x, l[1]!.z)).toBeGreaterThan(30); // the village is a walk away
  });

  it("formats distances, marks the cardinals, and stacks chips so none overlaps another", () => {
    expect(distanceText(0.4)).toBe("0 m");
    expect(distanceText(64.4)).toBe("64 m");
    expect(distanceText(1530)).toBe("1.5 km");
    expect(isCardinal(180)).toBe(true);
    expect(isCardinal(45)).toBe(false);
    const rows: number[] = [];
    // three chips nearly on top of each other go to three rows; a far one shares row 0 with the first
    stackRows([{ x: 0.5, width: 0.3 }, { x: 0.55, width: 0.3 }, { x: 0.6, width: 0.3 }, { x: 0.95, width: 0.1 }], 0.01, 3, rows);
    expect(rows.slice(0, 3).sort()).toEqual([0, 1, 2]);
    expect(rows[3]).toBe(0);
    // never more rows than allowed
    stackRows(Array.from({ length: 6 }, () => ({ x: 0.5, width: 0.4 })), 0, 2, rows);
    expect(Math.max(...rows)).toBe(1);
  });
});

describe("telegram queue", () => {
  it("shows up to its limit and queues the rest in order; a slip leaves when read and the next takes its place", () => {
    const q = new TelegramQueue(2);
    for (const t of ["a", "b", "c", "d"]) q.push(t, 3);
    expect(q.shown.map((s) => s.text)).toEqual(["a", "b"]);
    expect(q.queued).toBe(2);
    expect(q.tick(2)).toBe(false);
    expect(q.tick(1.1)).toBe(true);
    expect(q.shown.map((s) => s.text)).toEqual(["c", "d"]);
    expect(q.queued).toBe(0);
    q.tick(10);
    expect(q.shown).toEqual([]);
  });

  it("the same news twice in a moment is one slip; blank is nothing; a long wait caps the queue by dropping the oldest waiting", () => {
    const q = new TelegramQueue(1, 3);
    expect(q.push("rout")).toBe(true);
    expect(q.push("rout")).toBe(false);
    expect(q.push("   ")).toBe(false);
    for (let i = 0; i < 6; i++) q.push(`n${i}`);
    expect(q.queued).toBe(3);
    q.tick(60);
    expect(q.shown[0]!.text).toBe("n3"); // n0..n2 were pushed out by newer news
    q.tick(5);
    q.push("rout"); // long enough after: a fresh slip
    expect(q.queued + q.shown.length).toBeGreaterThan(0);
  });

  it("reading time grows with length between 4 and 11 seconds", () => {
    expect(readingTime("hi")).toBe(4);
    expect(readingTime("x".repeat(60))).toBeGreaterThan(5.5);
    expect(readingTime("x".repeat(1000))).toBe(11);
  });
});

describe("vitals", () => {
  it("levels: nothing above 55%, shaken to 35%, critical below, down at zero or when downed; the gauge label says so in words", () => {
    expect(vitalsLevel(100, false)).toBe(0);
    expect(vitalsLevel(56, false)).toBe(0);
    expect(vitalsLevel(55, false)).toBe(1);
    expect(vitalsLevel(35, false)).toBe(2);
    expect(vitalsLevel(1, false)).toBe(2);
    expect(vitalsLevel(0, false)).toBe(3);
    expect(vitalsLevel(80, true)).toBe(3);
    expect(VITALS_LABEL[2]).toMatch(/critical/i);
    expect(VITALS_LABEL[3]).toMatch(/down/i);
  });
});

describe("front door words", () => {
  it("turns a network failure into the telegraph being down, but keeps a real reason (a bad code, a full party) as it is", () => {
    expect(describeError(new Error("Failed to fetch"))).toMatch(/telegraph line is down/i);
    expect(describeError(new Error("WebSocket connection refused"))).toMatch(/telegraph line is down/i);
    expect(describeError(new Error("No such expedition"))).toBe("No such expedition");
    expect(describeError(new Error("The expedition is full"))).toBe("The expedition is full");
    expect(describeError(undefined)).toMatch(/regrets/i);
    expect(describeError(new Error("x".repeat(400))).length).toBeLessThanOrEqual(160);
  });

  it("the waiting card grows more candid the longer it waits, unless a stage has been named", () => {
    expect(stepAt(0)).toMatch(/telegram/i);
    expect(stepAt(10)).toMatch(/slow/i);
    expect(stepAt(30)).toMatch(/down|back/i);
    expect(stepAt(30, "Surveying the territory...")).toBe("Surveying the territory...");
  });

  it("the sound plaque is shown while the browser is waiting for a gesture, not once running, not without sound, not at zero volume", () => {
    expect(plaqueVisible("idle", 0.8)).toBe(true);
    expect(plaqueVisible("suspended", 0.8)).toBe(true);
    expect(plaqueVisible("running", 0.8)).toBe(false);
    expect(plaqueVisible("unsupported", 0.8)).toBe(false);
    expect(plaqueVisible("idle", 0)).toBe(false);
  });
});
