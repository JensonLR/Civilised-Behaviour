import { createConnection, createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { releaseAt, startBadNet, type BadNetOptions } from "./badnet.ts";

const O: BadNetOptions = { delayMs: 40, jitterMs: 30, stallP: 0.2, stallMs: 250, seed: 7 };

describe("badnet: the bad-network relay the playtest runs through", () => {
  it("every chunk waits at least the delay, at most delay + jitter + a stall, and never overtakes the one ahead (TCP order)", () => {
    let last = 0, stalls = 0;
    let seed = 1;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const now = i * 5;
      const r = releaseAt(now, last, O, rand);
      expect(r.at).toBeGreaterThanOrEqual(last);
      expect(r.at - now).toBeGreaterThanOrEqual(O.delayMs);
      if (r.at > last) expect(r.at - now).toBeLessThanOrEqual(O.delayMs + O.jitterMs + (r.stalled ? O.stallMs : 0) + 1e-9);
      if (r.stalled) stalls++;
      last = r.at;
    }
    expect(stalls / 2000).toBeGreaterThan(0.15);
    expect(stalls / 2000).toBeLessThan(0.25);
  });

  it("relays bytes both ways, in order, late", async () => {
    const echo = createServer((s) => s.on("data", (b) => s.write(b)));
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
    const target = (echo.address() as { port: number }).port;
    const net = await startBadNet(0, target, { delayMs: 30, jitterMs: 10, stallP: 0.3, stallMs: 60, seed: 3 });
    const c = createConnection({ host: "127.0.0.1", port: net.port });
    const got: string[] = [];
    const t0 = Date.now();
    await new Promise<void>((done) => {
      c.on("data", (b) => {
        got.push(b.toString());
        if (got.join("").length >= 30) done();
      });
      c.on("connect", () => {
        for (let i = 0; i < 10; i++) setTimeout(() => c.write(String(i).padStart(3, "0")), i * 3);
      });
    });
    expect(got.join("")).toBe(Array.from({ length: 10 }, (_, i) => String(i).padStart(3, "0")).join(""));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(60);   // there and back, 30 ms each way at least
    expect(net.stats().chunks).toBeGreaterThan(0);
    c.destroy();
    await net.close();
    await new Promise<void>((r) => echo.close(() => r()));
  });
});
