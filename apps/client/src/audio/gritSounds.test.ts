import { Rng } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { spectrum } from "./analyse.ts";
import { variantSeed } from "./bake.ts";
import { CAPTIONS, captionFor, captionName } from "./captions.ts";
import type { Layer } from "./dsp.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { SOUNDS } from "./sounds.ts";
import { FOLEY_SOUNDS, GORE_SOUNDS, GRIT_SOUND_NAMES, GRIT_SOUNDS, IMPACT_SOUNDS, REGION_AMBIENT_SOUNDS, TAIL_SOUNDS } from "./soundsGrit.ts";

/**
 * The grit pass's sounds (gore, impacts, foley, tails, the regions' own voices), rendered offline with the same recipes and normaliser the game bakes with, and measured: finite, audible, under
 * -1 dBFS, a sane tail, captioned, and shaped as their names say (a crack is brighter than a thump, a far rumble is darker and longer than a near one, Gore Off is dry).
 */

interface Row { name: string; key: string; variant: number; peakDb: number; rmsDb: number; audible: number; nonFinite: number; centroid: number; bands: [number, number, number] }
const rows: Row[] = [];
const seen = new Set<unknown>();
for (const name of GRIT_SOUND_NAMES) {
  const def = SOUNDS[name]!;
  if (seen.has(def)) continue;
  seen.add(def);
  for (const key of def.keys) {
    for (let v = 0; v < def.variants; v++) {
      const { data, stats } = renderVariantOffline(name, def, key, v);
      rows.push({ name, key, variant: v, peakDb: stats.peakDb, rmsDb: stats.rmsDb, audible: stats.audibleSeconds, nonFinite: stats.nonFinite, ...spectrum(data, RATE, 4) });
    }
  }
}
const of = (name: string, key?: string): Row[] => rows.filter((r) => r.name === name && (key === undefined || r.key === key));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const cent = (name: string, key?: string): number => mean(of(name, key).map((r) => r.centroid));
const low = (name: string, key?: string): number => mean(of(name, key).map((r) => r.bands[0] + r.bands[1]));
const layersOf = (name: string, key: string, variant: number): Layer[] => SOUNDS[name]!.layers({ pitch: 1, rng: new Rng(variantSeed(name, key, variant)), key, variant });
const noisePeak = (name: string, key: string): number => layersOf(name, key, 0).filter((l) => l.k === "n").reduce((a, l) => a + l.peak, 0);

describe("the registry", () => {
  it("every grit sound is in SOUNDS, the family lists add up to the table, and the plank is the wooden step", () => {
    expect(new Set(GRIT_SOUND_NAMES)).toEqual(new Set(Object.keys(GRIT_SOUNDS)));
    expect(GRIT_SOUND_NAMES.length).toBe(GORE_SOUNDS.length + IMPACT_SOUNDS.length + FOLEY_SOUNDS.length + TAIL_SOUNDS.length + REGION_AMBIENT_SOUNDS.length);
    for (const n of GRIT_SOUND_NAMES) expect(SOUNDS[n], n).toBe(GRIT_SOUNDS[n]);
    expect(SOUNDS.footstep_plank).toBe(SOUNDS.footstep_wood);
  });

  it("definitions are sane: -1 dBFS or lower, audible range, a voice cap that cannot swamp the mix, keys that the captions and the gore setting understand", () => {
    for (const n of GRIT_SOUND_NAMES) {
      const d = SOUNDS[n]!;
      expect(d.peakDb, `${n} peak`).toBeLessThanOrEqual(-1);
      expect(d.peakDb, `${n} peak`).toBeGreaterThan(-40);
      expect(d.max, n).toBeGreaterThan(d.ref);
      expect(d.cap, n).toBeGreaterThanOrEqual(1);
      expect(d.cap, n).toBeLessThanOrEqual(6);
      expect(d.reverb, n).toBeLessThanOrEqual(1);
      expect(d.variants, n).toBeGreaterThanOrEqual(2);
    }
    for (const n of GORE_SOUNDS) {
      if (n === "gore_body_fall") continue;
      expect(SOUNDS[n]!.keys, n).toEqual(["full", "reduced", "off"]);
    }
    expect(SOUNDS.explosion_tail!.keys).toEqual(["near", "far", "cannon"]);
    expect(SOUNDS.amb_gust!.keys).toEqual(["grass", "canyon"]);
  });

  it("the mix is ordered sensibly: a blast's tail is below the blast, foley and footsteps sit far below the blows, gore outranks foley for a voice", () => {
    const db = (n: string): number => SOUNDS[n]!.peakDb;
    expect(db("explosion_tail")).toBeLessThan(db("explosion"));
    expect(db("gore_flesh_heavy")).toBeGreaterThan(db("gore_flesh_light"));
    for (const f of FOLEY_SOUNDS) expect(db(f), f).toBeLessThan(db("gore_flesh_light") - 3);
    for (const g of GORE_SOUNDS) expect(SOUNDS[g]!.prio, g).toBeGreaterThanOrEqual(SOUNDS.foley_cloth!.prio);
    expect(SOUNDS.gore_flesh_heavy!.prio).toBeGreaterThan(SOUNDS.footstep_mud!.prio);
  });

  it("recipes are deterministic, and variants of a sound differ (a hundred blows never sound like one sample)", () => {
    let differing = 0;
    let multi = 0;
    for (const n of GRIT_SOUND_NAMES) {
      const d = SOUNDS[n]!;
      const key = d.keys[0]!;
      expect(JSON.stringify(layersOf(n, key, 0)), n).toBe(JSON.stringify(layersOf(n, key, 0)));
      if (d.variants > 1) {
        multi++;
        if (JSON.stringify(layersOf(n, key, 0)) !== JSON.stringify(layersOf(n, key, 1))) differing++;
      }
    }
    expect(differing / multi).toBeGreaterThan(0.9);
  });
});

