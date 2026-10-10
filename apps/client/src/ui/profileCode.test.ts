// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import { CHARACTERS_KEY, loadRoster, parseRoster, type Character, type Roster } from "./characters.ts";
import { EXPEDITIONS_KEY, listExpeditions, noteExpedition, upsertExpedition, type Expedition } from "./expeditions.ts";
import { PROFILE_PREFIX, decodeProfile, encodeProfile, myProfileCode, planRestore, restoreProfileCode, type Profile } from "./profileCode.ts";

/** D-102: the profile code carries a device's identity, characters and expeditions to keep or to move; restoring checks everything and never loses a device's own saves silently. */

const look = (seed: number): string => encodeSpec(generateCharacter(seed));
const A = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const B = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const NOW = 1_800_000_000_000;
const ch = (id: string, name: string, seed: number): Character => ({ id, name, look: look(seed) });
const exps = (...codes: string[]): Expedition[] => codes.reduce<Expedition[]>((l, c, i) => upsertExpedition(l, c, { name: "Ada", region: "kessar", day: i + 1, party: ["Bram"] }, NOW - i * 1000), []);
const roster = (...list: Character[]): Roster => ({ current: list[0]!.id, list });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("D-102: the profile code", () => {
  it("round-trips the identity, the characters and the expeditions (names in any script survive)", () => {
    const p: Profile = { identity: A, characters: [ch("abc123de", "Ada", 1), ch("zz9yy8xx", "Zoë Þórsdóttir", 2)], expeditions: exps("K7M2Q", "W4X7Z") };
    const code = encodeProfile(p);
    expect(code.startsWith(PROFILE_PREFIX)).toBe(true);
    expect(code).toMatch(/^CB1-[A-Za-z0-9_-]+$/);
    expect(decodeProfile(code, NOW)).toEqual(p);
  });

  it("a code pasted from a notes app with spaces and line breaks still reads", () => {
    const code = encodeProfile({ identity: A, characters: [ch("abc123de", "Ada", 1)], expeditions: [] });
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} \r\n${code.slice(50)}  `;
    expect(decodeProfile(wrapped, NOW)?.identity).toBe(A);
  });

  it("anything else is refused, and a bad field inside a good code is dropped alone", () => {
    const enc = (o: unknown): string => PROFILE_PREFIX + btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    for (const bad of [undefined, 42, "", "hello", "CB1-", "CB1-!!!", "CB2-abc", enc({ v: 2, i: A, c: [], e: [] }), enc([1, 2]), enc({ v: 1, i: "not-a-uuid", c: [] }), PROFILE_PREFIX + "A".repeat(70_000)]) {
      expect(decodeProfile(bad, NOW)).toBeUndefined();
    }
    const p = decodeProfile(enc({ v: 1, i: A, c: [{ id: "abc123de", name: "<b>Ada</b>", look: look(1) }, { id: "BAD", name: "x", look: look(2) }, { id: "zz9yy8xx", name: "Eve", look: "garbage" }], e: [{ code: "nope" }, ...exps("K7M2Q")] }), NOW);
    expect(p?.characters.map((c) => c.name)).toEqual(["bAda/b"]);
    expect(p?.expeditions.map((e) => e.code)).toEqual(["K7M2Q"]);
  });

  it("same papers: everything is added and ours wins on a clash; nothing of ours goes", () => {
    const here = { identity: A, roster: roster(ch("abc123de", "Ada", 1)), list: exps("K7M2Q") };
    const plan = planRestore(here, { identity: A, characters: [ch("abc123de", "Imposter", 9), ch("zz9yy8xx", "Bram", 2)], expeditions: exps("W4X7Z", "K7M2Q") }, false);
    expect(plan.kind).toBe("restore");
    if (plan.kind !== "restore") return;
    expect(plan.identity).toBe(A);
    expect(plan.roster.list.map((c) => c.name)).toEqual(["Ada", "Bram"]);
    expect(plan.roster.current).toBe("abc123de");
    expect(plan.list.map((e) => e.code).sort()).toEqual(["K7M2Q", "W4X7Z"]);
    expect(plan).toMatchObject({ characters: 1, expeditions: 1 });
  });

  it("a device that never played takes the code's papers, and its unnamed random character gives way to the code's", () => {
    const here = { identity: B, roster: roster(ch("blank0000", "", 4)), list: [] };
    const plan = planRestore(here, { identity: A, characters: [ch("abc123de", "Ada", 1), ch("zz9yy8xx", "Bram", 2)], expeditions: exps("K7M2Q") }, false);
    expect(plan).toMatchObject({ kind: "restore", identity: A, characters: 2, expeditions: 1 });
    if (plan.kind === "restore") expect(plan.roster).toEqual(roster(ch("abc123de", "Ada", 1), ch("zz9yy8xx", "Bram", 2)));
  });

  it("other papers over a device with its own expeditions: refused until pressed again, then the code's papers and list take over (characters kept)", () => {
    const here = { identity: B, roster: roster(ch("mine0000", "Cecily", 3)), list: exps("W4X7Z", "K7M2Q") };
    const code = { identity: A, characters: [ch("abc123de", "Ada", 1)], expeditions: exps("HQ3RT") };
    expect(planRestore(here, code, false)).toEqual({ kind: "papers", own: 2 });
    const plan = planRestore(here, code, true);
    expect(plan).toMatchObject({ kind: "restore", identity: A, characters: 1, expeditions: 1 });
    if (plan.kind === "restore") {
      expect(plan.list.map((e) => e.code)).toEqual(["HQ3RT"]);
      expect(plan.roster.list.map((c) => c.name)).toEqual(["Cecily", "Ada"]);
    }
  });

  it("from one device to another through storage: copy, clear, restore, and the door has it all back", () => {
    localStorage.setItem("cb.identity", A);
    localStorage.setItem("cb.name", "Ada");
    localStorage.setItem("cb.look", look(5));
    const before = loadRoster();
    noteExpedition("K7M2Q", { name: "Ada", region: "kessar", day: 4, who: before.current, party: ["Bram", "Cecily"] });
    const code = myProfileCode();
    localStorage.clear();
    loadRoster(); // (the new device's door has already made its unnamed character)
    expect(restoreProfileCode("CB1-garbage", false)).toEqual({ kind: "bad" });
    const r = restoreProfileCode(code, false);
    expect(r).toMatchObject({ kind: "restore", characters: 1, expeditions: 1 });
    expect(localStorage.getItem("cb.identity")).toBe(A);
    expect(parseRoster(localStorage.getItem(CHARACTERS_KEY))).toEqual(before);
    expect(localStorage.getItem("cb.name")).toBe("Ada");
    const [e] = listExpeditions();
    expect(e).toMatchObject({ code: "K7M2Q", who: before.current, party: ["Bram", "Cecily"], day: 4 });
    expect(localStorage.getItem(EXPEDITIONS_KEY)).not.toBeNull();
  });
});
