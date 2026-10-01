import { Rng } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { layerEnd, layersEnd, type Layer } from "./dsp.ts";
import { REQUIRED_SOUNDS, SOUNDS, SOUND_NAMES, type SoundDef } from "./sounds.ts";
import { variantSeed } from "./bake.ts";
import { GRIT_SOUND_NAMES } from "./soundsGrit.ts";

const build = (name: string, def: SoundDef, key: string, variant: number): Layer[] => def.layers({ pitch: 1, rng: new Rng(variantSeed(name, key, variant)), key, variant });

describe("sound registry", () => {
  it("has every name the combat code was promised, and more", () => {
    for (const n of REQUIRED_SOUNDS) expect(SOUNDS[n], n).toBeDefined();
    for (const n of ["musket_shot", "pistol_shot", "blunderbuss_shot", "cannon_shot", "sabre_swing", "sabre_hit", "reload_click", "impact_flesh", "impact_wood", "impact_earth", "impact_iron", "explosion"]) expect(SOUND_NAMES).toContain(n);
    for (const n of ["footstep_grass", "footstep_dirt", "footstep_stone", "footstep_wood"]) expect(SOUND_NAMES).toContain(n);
  });

  it("the grit pass's names are all registered (gore, impacts, foley, boots, tails, the regions' voices): gritSounds.test.ts measures each", () => {
    for (const n of GRIT_SOUND_NAMES) expect(SOUND_NAMES, n).toContain(n);
    for (const n of ["gore_flesh_heavy", "gore_flesh_light", "gore_bone", "gore_sever_wet", "gore_blood_ground", "gore_body_fall", "gore_bad_breath", "impact_splinter", "impact_chip", "impact_ring", "impact_splash", "foley_cloth", "foley_gear", "foley_holster", "foley_draw", "foley_ramrod", "foley_powder", "foley_cock", "foley_shell", "footstep_mud", "footstep_sand", "footstep_plank", "explosion_tail"]) expect(SOUND_NAMES).toContain(n);
  });

  it("every definition is sane: priorities, caps, distances and levels", () => {
    for (const [name, d] of Object.entries(SOUNDS)) {
      expect(d.peakDb, `${name} peak`).toBeLessThanOrEqual(0);
      expect(d.peakDb, `${name} peak`).toBeGreaterThan(-40);
      expect(d.cap, name).toBeGreaterThanOrEqual(1);
      expect(d.prio, name).toBeGreaterThanOrEqual(0);
      expect(d.max, name).toBeGreaterThan(d.ref);
      expect(d.variants, name).toBeGreaterThanOrEqual(1);
      expect(d.keys.length, name).toBeGreaterThanOrEqual(1);
      expect(d.reverb, name).toBeGreaterThanOrEqual(0);
      expect(d.reverb, name).toBeLessThanOrEqual(1);
      expect(d.duck, name).toBeLessThanOrEqual(1);
    }
  });

  it("the mix is ordered the way it should sound: artillery over small arms over everything else, and UI far below the world", () => {
    const db = (n: string): number => SOUNDS[n]!.peakDb;
    expect(db("cannon_shot")).toBeGreaterThanOrEqual(db("blunderbuss_shot"));
    expect(db("blunderbuss_shot")).toBeGreaterThanOrEqual(db("musket_shot"));
    expect(db("musket_shot")).toBeGreaterThan(db("pistol_shot") - 0.001);
    for (const foot of ["footstep_grass", "footstep_dirt", "footstep_stone", "footstep_wood"]) expect(db(foot)).toBeLessThan(db("pistol_shot") - 8);
    expect(db("ui_hover")).toBeLessThan(db("ui_click"));
    expect(SOUNDS.cannon_shot!.ref).toBeGreaterThan(SOUNDS.musket_shot!.ref);
    expect(SOUNDS.cannon_shot!.duck).toBeGreaterThan(SOUNDS.musket_shot!.duck);
    expect(SOUNDS.explosion!.max).toBeGreaterThan(SOUNDS.pistol_shot!.max);
  });

  it("guns and blasts outrank footsteps when voices are short", () => {
    for (const loud of ["cannon_shot", "explosion", "musket_shot", "hurt", "limb_sever"]) expect(SOUNDS[loud]!.prio, loud).toBeGreaterThan(SOUNDS.footstep_grass!.prio);
  });

  it("each recipe builds finite layers within a sane length, for every key and variant", () => {
    const seen = new Set<SoundDef>();
    for (const [name, d] of Object.entries(SOUNDS)) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const key of d.keys) {
        for (let v = 0; v < d.variants; v++) {
          const layers = build(name, d, key, v);
          expect(layers.length, `${name}/${key}/${v}`).toBeGreaterThan(0);
          for (const l of layers) {
            const end = layerEnd(l);
            expect(Number.isFinite(end) && end > 0, `${name} layer end`).toBe(true);
            if ("peak" in l) expect(l.peak).toBeGreaterThan(0);
          }
          expect(layersEnd(layers), `${name}/${key}/${v} length`).toBeLessThan(8);
          if (d.loop > 0) expect(layersEnd(layers), `${name} loop fits its period`).toBeLessThanOrEqual(d.loop + 0.5);
        }
      }
    }
  });

  it("recipes are deterministic (same seed, same layers) and variants differ", () => {
    const d = SOUNDS.impact_earth!;
    expect(build("impact_earth", d, "", 0)).toEqual(build("impact_earth", d, "", 0));
    expect(JSON.stringify(build("impact_earth", d, "", 0))).not.toBe(JSON.stringify(build("impact_earth", d, "", 1)));
  });

  it("gore Off sounds different from Full (a plink, not a wet snap) and reduced is quieter than full", () => {
    const d = SOUNDS.limb_sever!;
    expect(d.keys).toEqual(["full", "reduced", "off"]);
    const kinds = (key: string): string => build("limb_sever", d, key, 0).map((l) => l.k).join("");
    expect(kinds("off")).not.toBe(kinds("full"));
    const noiseLoud = (key: string): number => build("limb_sever", d, key, 0).filter((l) => l.k === "n").reduce((a, l) => a + ("peak" in l ? l.peak : 0), 0);
    expect(noiseLoud("reduced")).toBeLessThan(noiseLoud("full"));
    expect(noiseLoud("off")).toBe(0); // nothing wet at all
  });

  it("hurt has twelve distinct voices", () => {
    const d = SOUNDS.hurt!;
    expect(d.variants).toBe(12);
    const pitches = new Set<number>();
    for (let v = 0; v < 12; v++) {
      const voice = build("hurt", d, "", v).find((l) => l.k === "v");
      expect(voice).toBeDefined();
      if (voice?.k === "v") pitches.add(Math.round(voice.hz));
    }
    expect(pitches.size).toBeGreaterThanOrEqual(8);
  });

  it("the revive loop is periodic and its layers end inside the period", () => {
    const d = SOUNDS.revive_hold!;
    expect(d.loop).toBeGreaterThan(0);
    expect(layersEnd(build("revive_hold", d, "", 0))).toBeLessThan(d.loop);
  });
});
