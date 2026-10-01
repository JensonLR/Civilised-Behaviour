import { describe, expect, it } from "vitest";
import { CROWD_MESH_BUDGET, SERVER_BUDGET, budgetSlack, judgeSoak, percentile, roomsPerProcess, type SoakReport } from "./budgets.ts";
import { DEMO, demoPhase, demoRemainingS, isDemoRegion, wishlistUrl } from "./demo.ts";
import { ACHIEVEMENTS, connectString, createNoopPlatform, isAchievementId, parseConnect } from "./platform.ts";
import { REGIONS } from "./regions.ts";

const tick = (p50: number, p95: number, p99: number, max: number, samples = 3000) => ({ samples, p50Ms: p50, p95Ms: p95, p99Ms: p99, maxMs: max, overruns: 0 });
const good = (): Omit<SoakReport, "failures"> => ({
  v: 1, scenario: "t", node: "v22", rooms: 2, botsPerRoom: 4, npcRows: 18, durationS: 120, tick: { rooms: [tick(2, 6, 10, 20), tick(2, 7, 11, 22)], all: tick(2, 7, 11, 22, 6000) }, sections: {},
  heap: { startMB: 60, endMB: 62, growthMBPerHour: 4, afterGc: true }, rssMB: 200, net: { downBytesPerClientPerS: 9000, upBytesPerClientPerS: 2000, messagesPerClientPerS: 40 }, bots: { correctionMax: 0.3, driftPeak: 0.4 },
});

describe("ship-slice contract: budgets, demo policy, platform seam (D-036)", () => {
  it("the budget table is internally consistent", () => {
    expect(SERVER_BUDGET.p50Ms).toBeLessThan(SERVER_BUDGET.p95Ms);
    expect(SERVER_BUDGET.p95Ms).toBeLessThan(SERVER_BUDGET.p99Ms);
    expect(SERVER_BUDGET.p99Ms).toBeLessThan(SERVER_BUDGET.maxMs);
    expect(SERVER_BUDGET.maxMs).toBeCloseTo(33.33, 1);
    expect(CROWD_MESH_BUDGET.low).toBeLessThan(CROWD_MESH_BUDGET.medium);
    expect(CROWD_MESH_BUDGET.medium).toBeLessThan(CROWD_MESH_BUDGET.high);
  });
  it("percentile is nearest-rank and judgeSoak names every broken budget (and slack only widens time budgets)", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
    expect(judgeSoak(good(), 1)).toEqual([]);
    const bad = good();
    bad.tick.rooms[0] = tick(2, 15, 10, 40, 500);
    bad.heap = { startMB: 1, endMB: 500, growthMBPerHour: 400, afterGc: false };
    bad.net.downBytesPerClientPerS = 99_999;
    const f = judgeSoak(bad, 1);
    expect(f.some((x) => x.includes("only 500 ticks"))).toBe(true);
    expect(f.some((x) => x.includes("p95"))).toBe(true);
    expect(f.some((x) => x.includes("max ms"))).toBe(true);
    expect(f.some((x) => x.includes("heap growth"))).toBe(true);
    expect(f.some((x) => x.includes("forced GC"))).toBe(true);
    expect(f.some((x) => x.includes("down bytes"))).toBe(true);
    const slow = good();
    slow.tick.rooms[0] = tick(2, 20, 30, 50);
    expect(judgeSoak(slow, 1).length).toBeGreaterThan(0);
    expect(judgeSoak(slow, 2).filter((x) => x.includes("tick")).length).toBeLessThan(judgeSoak(slow, 1).filter((x) => x.includes("tick")).length);
    expect(budgetSlack({ CB_BUDGET_SLACK: "2" })).toBe(2);
    expect(budgetSlack({ CB_BUDGET_SLACK: "banana" })).toBe(1);
    expect(budgetSlack({ CB_BUDGET_SLACK: "0.1" })).toBe(1);
    expect(roomsPerProcess(6)).toBe(3);
    expect(roomsPerProcess(40)).toBe(1);
  });
  it("the demo is Kessar-only by policy, bounded in time, and the wishlist link must be https", () => {
    expect(DEMO.regions).toEqual(["hollowmere", "kessar"]);
    expect(isDemoRegion("kessar")).toBe(true);
    expect(isDemoRegion("highmark")).toBe(false);
    expect(isDemoRegion(42)).toBe(false);
    expect(demoRemainingS(0, 0)).toBe(DEMO.sessionMinutes * 60);
    expect(demoRemainingS(0, 1e12)).toBe(0);
    expect(demoRemainingS(Number.NaN, 5)).toBe(0);
    expect(demoPhase(DEMO.sessionMinutes * 60)).toBe("open");
    expect(demoPhase(9 * 60)).toBe("warn");
    expect(demoPhase(90)).toBe("last");
    expect(demoPhase(0)).toBe("over");
    expect(wishlistUrl("https://store.example/app/1")).toBe("https://store.example/app/1");
    for (const bad of ["http://x.example", "javascript:alert(1)", "", 7, undefined, "https://" + "a".repeat(400)]) expect(wishlistUrl(bad), String(bad)).toBeUndefined();
    // the demo never reaches a region the paid game adds
    for (const id of DEMO.regions) expect(REGIONS[id].reachable).toBe(true);
  });
  it("the no-op platform is inert, and an invite can only ever carry a valid join code", () => {
    const p = createNoopPlatform();
    expect(p.available).toBe(false);
    expect(() => { p.unlock("first_crossing"); p.setPresence({ where: "hq", party: 1, day: 1 }); p.onInvite(() => {})(); p.shutdown(); }).not.toThrow();
    expect(ACHIEVEMENTS.length).toBe(new Set(ACHIEVEMENTS).size);
    expect(isAchievementId("first_crossing")).toBe(true);
    expect(isAchievementId("godmode")).toBe(false);
    expect(connectString("ABCDE")).toBe("+join ABCDE");
    expect(connectString("abcde")).toBeUndefined();
    expect(parseConnect("+join ABCDE")).toBe("ABCDE");
    expect(parseConnect(["game.exe", "+join", "ABCDE"])).toBe("ABCDE");
    expect(parseConnect("ABCDE")).toBe("ABCDE");
    for (const evil of ["+join ../../etc", "+join ABCDEF", "'; DROP", ["+join", { x: 1 }], 7, null, "+join " + "A".repeat(10_000)]) expect(parseConnect(evil), JSON.stringify(evil)).toBeUndefined();
  });
});
