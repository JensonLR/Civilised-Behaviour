import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { crosshairVisible } from "./Hud.ts";

describe("first-person crosshair", () => {
  it("shows only in first person", () => {
    expect(crosshairVisible(true, FLAG.GROUNDED)).toBe(true);
    expect(crosshairVisible(false, FLAG.GROUNDED)).toBe(false);
    expect(crosshairVisible(undefined, FLAG.GROUNDED)).toBe(false);
  });

  it("stays while carrying, crouching or kneeling (the prompt and the aim still matter)", () => {
    expect(crosshairVisible(true, FLAG.CARRYING | FLAG.GROUNDED)).toBe(true);
    expect(crosshairVisible(true, FLAG.CROUCHING)).toBe(true);
    expect(crosshairVisible(true, FLAG.REVIVING)).toBe(true);
  });

  it("hides for a downed player, who sees the sky and the mourning card instead", () => {
    expect(crosshairVisible(true, FLAG.DOWNED)).toBe(false);
    expect(crosshairVisible(true, FLAG.DOWNED | FLAG.DRAGGED)).toBe(false);
  });
});