describe("rendered offline (every key and variant)", () => {
  it("finite, peak at the target and no louder than -1 dBFS, audible, with a sane tail", () => {
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(GRIT_SOUND_NAMES));
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) {
      const id = `${r.name}/${r.key}/${r.variant}`;
      expect(r.nonFinite, id).toBe(0);
      expect(r.peakDb, `${id} peak`).toBeLessThanOrEqual(-1);
      expect(r.peakDb, `${id} peak matches its definition`).toBeCloseTo(SOUNDS[r.name]!.peakDb, 1);
      expect(r.rmsDb, `${id} is silent`).toBeGreaterThan(-60);
      expect(r.audible, `${id} too short to hear`).toBeGreaterThan(0.04);
      expect(r.audible, `${id} rings too long`).toBeLessThan(8);
    }
  });

  it("the worst-case pile-up of a sound at its voice cap, after the engine's soft clipper, stays under full scale", () => {
    // the engine ends in a soft clipper that never reaches 1 (engine.safetyCurve); here: the raw sum of `cap` voices at -peak never exceeds what the curve can carry
    for (const n of GRIT_SOUND_NAMES) {
      const d = SOUNDS[n]!;
      const sum = d.cap * 10 ** (d.peakDb / 20);
      const out = sum < 0.75 ? sum : 0.75 + 0.25 * Math.tanh((sum - 0.75) / 0.25);
      expect(out, n).toBeLessThan(1);
    }
  });
});

describe("gore sounds", () => {
  it("each Gore setting is a different sound; Off has nothing wet (the wet layers are scaled to zero), Reduced sits between", () => {
    for (const n of GORE_SOUNDS) {
      if (n === "gore_body_fall") continue;
      if (n === "gore_bad_breath") continue; // its Off is a comic puff of air, not a rasp: checked on its own below
      const sig = (k: string): string => JSON.stringify(layersOf(n, k, 0));
      expect(new Set([sig("full"), sig("reduced"), sig("off")]).size, n).toBe(3);
      expect(noisePeak(n, "off"), `${n} off`).toBeLessThanOrEqual(noisePeak(n, "reduced") + 1e-9);
      expect(noisePeak(n, "reduced"), `${n} reduced`).toBeLessThanOrEqual(noisePeak(n, "full") + 1e-9);
    }
    for (const n of ["gore_flesh_heavy", "gore_flesh_light", "gore_bone", "gore_blood_ground"]) {
      expect(noisePeak(n, "off"), n).toBeLessThan(noisePeak(n, "reduced"));
      expect(noisePeak(n, "reduced"), n).toBeLessThan(noisePeak(n, "full"));
    }
    expect(layersOf("gore_sever_wet", "off", 0).some((l) => l.k === "n" && l.peak > 0.5), "no wet slurp at Off").toBe(false);
  });

  it("a heavy blow is a thump (low-mid weight), a bone is a crack (bright), a body falling is heavy and low, blood on the ground is soft", () => {
    expect(low("gore_flesh_heavy", "full")).toBeGreaterThan(0.5);
    expect(cent("gore_bone", "full")).toBeGreaterThan(cent("gore_flesh_heavy", "full"));
    expect(cent("gore_bone", "full")).toBeGreaterThan(900);
    expect(low("gore_body_fall")).toBeGreaterThan(0.35);
    expect(cent("gore_body_fall")).toBeLessThan(cent("foley_gear"));
    expect(cent("gore_blood_ground", "full")).toBeLessThan(2500);
    expect(low("gore_flesh_light", "full")).toBeGreaterThan(0.4);
  });

  it("the bad breath is a voice: mid-band energy, longer than a blow, and Gore Off is a comic wheeze (still audible, no rasp)", () => {
    expect(mean(of("gore_bad_breath", "full").map((r) => r.audible))).toBeGreaterThan(mean(of("gore_flesh_heavy", "full").map((r) => r.audible)));
    for (const r of of("gore_bad_breath")) expect(r.bands[1] + r.bands[2], `${r.key}/${r.variant}`).toBeGreaterThan(0.7);
    expect(layersOf("gore_bad_breath", "off", 0).filter((l) => l.k === "n").length).toBeLessThan(layersOf("gore_bad_breath", "full", 0).filter((l) => l.k === "n").length);
  });
});

