import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FIELDS, decodeSpec, encodeSpec, generateCharacter, HISTORY_KEYS } from "../spec.ts";
import { orient, scarPaths } from "./headExtras.ts";

describe("fine cosmetics", () => {
  it("orient turns +Y to the requested direction", () => {
    for (const n of [[1, 0, 0], [0, 0, -1], [0.3, 0.8, -0.5], [-0.7, -0.2, 0.4]] as const) {
      const [x, y, z] = orient([n[0], n[1], n[2]]);
      const v = new Vector3(0, 1, 0).applyEuler(new Euler(x, y, z, "XYZ"));
      const want = new Vector3(n[0], n[1], n[2]).normalize();
      expect(v.distanceTo(want)).toBeLessThan(1e-6);
    }
  });

  it("scar styles: straight keeps the path, jagged zig-zags from the same ends, stitched adds stitches across, forked adds a branch off the middle", () => {
    const path = [[0.5, -0.05], [0.58, -0.2], [0.6, -0.36]] as const;
    const straight = scarPaths(0, path);
    expect(straight.welts).toEqual([path]);
    expect(straight.stitches).toHaveLength(0);
    const jag = scarPaths(1, path);
    expect(jag.welts).toHaveLength(1);
    expect(jag.welts[0]!.length).toBeGreaterThan(path.length);
    expect(jag.welts[0]![0]).toEqual(path[0]);
    expect(jag.welts[0]!.at(-1)![1]).toBeCloseTo(path[2][1], 9);
    const stitched = scarPaths(2, path);
    expect(stitched.stitches.length).toBeGreaterThanOrEqual(4);
    for (const s of stitched.stitches) expect(Number.isFinite(s.angle)).toBe(true);
    const forked = scarPaths(3, path);
    expect(forked.welts).toHaveLength(2);
    // the branch starts on the main line
    const m = forked.welts[1]![0]!;
    const onLine = path.some((p, i) => i < 2 && Math.abs((m[0] - p[0]) * (path[i + 1]![1] - p[1]) - (m[1] - p[1]) * (path[i + 1]![0] - p[0])) < 0.02);
    expect(onLine).toBe(true);
    expect(scarPaths(1, path)).toEqual(jag); // deterministic
  });

  it("the batch-3 fields are append-only: an older look code (without them) decodes with all of them at 'None', and they survive a round trip", () => {
    const names = ["medalStyle", "buckle", "cuffDetail", "laces", "pocket", "hairAcc", "patchStyle", "scarStyle"];
    expect(FIELDS.slice(-names.length).map((f) => f.key)).toEqual(names);
    const spec = { ...generateCharacter(12), medalStyle: 2, buckle: 4, cuffDetail: 3, laces: 2, pocket: 4, hairAcc: 5, patchStyle: 3, scarStyle: 3 };
    const back = decodeSpec(encodeSpec(spec))!;
    for (const k of names) expect(back[k as keyof typeof back], k).toBe(spec[k as keyof typeof spec]);
    // an older client's code: cut the bytes for the new fields off the end
    const bytes = Buffer.from(encodeSpec(spec).replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const old = Buffer.from(bytes.subarray(0, bytes.length - names.length)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const older = decodeSpec(old)!;
    for (const k of names) expect(older[k as keyof typeof older], k).toBe(0);
    expect(older.hat).toBe(spec.hat);
  });

  it("the style of a campaign injury belongs to the campaign, and generated recruits never carry one", () => {
    expect(HISTORY_KEYS).toContain("patchStyle");
    expect(HISTORY_KEYS).toContain("scarStyle");
    for (let seed = 0; seed < 200; seed++) {
      const s = generateCharacter(seed);
      expect(s.patchStyle + s.scarStyle).toBe(0);
    }
  });
});
