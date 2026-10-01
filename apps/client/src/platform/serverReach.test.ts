import { describe, expect, it, vi } from "vitest";
import { probeServer, reachText } from "./serverReach.ts";
import { REACH_DOWN, REACH_UP } from "./reachCopy.ts";

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
