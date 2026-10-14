import { describe, expect, it } from "vitest";
import { BABBLE_KEYS, PEOPLE_IDS, Rng } from "@cb/shared";
import { spectrum } from "./analyse.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { SOUNDS } from "./sounds.ts";
import { FOLK_SPEECH, FOLK_VOICES, folkVariant } from "./babble.ts";

/** D-131: the folk's voices, rendered offline: every people, every voice, every shape. */
const def = SOUNDS.folk_voice!;
const rows = PEOPLE_IDS.flatMap((people) =>
  FOLK_VOICES.flatMap((_, voice) =>
    BABBLE_KEYS.map((key) => {
      const { data, stats } = renderVariantOffline("folk_voice", def, key, folkVariant(people, voice));
      return { people, voice, key, ...stats, ...spectrum(data, RATE) };
    }),
  ),
);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("D-131: the folk speak aloud", () => {
  it("has a voice for every people (low, high, a child's), each its own variant", () => {
    expect(def.variants).toBe(PEOPLE_IDS.length * FOLK_VOICES.length);
    const seen = new Set(PEOPLE_IDS.flatMap((p) => FOLK_VOICES.map((_, v) => folkVariant(p, v))));
    expect(seen.size).toBe(def.variants);
    for (const p of PEOPLE_IDS) expect(FOLK_SPEECH[p], p).toBeDefined();
  });

  it("renders clean: finite, audible, at its level, a line not a speech, and quieter than the Society's bluster", () => {
    for (const r of rows) {
      const id = `${r.people}/${r.voice}/${r.key}`;
      expect(r.nonFinite, id).toBe(0);
      expect(r.peakDb, id).toBeCloseTo(def.peakDb, 1);
      expect(r.audibleSeconds, id).toBeGreaterThan(0.15);
      expect(r.audibleSeconds, id).toBeLessThan(3);
      expect(r.centroid, id).toBeGreaterThan(250);
      expect(r.centroid, id).toBeLessThan(3600);
    }
    expect(def.peakDb).toBeLessThan(SOUNDS.babble!.peakDb);
    expect(def.max).toBeLessThan(SOUNDS.babble!.max);
  });

  it("each people sounds like itself: the gorge's folk slow, the Brinefolk quick; a child above a low voice", () => {
    const len = (p: string): number => mean(rows.filter((r) => r.people === p && r.key === "boast").map((r) => r.audibleSeconds));
    expect(len("vesperine")).toBeGreaterThan(len("brinefolk") * 1.2);
    // (the sung pitch of every vowel: the A-weighted centroid cannot tell a child's sparse harmonics from a low voice's)
    const pitch = (v: number): number => mean(PEOPLE_IDS.flatMap((p) => def.layers({ pitch: 1, rng: new Rng(7), key: "boast", variant: folkVariant(p, v) }).flatMap((l) => (l.k === "v" ? [l.hz] : []))));
    expect(pitch(2)).toBeGreaterThan(pitch(1));
    expect(pitch(1)).toBeGreaterThan(pitch(0) * 1.4);
    // (no two peoples share their vowels and pace)
    const sig = new Set(PEOPLE_IDS.map((p) => `${FOLK_SPEECH[p].tempo}:${FOLK_SPEECH[p].vowels.length}:${FOLK_SPEECH[p].f0}`));
    expect(sig.size).toBe(PEOPLE_IDS.length);
  });
});
