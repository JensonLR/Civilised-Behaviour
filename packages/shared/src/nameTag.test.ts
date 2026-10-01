import { describe, expect, it } from "vitest";
import { NPC } from "./campaignTypes.ts";
import { COMPASS_BAND_PX, TAG_FRAME, TAG_RANGE, tagRange, tagState } from "./nameTag.ts";

const show = (dist: number, role: number, o: { x?: number; y?: number; z?: number; down?: boolean; top?: number; sight?: boolean } = {}): boolean =>
  tagState(dist, o.x ?? 0, o.y ?? 0, o.z ?? 0.5, role, o.down ?? false, o.top ?? 300, o.sight ?? false).show;

describe("tagState: where a plate may sit", () => {
  it("shows in front of the camera, inside the frame, below the compass band, in range", () => {
    expect(show(10, NPC.NONE)).toBe(true);
    expect(tagState(10, 0, 0, 0.5, NPC.NONE, false, 300)).toEqual({ show: true, alpha: 1 });
  });

  it("is culled behind the camera (ndc z >= 1) and past the far plane", () => {
    expect(show(5, NPC.NONE, { z: 1 })).toBe(false);
    expect(show(5, NPC.NONE, { z: 1.4 })).toBe(false);
    expect(show(5, NPC.NONE, { z: -1.2 })).toBe(false);
    expect(show(5, NPC.NONE, { z: 0.999 })).toBe(true);
  });

  it("is culled, not clamped, at the frame edge: |ndc| <= 0.96 shows, anything beyond hides", () => {
    expect(show(5, NPC.NONE, { x: TAG_FRAME })).toBe(true);
    expect(show(5, NPC.NONE, { x: -TAG_FRAME })).toBe(true);
    expect(show(5, NPC.NONE, { x: TAG_FRAME + 0.01 })).toBe(false);
    expect(show(5, NPC.NONE, { x: -1.3 })).toBe(false);
    expect(show(5, NPC.NONE, { y: TAG_FRAME + 0.01 })).toBe(false);
    expect(show(5, NPC.NONE, { y: -TAG_FRAME - 0.01 })).toBe(false);
    expect(show(5, NPC.NONE, { y: TAG_FRAME })).toBe(true);
  });

  it("is culled in the compass band: screen y under 72 px", () => {
    expect(show(5, NPC.NONE, { top: COMPASS_BAND_PX - 0.5 })).toBe(false);
    expect(show(5, NPC.NONE, { top: 0 })).toBe(false);
    expect(show(5, NPC.NONE, { top: COMPASS_BAND_PX })).toBe(true);
    expect(show(5, NPC.NONE, { top: -40 })).toBe(false);
  });

  it("range tiers: party and hired hands 40 m, the Warden / hostage / driver 30 m, soldiers and enemies 12 m (26 m in sight)", () => {
    for (const r of [NPC.NONE, NPC.PORTER, NPC.HIRED_RIFLE, NPC.SURGEON]) {
      expect(show(TAG_RANGE.party - 0.5, r), `role ${r}`).toBe(true);
      expect(show(TAG_RANGE.party + 0.5, r), `role ${r}`).toBe(false);
    }
    for (const r of [NPC.WARDEN, NPC.HOSTAGE, NPC.DRIVER]) {
      expect(show(29.5, r), `role ${r}`).toBe(true);
      expect(show(30.5, r), `role ${r}`).toBe(false);
    }
    for (const r of [NPC.SENTRY, NPC.RIVAL_GUARD, NPC.RIVAL_SURVEYOR, NPC.DESERTER]) {
      expect(show(11.5, r), `role ${r}`).toBe(true);
      expect(show(13, r), `role ${r}`).toBe(false);
      expect(show(13, r, { sight: true }), `role ${r}`).toBe(true);
      expect(show(25.5, r, { sight: true }), `role ${r}`).toBe(true);
      expect(show(27, r, { sight: true }), `role ${r}`).toBe(false);
    }
    expect(tagRange(NPC.SENTRY, false)).toBe(12);
    expect(tagRange(999, true)).toBe(26); // an unknown role is treated as a soldier: the strictest plate
  });

  it("alpha is 1 for the first 75% of the range and fades to 0 over the last quarter", () => {
    const a = (d: number) => tagState(d, 0, 0, 0.5, NPC.NONE, false, 300).alpha;
    expect(a(0)).toBe(1);
    expect(a(30)).toBe(1);
    expect(a(35)).toBeCloseTo(0.5, 5);
    expect(a(39)).toBeCloseTo(0.1, 5);
    expect(a(40.5)).toBe(0);
    let last = 1;
    for (let d = 30; d <= 40; d += 0.5) {
      const v = a(d);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
  });

  it("downed: the party and the people you are meant to save keep their plates; soldiers lying about do not", () => {
    expect(show(5, NPC.NONE, { down: true })).toBe(true);
    expect(show(5, NPC.SURGEON, { down: true })).toBe(true);
    expect(show(5, NPC.HOSTAGE, { down: true })).toBe(true);
    expect(show(5, NPC.SENTRY, { down: true })).toBe(false);
    expect(show(5, NPC.DESERTER, { down: true })).toBe(false);
  });

  it("hostile numbers never throw and never show", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(show(bad, NPC.NONE)).toBe(false);
      expect(show(5, NPC.NONE, { x: bad })).toBe(false);
      expect(show(5, NPC.NONE, { y: bad })).toBe(false);
      expect(show(5, NPC.NONE, { z: bad })).toBe(false);
      expect(show(5, NPC.NONE, { top: bad })).toBe(false);
    }
    expect(show(-1, NPC.NONE)).toBe(false);
  });

  it("reuses the output object when given one", () => {
    const o = { show: true, alpha: 0.3 };
    const r = tagState(5, 0, 0, 0.5, NPC.NONE, false, 300, false, o);
    expect(r).toBe(o);
    tagState(5, 0, 0, 2, NPC.NONE, false, 300, false, o);
    expect(o).toEqual({ show: false, alpha: 0 });
  });

  it("twelve soldiers in a row: none on the compass band or off screen, whatever the camera does", () => {
    // a ring of 12 around a camera, projected the way a perspective camera would: only those in front, inside the frame and below 72 px show
    const H = 720, W = 1280;
    const shown: number[] = [];
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const dist = 6 + (i % 4) * 3;
      const ndcX = Math.tan(ang) * 0.6, ndcY = 0.9 - (i % 5) * 0.4, ndcZ = Math.cos(ang) > 0 ? 0.9 : 1.2;
      const topPx = ((1 - ndcY) / 2) * H;
      const s = tagState(dist, ndcX, ndcY, ndcZ, NPC.SENTRY, false, topPx, true);
      if (s.show) {
        shown.push(i);
        expect(topPx).toBeGreaterThanOrEqual(COMPASS_BAND_PX);
        expect(Math.abs(ndcX)).toBeLessThanOrEqual(TAG_FRAME);
        expect(((ndcX + 1) / 2) * W).toBeGreaterThan(0);
        expect(ndcZ).toBeLessThan(1);
      }
    }
    expect(shown.length).toBeLessThan(12);
  });
});
