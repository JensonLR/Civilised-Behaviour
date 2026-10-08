import { describe, expect, it } from "vitest";
import { BABBLE_KEYS, Rng } from "@cb/shared";
import { spectrum } from "./analyse.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { SOUNDS } from "./sounds.ts";
import { BABBLE_VOICES, babbleLayers } from "./babble.ts";
import { layersEnd } from "./dsp.ts";

/** D-087: the Society's voice, rendered offline: every phrase shape in every voice. */
const def = SOUNDS.babble!;
const rows = BABBLE_KEYS.flatMap((key) =>
  Array.from({ length: def.variants }, (_, v) => {
    const { data, stats } = renderVariantOffline("babble", def, key, v);
    return { key, v, ...stats, ...spectrum(data, RATE) };
  }),
);
const of = (key: string) => rows.filter((r) => r.key === key);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("the Society's voice: pompous gibberish (D-087)", () => {
  it("renders clean in every voice and shape: finite, audible, at its level and never above -1 dBFS", () => {
    expect(rows.length).toBe(BABBLE_KEYS.length * BABBLE_VOICES.length);
    for (const r of rows) {
      const id = `${r.key}/${r.v}`;
      expect(r.nonFinite, id).toBe(0);
      expect(r.peakDb, id).toBeLessThanOrEqual(-1);
      expect(r.peakDb, id).toBeCloseTo(def.peakDb, 1);
      expect(r.audibleSeconds, id).toBeGreaterThan(0.2);
      expect(r.audibleSeconds, `${id} is a line, not a speech`).toBeLessThan(2.5);
    }
  });

  it("is a voice: most of its energy in the speech band, little below 200 Hz", () => {
    for (const r of rows) {
      expect(r.centroid, `${r.key}/${r.v}`).toBeGreaterThan(300);
      expect(r.centroid, `${r.key}/${r.v}`).toBeLessThan(3200);
      expect(r.bands[1] + r.bands[2], `${r.key}/${r.v}`).toBeGreaterThan(0.75);
    }
  });

  it("the shapes are different speech: an exclamation is short, a boast long; the high voice sits above the low one", () => {
    expect(mean(of("exclaim").map((r) => r.audibleSeconds))).toBeLessThan(mean(of("boast").map((r) => r.audibleSeconds)));
    expect(mean(of("mutter").map((r) => r.rmsDb))).toBeLessThan(mean(of("exclaim").map((r) => r.rmsDb)));
    const low = rows.filter((r) => r.v === 0), high = rows.filter((r) => r.v === BABBLE_VOICES.length - 1);
    expect(mean(high.map((r) => r.centroid))).toBeGreaterThan(mean(low.map((r) => r.centroid)));
  });

  it("is syllables, not one long vowel: a boast has five to seven, each a vowel (with now and then a consonant before it); a question ends higher than it starts", () => {
    for (let seed = 1; seed < 30; seed++) {
      const ls = babbleLayers("boast", BABBLE_VOICES[1]!, new Rng(seed));
      const vowels = ls.filter((l) => l.k === "v" && l.formants[0]![0] > 300 * 0.98);
      expect(vowels.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(vowels.length, `seed ${seed}`).toBeLessThanOrEqual(10);
      expect(layersEnd(ls), `seed ${seed}`).toBeLessThan(2.2);
      const q = babbleLayers("question", BABBLE_VOICES[1]!, new Rng(seed)).filter((l) => l.k === "v");
      const first = q[0]!, last = q[q.length - 1]!;
      expect(last.k === "v" && first.k === "v" && last.to > first.hz, `seed ${seed}`).toBe(true);
    }
  });
});
