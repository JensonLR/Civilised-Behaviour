import { describe, expect, it } from "vitest";
import { CAPTIONS, CaptionGate, captionFor } from "./captions.ts";

describe("captions", () => {
  it("name the sound and the direction it came from, in brackets", () => {
    expect(captionFor("musket_shot", { dist: 12, az: -Math.PI / 2 })).toBe("[musket shot, left]");
    expect(captionFor("pistol_shot", { dist: 12, az: Math.PI / 2 })).toBe("[pistol shot, right]");
    expect(captionFor("cannon_shot", { dist: 100, az: 0 })).toBe("[distant cannon fire, ahead]");
    expect(captionFor("explosion", { dist: 30, az: Math.PI })).toBe("[explosion, behind]");
  });

  it("omits the direction for sounds without a place, and for anything right on top of you", () => {
    expect(captionFor("notice", null)).toBe("[telegram bell]");
    expect(captionFor("hurt", { dist: 0.5, az: 1 })).toBe("[a cry of pain]");
    expect(captionFor("musket_shot", null)).toBe("[musket shot]");
  });

  it("drops sounds out of their range and sounds that have no caption at all", () => {
    expect(captionFor("hurt", { dist: 80, az: 0 })).toBeNull();
    expect(captionFor("footstep_grass", { dist: 3, az: 0 })).toBeNull();
    expect(captionFor("ui_click", null)).toBeNull();
    expect(captionFor("no_such_sound", null)).toBeNull();
  });

  it("only the sounds that matter are captioned (no footsteps, UI ticks, ambience)", () => {
    for (const quiet of ["footstep_grass", "footstep_dirt", "ui_click", "ui_hover", "jump", "land", "reload_click", "bird", "fire_pop"]) expect(CAPTIONS[quiet], quiet).toBeUndefined();
    for (const loud of ["musket_shot", "pistol_shot", "blunderbuss_shot", "cannon_shot", "explosion", "limb_sever", "notice", "revive_done"]) expect(CAPTIONS[loud], loud).toBeDefined();
  });

  it("a volley is a few lines, not fifty: repeats of one sound wait out their gap", () => {
    const gate = new CaptionGate();
    expect(gate.accept("musket_shot", 0)).toBe(true);
    expect(gate.accept("musket_shot", 0.2)).toBe(false);
    expect(gate.accept("pistol_shot", 0.2)).toBe(true); // a different sound is independent
    expect(gate.accept("musket_shot", 0.7)).toBe(true);
    expect(gate.accept("ui_click", 1)).toBe(false); // no caption, never accepted
    gate.reset();
    expect(gate.accept("musket_shot", 0.71)).toBe(true);
  });
});
