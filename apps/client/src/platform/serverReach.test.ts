import { describe, expect, it, vi } from "vitest";
import { isBusyRefusal, patientProgress, probeServer, reachText, retryBusy } from "./serverReach.ts";
import { REACH_BUSY, REACH_DOWN, REACH_UP, REACH_WAKING } from "./reachCopy.ts";

describe("probeServer", () => {
  it("asks /health over http(s) whatever scheme the game uses, and answers up only on ok", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ({ ok: true }) as Response);
    expect(await probeServer("wss://cb.example.test/", f as never)).toBe("up");
    expect(f.mock.calls[0]![0]).toBe("https://cb.example.test/health");
    expect(await probeServer("ws://localhost:2567", f as never)).toBe("up");
    expect(f.mock.calls[1]![0]).toBe("http://localhost:2567/health");
    expect(await probeServer("http://x.test", (async () => ({ ok: false }) as Response) as never)).toBe("down");
  });
  it("any failure, a bad url or a hang is simply down, never a throw", async () => {
    expect(await probeServer("https://x.test", (async () => { throw new TypeError("offline"); }) as never)).toBe("down");
    expect(await probeServer("file:///etc/passwd", (async () => ({ ok: true }) as Response) as never)).toBe("down");
    expect(await probeServer("", (async () => ({ ok: true }) as Response) as never)).toBe("down");
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as never;
    expect(await probeServer("https://x.test", hang, 20)).toBe("down");
  });
  it("says so in the Society's words", () => {
    expect(reachText("up")).toBe(REACH_UP);
    expect(reachText("down")).toBe(REACH_DOWN);
  });
});

describe("patientProgress (D-051: a sleeping free-tier server takes up to a minute to wake)", () => {
  it("shows the first step, says the server is waking only if the step outlasts the wait, and never after it ends", () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const slow = patientProgress((t) => seen.push(t), "Posting the telegram...", 6000);
      vi.advanceTimersByTime(5999);
      expect(seen).toEqual(["Posting the telegram..."]);
      vi.advanceTimersByTime(1);
      expect(seen).toEqual(["Posting the telegram...", REACH_WAKING]);
      slow();
      const fast: string[] = [];
      const done = patientProgress((t) => fast.push(t), "Presenting your code...", 6000);
      vi.advanceTimersByTime(2000);
      done();
      done();
      vi.advanceTimersByTime(60_000);
      expect(fast).toEqual(["Presenting your code..."]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retryBusy (D-051: a busy server refuses new rooms for a moment)", () => {
  const busy = Object.assign(new Error("The Society's offices are full just now."), { code: 503 });
  it("asks again while the answer is 503 and says so; succeeds when the server makes room; gives up after the last try", async () => {
    const seen: string[] = [];
    const waits: number[] = [];
    let n = 0;
    const ok = await retryBusy(async () => (++n < 3 ? Promise.reject(busy) : "room"), (t) => seen.push(t), 3, 8000, async (ms) => void waits.push(ms));
    expect(ok).toBe("room");
    expect(seen).toEqual([REACH_BUSY, REACH_BUSY]);
    expect(waits).toEqual([8000, 8000]);
    n = 0;
    await expect(retryBusy(async () => { n++; throw busy; }, () => undefined, 3, 1, async () => undefined)).rejects.toBe(busy);
    expect(n).toBe(3);
  });
  it("anything but a 503 (a refused resume, a 429, a dead network) is thrown at once", async () => {
    for (const e of [Object.assign(new Error("No expedition by that code"), { code: 4000 }), Object.assign(new Error("Too many"), { code: 429 }), new TypeError("Failed to fetch")]) {
      let n = 0;
      await expect(retryBusy(async () => { n++; throw e; }, () => undefined, 3, 1, async () => undefined)).rejects.toBe(e);
      expect(n).toBe(1);
      expect(isBusyRefusal(e)).toBe(false);
    }
    expect(isBusyRefusal(busy)).toBe(true);
  });
});
