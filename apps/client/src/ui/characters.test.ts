// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import {
  CHARACTERS_KEY, MAX_CHARACTERS, addCharacter, currentCharacter, freshCharacter, isLook, loadRoster, mergeCharacters, parseCharacters, parseRoster, removeCharacter, saveRoster,
  selectCharacter, serializeRoster, updateCharacter, type Roster,
} from "./characters.ts";

const look = (seed: number): string => encodeSpec(generateCharacter(seed));
let n = 0;
const rand = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);

beforeEach(() => {
  localStorage.clear();
  n = 7;
});

describe("D-102: the characters a device keeps", () => {
  it("a first visit makes one character from the old single name and look (nothing is lost on upgrading)", () => {
    localStorage.setItem("cb.name", "Ada");
    localStorage.setItem("cb.look", look(5));
    const r = loadRoster(rand);
    expect(r.list).toHaveLength(1);
    expect(currentCharacter(r)).toMatchObject({ name: "Ada", look: look(5) });
    expect(parseRoster(localStorage.getItem(CHARACTERS_KEY))).toEqual(r);
  });

  it("a brand-new device gets one character with a random look that decodes", () => {
    const r = loadRoster(rand);
    expect(r.list).toHaveLength(1);
    expect(isLook(currentCharacter(r).look)).toBe(true);
  });

  it("add, choose, rename, re-dress and remove; the last one stays; the old keys follow the chosen one", () => {
    let r: Roster = loadRoster(rand);
    const first = r.current;
    r = addCharacter(r, { ...freshCharacter("Bram", rand) });
    expect(r.list).toHaveLength(2);
    expect(currentCharacter(r).name).toBe("Bram");
    r = updateCharacter(r, r.current, { name: "  Bram the Bold  ", look: look(9) });
    expect(currentCharacter(r)).toMatchObject({ name: "Bram the Bold", look: look(9) });
    r = updateCharacter(r, r.current, { look: "not a look" }); // (ignored: a look the game cannot draw is never kept)
    expect(currentCharacter(r).look).toBe(look(9));
    saveRoster(r);
    expect(localStorage.getItem("cb.name")).toBe("Bram the Bold");
    expect(localStorage.getItem("cb.look")).toBe(look(9));
    r = selectCharacter(r, first);
    expect(r.current).toBe(first);
    r = selectCharacter(r, "nobody00");
    expect(r.current).toBe(first);
    const bram = r.list[1]!.id;
    r = removeCharacter(r, first);
    expect(r.list.map((c) => c.id)).toEqual([bram]);
    expect(r.current).toBe(bram);
    expect(removeCharacter(r, bram)).toBe(r); // (there is always somebody to play)
  });

  it("is capped, and storage is read defensively: hostile or foreign values are dropped entry by entry", () => {
    let r: Roster = loadRoster(rand);
    for (let i = 0; i < MAX_CHARACTERS + 3; i++) r = addCharacter(r, freshCharacter(`C${i}`, rand));
    expect(r.list).toHaveLength(MAX_CHARACTERS);
    expect(parseRoster("{")).toBeUndefined();
    expect(parseRoster(JSON.stringify({ v: 2, current: "x", list: [] }))).toBeUndefined();
    const raw = JSON.stringify({ v: 1, current: "zzzzzzzz", list: [{ id: "abc12345", name: "<i>Ada</i>", look: look(3) }, { id: "../etc", name: "x", look: look(3) }, { id: "def67890", name: "B", look: "junk" }, "nope"] });
    const parsed = parseRoster(raw)!;
    expect(parsed.list).toEqual([{ id: "abc12345", name: "iAda/i", look: look(3) }]);
    expect(parsed.current).toBe("abc12345"); // (an unknown choice falls back to the first)
    expect(parseCharacters("x")).toEqual([]);
    expect(serializeRoster(parsed)).not.toMatch(/etc|junk/);
  });

  it("merging from elsewhere (a profile code) adds characters, keeps ours on a clash, keeps our choice", () => {
    const r: Roster = { current: "aaaaaaaa", list: [{ id: "aaaaaaaa", name: "Ada", look: look(1) }] };
    const merged = mergeCharacters(r, [{ id: "aaaaaaaa", name: "Other Ada", look: look(2) }, { id: "bbbbbbbb", name: "Bram", look: look(3) }]);
    expect(merged.list.map((c) => c.name)).toEqual(["Ada", "Bram"]);
    expect(merged.current).toBe("aaaaaaaa");
  });
});
