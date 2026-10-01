import { readFileSync } from "node:fs";
import { CloseCode } from "@colyseus/core";
import { describe, expect, it } from "vitest";
import { DEMO, DEMO_OVER_TEXT, DEMO_REFUSED_TEXT, REGION_IDS, demoWarnText, parseDemoWarn } from "@cb/shared";
import { Demo, parseDemoEnv, type DemoHost } from "./Demo.ts";

function fake(startedAtMs = 1_000_000) {
  const log: { notices: string[]; closes: number[] } = { notices: [], closes: [] };
  const host = { t: startedAtMs, startedAtMs, now() { return this.t; }, notice(s: string) { log.notices.push(s); }, closeAll(c: number) { log.closes.push(c); } } satisfies DemoHost & { t: number };
  return { host, log };
}
const SESSION = DEMO.sessionMinutes * 60 * 1000;

describe("Demo (fake host, fake clock)", () => {
  it("warns once at 10 and once at 2 minutes left, closes once at zero with the demo code", () => {
    const { host, log } = fake();
    const d = new Demo(host);
    d.tick();
    expect(log.notices).toEqual([]);
    host.t = host.startedAtMs + SESSION - 10 * 60 * 1000 + 1000;
    for (let i = 0; i < 50; i++) d.tick();
    expect(log.notices.map(parseDemoWarn)).toEqual([10]);
    host.t = host.startedAtMs + SESSION - 2 * 60 * 1000 + 500;
    for (let i = 0; i < 50; i++) d.tick();
    expect(log.notices.map(parseDemoWarn)).toEqual([10, 2]);
    expect(log.closes).toEqual([]);
    host.t = host.startedAtMs + SESSION;
    for (let i = 0; i < 50; i++) d.tick();
    expect(log.closes).toEqual([DEMO.closeCode]);
    expect(log.notices[log.notices.length - 1]).toBe(DEMO_OVER_TEXT);
    expect(d.ended).toBe(true);
    host.t += 10 * SESSION;
    d.tick();
    d.tick();
    expect(log.closes).toHaveLength(1);
    expect(log.notices).toHaveLength(3);
    expect(d.remainingS()).toBe(0);
  });

  it("a stalled process that jumps past both thresholds sends one warning (the urgent one), never a repeat", () => {
    const { host, log } = fake();
    const d = new Demo(host);
    host.t = host.startedAtMs + SESSION - 60_000;
    d.tick();
    d.tick();
    expect(log.notices.map(parseDemoWarn)).toEqual([2]);
    expect(log.notices[0]).toBe(demoWarnText(2));
  });

  it("refuses Highmark (with a notice, rate limited), every unknown or forged `to` (silently) and allows the demo regions", () => {
    const { host, log } = fake();
    const d = new Demo(host);
    for (const ok of DEMO.regions) expect(d.regionAllowed(ok)).toBe(true);
    expect(log.notices).toEqual([]);
    expect(d.regionAllowed("highmark")).toBe(false);
    expect(log.notices).toEqual([DEMO_REFUSED_TEXT]);
    expect(d.regionAllowed("highmark")).toBe(false);
    expect(log.notices).toHaveLength(1);
    host.t += 5000;
    expect(d.regionAllowed("highmark")).toBe(false);
    expect(log.notices).toHaveLength(2);
    const before = log.notices.length;
    for (const forged of [undefined, null, 0, 1, true, {}, [], ["kessar"], { toString: () => "kessar" }, "KESSAR", "kessar ", "kessar\0", "__proto__", "constructor", "", "x".repeat(10_000), Symbol("kessar")]) {
      expect(d.regionAllowed(forged), String(typeof forged)).toBe(false);
    }
    expect(log.notices).toHaveLength(before);
    // every region that exists is either a demo region or refused
    for (const r of REGION_IDS) expect(d.regionAllowed(r)).toBe((DEMO.regions as readonly string[]).includes(r));
  });

  it("refuses everything once over", () => {
    const { host } = fake();
    const d = new Demo(host);
    host.t += SESSION + 1;
    d.tick();
    expect(d.regionAllowed("kessar")).toBe(false);
  });

  it("never persists: the demo has no persistence call to make and says so", () => {
    const { host } = fake();
    expect(new Demo(host).persists).toBe(false);
    expect(DEMO.persist).toBe(false);
    // the host surface IS the whole surface: there is nothing named save/store/persist to call
    expect(Object.keys(host).filter((k) => /save|store|persist|resume/i.test(k))).toEqual([]);
    const src = readFileSync(new URL("./Demo.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/persistence|\.save\(|FileStore|Store\b/);
  });

  it("a session override shortens the room; warnings longer than the room are dropped", () => {
    const { host, log } = fake();
    const d = new Demo(host, { sessionSeconds: 20 });
    host.t += 19_000;
    d.tick();
    expect(log.notices).toEqual([]);
    expect(d.remainingS()).toBe(1);
    host.t += 1000;
    d.tick();
    expect(log.closes).toEqual([DEMO.closeCode]);
    // a nonsense override is ignored (the full session)
    for (const bad of [0, -1, NaN, Infinity, 1e12]) expect(new Demo(fake().host, { sessionSeconds: bad }).remainingS()).toBe(DEMO.sessionMinutes * 60);
  });
});

describe("parseDemoEnv", () => {
  it("only an explicit yes switches the demo on; garbage is off", () => {
    for (const on of ["1", "true", "TRUE", " yes ", "on"]) expect(parseDemoEnv({ DEMO_MODE: on }).enabled, on).toBe(true);
    for (const off of [undefined, "", "0", "false", "no", "off", "maybe", "2", "1; rm -rf /", "x".repeat(1000), "null", "\0"]) expect(parseDemoEnv({ DEMO_MODE: off }).enabled, String(off)).toBe(false);
  });
  it("the session-seconds override is honoured only outside production, only in range, and only integers", () => {
    expect(parseDemoEnv({ DEMO_MODE: "1" }).sessionSeconds).toBe(2700);
    expect(parseDemoEnv({ DEMO_MODE: "1", DEMO_SESSION_SECONDS: "20" }).sessionSeconds).toBe(20);
    expect(parseDemoEnv({ DEMO_MODE: "1", NODE_ENV: "test", DEMO_SESSION_SECONDS: "20" }).sessionSeconds).toBe(20);
    expect(parseDemoEnv({ DEMO_MODE: "1", NODE_ENV: "production", DEMO_SESSION_SECONDS: "20" }).sessionSeconds).toBe(2700);
    for (const bad of ["", "0", "4", "-5", "2701", "99999", "1e2", "20.5", "abc", "0x20", " ", "20; 30", "999999"]) expect(parseDemoEnv({ DEMO_MODE: "1", DEMO_SESSION_SECONDS: bad }).sessionSeconds, bad).toBe(2700);
    expect(parseDemoEnv({ DEMO_SESSION_SECONDS: "20" })).toEqual({ enabled: false, sessionSeconds: 2700 });
  });
  it("never throws on a hostile environment", () => {
    expect(() => parseDemoEnv({})).not.toThrow();
    expect(() => parseDemoEnv({ DEMO_MODE: {} as never, DEMO_SESSION_SECONDS: [] as never })).not.toThrow();
  });
});

describe("the demo's close code", () => {
  it("is an application code (4000-4999) that Colyseus does not use: the SDK reconnects on its own 4010, so the wish-list card would never show", () => {
    expect(DEMO.closeCode).toBeGreaterThanOrEqual(4000);
    expect(DEMO.closeCode).toBeLessThanOrEqual(4999);
    expect(Object.values(CloseCode)).not.toContain(DEMO.closeCode);
  });
});
