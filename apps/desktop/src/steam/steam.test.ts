import { ACHIEVEMENTS, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, Rng, presenceText } from "../shared.ts";
import { describe, expect, it, vi } from "vitest";
import { selectPlatform } from "./flags.ts";
import { RING, StubSteam } from "./StubSteam.ts";

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);

describe("StubSteam", () => {
  it("is the stub adapter: available, no network, no key", async () => {
    const s = new StubSteam(() => {});
    expect(s.kind).toBe("steam-stub");
    expect(s.available).toBe(true);
    expect(await s.init()).toBe(true);
    expect(s.running).toBe(true);
    const src = JSON.stringify(Object.keys(s));
    expect(src).not.toMatch(/key|token|secret|ticket|appid/i);
  });

  it("unlock is idempotent and an unknown id is ignored", () => {
    const log = vi.fn();
    const s = new StubSteam(log);
    s.unlock("first_crossing");
    s.unlock("first_crossing");
    s.unlock("first_crossing");
    for (const bad of ["nope", "", "__proto__", 5, null, undefined, {}, "FIRST_CROSSING"]) s.unlock(bad as never);
    expect(s.achievements()).toEqual(["first_crossing"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(s.calls.filter((c) => c.op === "unlock" && c.fresh)).toHaveLength(1);
    for (const id of ACHIEVEMENTS) s.unlock(id);
    expect(s.achievements()).toEqual([...ACHIEVEMENTS]);
  });

  it("presence text is deterministic and is the shared copy; the connect string appears only with a valid join code", () => {
    const a = new StubSteam(() => {});
    const b = new StubSteam(() => {});
    const st = { where: "region", region: "kessar", party: 2, day: 5, joinCode: CODE } as const;
    a.setPresence(st);
    b.setPresence(st);
    expect(a.presenceLine()).toBe(b.presenceLine());
    expect(a.presenceLine()).toBe(presenceText(st));
    expect(a.connectLine()).toBe(`+join ${CODE}`);
    a.setPresence({ ...st, joinCode: "bad" });
    expect(a.connectLine()).toBeUndefined();
    a.setPresence({ where: "menu", party: Number.NaN, day: -4 });
    expect(a.presenceLine()!.length).toBeGreaterThan(5);
  });

  it("an invite reaches onInvite ONLY with a valid join code", () => {
    const s = new StubSteam(() => {});
    const got: string[] = [];
    const off = s.onInvite((r) => got.push(r.joinCode));
    expect(s.simulateInvite(CODE)).toBe(true);
    expect(got).toEqual([CODE]);
    for (const bad of ["", "abc", `${CODE}x`, `+join ${CODE}`, CODE.toLowerCase() === CODE ? `${CODE}\n` : CODE.toLowerCase(), null, undefined, 5, {}, [CODE]]) expect(s.simulateInvite(bad), String(bad)).toBe(false);
    expect(got).toEqual([CODE]);
    off();
    expect(s.simulateInvite(CODE)).toBe(true);
    expect(got).toEqual([CODE]);
  });

  it("2000 hostile invite strings: no throw, and every delivery was a valid code", () => {
    const s = new StubSteam(() => {});
    const got: string[] = [];
    s.onInvite((r) => got.push(r.joinCode));
    const rng = new Rng(404);
    const alphabet = JOIN_CODE_ALPHABET + " +-./\\\0%<>'\"`$(){};\n\t";
    let valid = 0;
    for (let i = 0; i < 2000; i++) {
      const len = rng.int(0, JOIN_CODE_LENGTH + 4);
      let str = "";
      for (let k = 0; k < len; k++) str += alphabet[rng.int(0, alphabet.length - 1)];
      if (i % 50 === 0) str = `${str}${CODE}`;                       // a code with junk around it is not a code
      if (i % 97 === 0) str = CODE;                                  // a real one now and then
      if (s.simulateInvite(str)) valid++;
    }
    expect(got).toHaveLength(valid);
    for (const g of got) expect(g.length).toBe(JOIN_CODE_LENGTH);
    expect([...got.join("")].every((ch) => JOIN_CODE_ALPHABET.includes(ch))).toBe(true);
    expect(valid).toBeGreaterThan(0);
  });

  it("the call ring is bounded, and shutdown clears the listeners", () => {
    const s = new StubSteam(() => {});
    for (let i = 0; i < RING * 3; i++) s.simulateInvite("nope");
    expect(s.calls.length).toBe(RING);
    const got: string[] = [];
    s.onInvite((r) => got.push(r.joinCode));
    s.shutdown();
    s.simulateInvite(CODE);
    expect(got).toEqual([]);
    expect(s.running).toBe(false);
  });
});

describe("selectPlatform (CB_STEAM)", () => {
  it("off by default and for garbage: the no-op", () => {
    for (const env of [{}, { CB_STEAM: "" }, { CB_STEAM: "0" }, { CB_STEAM: "yes" }, { CB_STEAM: "STUBBED" }, { CB_STEAM: "stub; rm" }]) {
      const s = selectPlatform(env, () => {});
      expect(s.mode, JSON.stringify(env)).toBe("off");
      expect(s.adapter.kind).toBe("web");
      expect(s.adapter.available).toBe(false);
    }
  });
  it("stub selects the StubSteam (case and space tolerant)", () => {
    for (const v of ["stub", "STUB", " stub "]) {
      const s = selectPlatform({ CB_STEAM: v }, () => {});
      expect(s.mode).toBe("stub");
      expect(s.adapter).toBeInstanceOf(StubSteam);
    }
  });
  it("real is unimplemented: falls back to the no-op WITH a warning, never silently", () => {
    const log = vi.fn();
    const s = selectPlatform({ CB_STEAM: "real" }, log);
    expect(s.mode).toBe("real");
    expect(s.adapter.available).toBe(false);
    expect(s.adapter.kind).toBe("web");
    expect(s.warning).toMatch(/not implemented/);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
