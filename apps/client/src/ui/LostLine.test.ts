// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LostLine, lostLineFor } from "./LostLine.ts";

describe("the line has gone dead (a room left for good)", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("is news for a shutdown, an error, a reconnection given up or an abnormal close; not for a leave we chose, the page going away, or the demo's own close", () => {
    for (const code of [4001, 4002, 4003, 1006, 4010]) expect(lostLineFor(code, 4420), String(code)).toBe(true);
    for (const code of [4000, 1000, 1001, 4420]) expect(lostLineFor(code, 4420), String(code)).toBe(false);
  });

  it("shows once, says what was kept, and its one button goes back to the door", () => {
    const back = vi.fn();
    const l = new LostLine();
    l.show(back);
    l.show(back);
    expect(document.querySelectorAll(".lostline").length).toBe(1);
    expect(document.querySelector(".lostline")!.textContent).toMatch(/progress is saved/);
    document.querySelector<HTMLButtonElement>(".lostline .back")!.click();
    expect(back).toHaveBeenCalledTimes(1);
    l.dispose();
    expect(document.querySelector(".lostline")).toBeNull();
  });
});
