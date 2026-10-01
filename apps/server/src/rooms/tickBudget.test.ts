import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_BUDGET, budgetSlack, judgeSoak, roomsPerProcess, type SoakReport } from "@cb/shared";
import { runSoak } from "../bots/soak/index.ts";
import { metrics } from "../metrics.ts";
import { Cast } from "../systems/Cast.ts";

/**
 * The tick budget, enforced (D-036, package Q): a SHORT real run of the soak harness (real room, the town at the crossing, 24 NPC rows, 4 bots with the browser's prediction wiring,
 * a file store in a temp dir) judged by `judgeSoak` against `SERVER_BUDGET`; the long numbers are `node scripts/soak.mjs` and docs/PERFORMANCE.md. CI-safe: `CB_BUDGET_SLACK=2` doubles
 * every time budget on a noisy host (memory and bandwidth never). A second run proves the judge can fail: a 15 ms busy-wait in `Cast.tick` must be named. Ports 2583 (the CLI) and 2584.
 */

const PORT = 2584; // one port per integration test file (2583 is scripts/soak.mjs)
const CI_SECONDS = 20; // 600 ticks per room: enough for a p99 of a CI-sized claim, not a heap trend
const MIN_SAMPLES = 500;

const finite = (o: unknown, path = "report"): void => {
  if (typeof o === "number") expect(Number.isFinite(o), `${path} is finite`).toBe(true);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) finite(v, `${path}.${k}`);
};
const leftovers = (): string[] => readdirSync(tmpdir()).filter((f) => f.startsWith("cb-soak-"));
const timers = (): number => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
const portFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

describe("the server tick budget under a real soak (4 bots, the town, 24 NPC rows)", () => {
  const realTick = Cast.prototype.tick;
  afterEach(() => {
    Cast.prototype.tick = realTick;
  });

  it("holds SERVER_BUDGET over a 20 s window, the report is complete, and the harness leaves nothing behind", async () => {
    const dirsBefore = leftovers().length;
    const timersBefore = timers();
    const r = await runSoak({ rooms: 1, botsPerRoom: 4, npcs: 24, seconds: CI_SECONDS, scenario: "mixed", seed: 11, port: PORT, reconnectS: 6 });

    // complete and finite: every field a reader (PERFORMANCE.md, the nightly workflow) uses
    finite(r);
    expect(r.v).toBe(1);
    expect(r.scenario).toBe("mixed");
    expect(r.rooms).toBe(1);
    expect(r.botsPerRoom).toBe(4);
    expect(r.npcRows).toBeGreaterThanOrEqual(20);
    expect(r.durationS).toBeGreaterThanOrEqual(CI_SECONDS - 1);
    expect(r.tick.rooms).toHaveLength(1);
    expect(r.tick.rooms[0]!.samples).toBeGreaterThan(MIN_SAMPLES);
    expect(r.tick.all.samples).toBe(r.tick.rooms[0]!.samples);
    const t = r.tick.all;
    expect(t.p50Ms).toBeGreaterThan(0);
    expect(t.p50Ms).toBeLessThanOrEqual(t.p95Ms);
    expect(t.p95Ms).toBeLessThanOrEqual(t.p99Ms);
    expect(t.p99Ms).toBeLessThanOrEqual(t.maxMs);
    for (const s of ["inputs", "mounts", "scenario", "cast", "followers", "casualties", "combat", "physics", "props", "travel", "other", "patch"]) expect(r.sections[s], s).toBeDefined();
    expect(r.sections.cast!.avgMs).toBeGreaterThan(0);
    expect(r.sections.physics!.avgMs).toBeGreaterThan(0);
    expect(r.sections.patch!.avgMs).toBeGreaterThan(0);
    expect(r.heap.afterGc).toBe(true);
    expect(r.heap.startMB).toBeGreaterThan(10);
    expect(r.rssMB).toBeGreaterThan(50);
    expect(r.net.downBytesPerClientPerS).toBeGreaterThan(500); // frames really were counted at the server's sockets
    expect(r.net.upBytesPerClientPerS).toBeGreaterThan(20); // and at the bots'
    expect(r.net.messagesPerClientPerS).toBeGreaterThan(5);
    expect(r.bots.correctionMax).toBeLessThanOrEqual(SERVER_BUDGET.correctionMaxM);
    // the bots really did something (a soak that stood still would pass every budget), and one of them left and came back
    expect(r.activity!.walkedM).toBeGreaterThan(100);
    expect(r.activity!.reconnects).toBeGreaterThanOrEqual(1);
    expect(r.activity!.saves).toBeGreaterThanOrEqual(1);

    // the verdict: every budget but the heap TREND (20 s cannot extrapolate to an hour; the long run owns that one)
    const slack = budgetSlack();
    const verdict = judgeSoak({ ...(r as Omit<SoakReport, "failures">), heap: { ...r.heap, growthMBPerHour: 0 } }, slack, MIN_SAMPLES);
    expect(verdict, verdict.join("; ")).toEqual([]);
    expect(r.heap.endMB - r.heap.startMB, "the heap barely moved in the window").toBeLessThan(40);
    // the capacity claim is arithmetic on the measured p95 (a floor, never above what the budget allows)
    expect(roomsPerProcess(t.p95Ms)).toBeGreaterThanOrEqual(roomsPerProcess(SERVER_BUDGET.p95Ms));

    // nothing left behind: rooms, port, timers, temp directory
    await new Promise((res) => setTimeout(res, 300));
    expect(metrics.rooms).toBe(0);
    expect(await portFree(PORT)).toBe(true);
    expect(leftovers().length).toBe(dirsBefore);
    expect(timers()).toBeLessThanOrEqual(timersBefore);
  }, 120_000);

  it("the judge can fail: a 15 ms busy-wait in Cast.tick (a slow brain) is named by judgeSoak", async () => {
    Cast.prototype.tick = function (this: Cast, dt: number): void {
      const t0 = performance.now();
      realTick.call(this, dt);
      while (performance.now() - t0 < 15) { /* the mutation */ }
    };
    const r = await runSoak({ rooms: 1, botsPerRoom: 2, npcs: 12, seconds: 6, scenario: "garrison", seed: 11, port: PORT, reconnectS: 0 });
    Cast.prototype.tick = realTick;
    expect(r.sections.cast!.avgMs).toBeGreaterThan(14);
    expect(r.tick.all.p50Ms).toBeGreaterThan(14);
    const verdict = judgeSoak({ ...(r as Omit<SoakReport, "failures">), heap: { ...r.heap, growthMBPerHour: 0 } }, 1, 100);
    expect(verdict.some((l) => /tick p50 ms/.test(l)), verdict.join("; ")).toBe(true);
    expect(verdict.some((l) => /tick p95 ms/.test(l))).toBe(true);
    expect(r.failures.length).toBeGreaterThan(0); // and runSoak's own verdict (what scripts/soak.mjs exits on) agrees
  }, 60_000);

  it("rejects nonsense options before it starts anything", async () => {
    await expect(runSoak({ rooms: 0 })).rejects.toThrow(/rooms/);
    await expect(runSoak({ botsPerRoom: 9 })).rejects.toThrow(/botsPerRoom/);
    await expect(runSoak({ npcs: 99 })).rejects.toThrow(/npcs/);
    await expect(runSoak({ seconds: 0 })).rejects.toThrow(/seconds/);
    expect(await portFree(PORT)).toBe(true);
  });
});
