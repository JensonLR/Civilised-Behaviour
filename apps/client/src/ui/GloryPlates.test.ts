// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { GloryPlates, MAX_ALBUM, PLATE_GAP_S } from "./GloryPlates.ts";

/** D-085: the Illustrated Imperial News: the game photographs its own best moments, prints them as plates, keeps them to save. */
const canvas = document.createElement("canvas");
let n = 0;
const fakeShot = (): string => `data:image/jpeg;base64,shot${++n}`;

describe("the Illustrated Imperial News", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a blast in view is photographed a moment later, and the column's line about it makes the plate, captioned", () => {
    const p = new GloryPlates(document.body, fakeShot);
    p.armCapture(1000);
    p.frame(canvas, 1100); // (not yet: the fireball is still coming up)
    expect(p.album.length).toBe(0);
    p.frame(canvas, 1310);
    p.onGazette("Five kegs in succession. The road has been rearranged.", "chain", 1500);
    expect(p.album.length).toBe(1);
    expect(p.album[0]!.caption).toMatch(/Five kegs/);
    expect(p.showing).toBe(true);
    expect(document.querySelector(".plate figcaption")?.textContent).toMatch(/Five kegs/);
    expect(document.querySelector(".plate img")?.getAttribute("src")).toBe(p.album[0]!.url);
  });

  it("a moment with no blast (a sabre, a commission) is photographed on the next frame; dull lines and stale pictures make no plate", () => {
    const p = new GloryPlates(document.body, fakeShot);
    p.onGazette("A bystander is entered in the ledger.", "civilian", 0);
    p.onGazette("A headshot.", "headshot", 0);
    p.frame(canvas, 10);
    expect(p.album.length).toBe(0);
    p.armCapture(0);
    p.frame(canvas, 400);
    p.onGazette("Ada takes a limb for the Empire.", "sever", 9000); // (that picture is nine seconds old: not this moment)
    expect(p.album.length).toBe(0);
    p.frame(canvas, 9020);
    expect(p.album.length).toBe(1);
    expect(p.album[0]!.caption).toMatch(/limb/);
  });

  it("a plate is an event, not a stream: one per gap; the album keeps the last twelve; markup in a line is text", () => {
    const p = new GloryPlates(document.body, fakeShot);
    let t = 0;
    for (let i = 0; i < 3; i++) {
      p.onGazette(`<b>moment ${i}</b>`, "chain", t);
      p.frame(canvas, t + 20);
      t += 1000;
    }
    expect(p.album.length).toBe(1);
    expect(document.querySelector(".plate b")).toBeNull();
    for (let i = 0; i < 20; i++) {
      t += PLATE_GAP_S * 1000 + 100; // (the gap runs from when the plate appeared: its picture's frame, 20 ms after the line)
      p.onGazette(`moment ${i}`, "fling", t);
      p.frame(canvas, t + 20);
    }
    expect(p.album.length).toBe(MAX_ALBUM);
    expect(p.album[MAX_ALBUM - 1]!.caption).toBe("moment 19");
  });

  it("an unreadable canvas makes no plate rather than a broken one", () => {
    const p = new GloryPlates(document.body, () => undefined);
    p.onGazette("Five kegs.", "chain", 0);
    p.frame(canvas, 10);
    expect(p.album.length).toBe(0);
    expect(p.showing).toBe(false);
  });
});