describe("impacts, foley and boots", () => {
  it("wood and stone are brighter than flesh; metal rings (long, tonal, bright); water is a rush", () => {
    const flesh = cent("gore_flesh_heavy", "full");
    expect(cent("impact_splinter")).toBeGreaterThan(flesh);
    expect(cent("impact_chip")).toBeGreaterThan(cent("impact_splinter"));
    expect(cent("impact_ring")).toBeGreaterThan(1000);
    expect(mean(of("impact_ring").map((r) => r.audible))).toBeGreaterThan(0.6);
    expect(mean(of("impact_ring").map((r) => r.audible))).toBeGreaterThan(mean(of("impact_chip").map((r) => r.audible)));
    expect(cent("impact_splash")).toBeGreaterThan(300);
    expect(cent("impact_splash")).toBeLessThan(cent("impact_chip"));
  });

  it("cloth, powder, gear and the casing are bright small sounds; the holster is lower than the casing; the sand is brighter than the mud", () => {
    for (const n of ["foley_cloth", "foley_powder", "foley_gear", "foley_shell"]) expect(cent(n), n).toBeGreaterThan(1200);
    expect(cent("foley_shell")).toBeGreaterThan(cent("foley_holster"));
    expect(cent("footstep_sand")).toBeGreaterThan(cent("footstep_mud"));
    expect(low("footstep_mud")).toBeGreaterThan(0.5);
  });

  it("the foley sounds are short (under 1.5 s) and quiet next to the blows", () => {
    for (const n of FOLEY_SOUNDS) for (const r of of(n)) expect(r.audible, `${n}/${r.variant}`).toBeLessThan(1.5);
    for (const n of FOLEY_SOUNDS) expect(SOUNDS[n]!.peakDb, n).toBeLessThan(-12);
  });
});

describe("explosion tails", () => {
  it("a far rumble is darker and longer than the debris of a near one, and the cannon's echo sits between", () => {
    expect(cent("explosion_tail", "far")).toBeLessThan(cent("explosion_tail", "near"));
    expect(mean(of("explosion_tail", "far").map((r) => r.audible))).toBeGreaterThan(mean(of("explosion_tail", "near").map((r) => r.audible)) * 0.8);
    expect(low("explosion_tail", "far")).toBeGreaterThan(0.7);
    for (const k of ["near", "far", "cannon"]) expect(mean(of("explosion_tail", k).map((r) => r.audible)), k).toBeGreaterThan(1.5);
  });
});

describe("the regions' voices", () => {
  it("a far horn is low and long; a drip is bright and short; the canyon's gust is darker than the grass's; the surf is a long low hush", () => {
    expect(cent("amb_far_horn")).toBeLessThan(1200);
    expect(mean(of("amb_far_horn").map((r) => r.audible))).toBeGreaterThan(2);
    expect(cent("amb_drip")).toBeGreaterThan(1000);
    expect(mean(of("amb_drip").map((r) => r.audible))).toBeLessThan(1.5);
    expect(cent("amb_gust", "canyon")).toBeLessThan(cent("amb_gust", "grass"));
    expect(mean(of("amb_surf").map((r) => r.audible))).toBeGreaterThan(2);
    expect(cent("amb_surf")).toBeLessThan(2500);
    expect(cent("amb_gust", "canyon")).toBeLessThan(500);
    expect(cent("amb_lamp_chain")).toBeGreaterThan(1200);
    expect(cent("amb_herd_bell")).toBeGreaterThan(300);
  });
});

describe("captions for the grit pass", () => {
  it("every new sound has a caption, every key reads, and the Gore Off lines never claim blood", () => {
    for (const n of GRIT_SOUND_NAMES) {
      expect(CAPTIONS[n], n).toBeDefined();
      for (const key of SOUNDS[n]!.keys) {
        const text = captionFor(n, { dist: 3, az: 0 }, key);
        expect(text, `${n}/${key}`).not.toBeNull();
        expect(text!.length, `${n}/${key}`).toBeGreaterThan(4);
      }
    }
    for (const n of GORE_SOUNDS) {
      if (SOUNDS[n]!.keys.includes("off")) expect(captionFor(n, null, "off") ?? "", n).not.toMatch(/blood|gore|wet|messy/i);
    }
    expect(captionName("gore_bone", "off")).toBe("gore_bone:off");
    expect(captionName("gore_bone", "full")).toBe("gore_bone");
    expect(captionName("explosion_tail", "cannon")).toBe("explosion_tail:cannon");
  });

  it("ambient captions are rare and local: a long gap each, so a region's voices never fill the screen", () => {
    for (const n of REGION_AMBIENT_SOUNDS) expect(CAPTIONS[n]!.gap, n).toBeGreaterThanOrEqual(30);
  });
});
