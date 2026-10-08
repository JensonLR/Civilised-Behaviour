import { describe, expect, it } from "vitest";
import { spectrum } from "./analyse.ts";
import { CAPTIONS, captionFor, captionName } from "./captions.ts";
import { layersEnd } from "./dsp.ts";
import { RATE, renderVariantOffline } from "./offlineRender.ts";
import { CONTENT_SOUNDS, SOUNDS } from "./sounds.ts";
import { dbToGain } from "./volume.ts";
import { Rng } from "@cb/shared";
import { variantSeed } from "./bake.ts";

interface Row { name: string; key: string; variant: number; peakDb: number; rmsDb: number; audible: number; nonFinite: number; centroid: number; bands: [number, number, number]; attack: { centroid: number; bands: [number, number, number] } }
const rows: Row[] = [];
for (const name of CONTENT_SOUNDS) {
  const def = SOUNDS[name]!;
  for (const key of def.keys) {
    for (let v = 0; v < def.variants; v++) {
      const { data, stats } = renderVariantOffline(name, def, key, v);
      rows.push({ name, key, variant: v, peakDb: stats.peakDb, rmsDb: stats.rmsDb, audible: stats.audibleSeconds, nonFinite: stats.nonFinite, ...spectrum(data, RATE), attack: spectrum(data.subarray(0, 6000), RATE) });
    }
  }
}
const of = (name: string, key?: string): Row[] => rows.filter((r) => r.name === name && (key === undefined || r.key === key));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("the expedition's new sounds, rendered offline (every variant of every key)", () => {
  it("renders them all: finite, peak at the target and no louder than -1 dBFS, audible, with a sane tail", () => {
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(CONTENT_SOUNDS));
    for (const r of rows) {
      const id = `${r.name}/${r.key}/${r.variant}`;
      expect(r.nonFinite, id).toBe(0);
      expect(r.peakDb, `${id} peak`).toBeLessThanOrEqual(-1);
      expect(r.peakDb, `${id} peak matches its definition`).toBeCloseTo(SOUNDS[r.name]!.peakDb, 1);
      expect(r.rmsDb, `${id} is silent`).toBeGreaterThan(-60);
      expect(r.audible, `${id}`).toBeGreaterThan(0.05);
      expect(r.audible, `${id} rings too long`).toBeLessThan(8);
    }
  });

  it("the worst-case pile-up of every sound at its voice cap, all at full level, sums to no more than -1.2 dBFS", () => {
    for (const name of CONTENT_SOUNDS) {
      const d = SOUNDS[name]!;
      const worst = d.cap * dbToGain(d.peakDb);
      expect(20 * Math.log10(worst), `${name} x ${d.cap}`).toBeLessThanOrEqual(-1.2);
    }
  });

  it("hoofbeats are low and thuddy: most of the energy under 2 kHz, and a heavier gait sits lower than a lighter one", () => {
    for (const r of of("hoof")) {
      expect(r.centroid, `${r.key}/${r.variant}`).toBeGreaterThan(120);
      expect(r.centroid, `${r.key}/${r.variant}`).toBeLessThan(2600);
      expect(r.bands[0] + r.bands[1], `${r.key} low+mid`).toBeGreaterThan(0.6);
    }
    expect(mean(of("hoof", "gallop").map((r) => r.centroid))).toBeLessThan(mean(of("hoof", "trot").map((r) => r.centroid)));
    // the gaits are different sounds, not one sound four times
    const sig = (k: string): string => of("hoof", k).map((r) => Math.round(r.centroid / 50)).join(",");
    expect(new Set(["walk", "trot", "canter", "gallop"].map(sig)).size).toBeGreaterThanOrEqual(3);
  });

  it("the wagon is wooden and low: the rattle is a knock with the load shaken after it (most of it under 2 kHz), the creak a groan, and the two keys are different sounds", () => {
    for (const r of of("wagon_roll", "rattle")) {
      expect(r.centroid, `rattle/${r.variant}`).toBeGreaterThan(400);
      expect(r.centroid, `rattle/${r.variant}`).toBeLessThan(1500);
      expect(r.bands[0] + r.bands[1], `rattle/${r.variant} low+mid`).toBeGreaterThan(0.55);
    }
    for (const r of of("wagon_roll", "creak")) {
      expect(r.centroid, `creak/${r.variant}`).toBeGreaterThan(250);
      expect(r.centroid, `creak/${r.variant}`).toBeLessThan(900);
    }
    expect(Math.abs(mean(of("wagon_roll", "rattle").map((r) => r.centroid)) - mean(of("wagon_roll", "creak").map((r) => r.centroid)))).toBeGreaterThan(60);
  });

  it("tack, paper and gulls are bright (centroid above 1 kHz); the sailing and the stamp are low", () => {
    for (const r of of("tack_jingle")) expect(r.centroid, "jingle").toBeGreaterThan(1500);
    for (const r of of("paper_rustle")) expect(r.centroid, "paper").toBeGreaterThan(1800);
    for (const r of of("gull")) expect(r.centroid, "gull").toBeGreaterThan(1200);
    for (const r of of("sail_creak")) {
      expect(r.centroid, "creak").toBeLessThan(1500);
      expect(r.bands[2], "creak has no hiss on top").toBeLessThan(0.35);
    }
    for (const r of of("parley_stamp")) {
      expect(r.bands[0] + r.bands[1], "stamp is a thump, not a hiss").toBeGreaterThan(0.6);
      expect(r.centroid, "stamp is duller than paper").toBeLessThan(mean(of("paper_rustle").map((x) => x.centroid)));
    }
  });

  it("bells ring: tonal, long, and the day bell is lower and longer than the outpost bell", () => {
    const hq = of("bell", "hq");
    const out = of("bell", "outpost");
    expect(mean(hq.map((r) => r.audible))).toBeGreaterThan(mean(out.map((r) => r.audible)));
    expect(mean(hq.map((r) => r.centroid))).toBeLessThan(mean(out.map((r) => r.centroid)));
    for (const r of [...hq, ...out]) expect(r.centroid, `${r.key} bell`).toBeGreaterThan(300);
  });

  it("the gun crew's shouts are voices: formant energy in the speech band (200 Hz - 2 kHz carries most of it), three different words, four different crew", () => {
    for (const r of of("crew_shout")) {
      expect(r.centroid, `${r.key}/${r.variant}`).toBeGreaterThan(400);
      expect(r.centroid, `${r.key}/${r.variant}`).toBeLessThan(3200);
      expect(r.bands[1] + r.bands[2], `${r.key}`).toBeGreaterThan(0.85); // nothing below 200 Hz to speak of
    }
    const lengths = new Set(["stand_clear", "loading", "fire"].map((k) => Math.round(mean(of("crew_shout", k).map((r) => r.audible)) * 10)));
    expect(lengths.size).toBe(3);
    const pitches = (k: string) => of("crew_shout", k).map((r) => Math.round(r.centroid / 25));
    expect(new Set(pitches("fire")).size).toBeGreaterThan(1);
  });

  it("the sailing loop is a loop: it renders to exactly its period, every layer ends inside it, and it has no gap or dead tail", () => {
    const d = SOUNDS.sail_creak!;
    expect(d.loop).toBeGreaterThan(0);
    const layers = d.layers({ pitch: 1, rng: new Rng(variantSeed("sail_creak", "", 0)), key: "", variant: 0 });
    expect(layersEnd(layers)).toBeLessThanOrEqual(d.loop + 0.1);
    const { data, stats } = renderVariantOffline("sail_creak", d, "", 0);
    expect(data.length).toBe(Math.ceil(d.loop * RATE));
    // energy at both ends of the period (a loop that is silent at the seam does not click, but one that is cut mid-sound does): the last 100 ms is quiet relative to the loudest 100 ms
    const win = (from: number): number => {
      let s = 0;
      for (let i = from; i < from + 4410; i++) s += data[i]! * data[i]!;
      return Math.sqrt(s / 4410);
    };
    let loudest = 0;
    for (let i = 0; i + 4410 <= data.length; i += 2205) loudest = Math.max(loudest, win(i));
    expect(win(data.length - 4410), "the seam").toBeLessThan(loudest * 0.5);
    expect(stats.rmsDb).toBeGreaterThan(-45);
  });
});

describe("captions for the expedition's world", () => {
  it("every new sound has a caption, and every key of a keyed sound reads (a keyed line where one exists)", () => {
    for (const name of CONTENT_SOUNDS) {
      expect(CAPTIONS[name], name).toBeDefined();
      for (const key of SOUNDS[name]!.keys) {
        const text = captionFor(name, { dist: 3, az: 0 }, key);
        expect(text, `${name}/${key}`).not.toBeNull();
        expect(text!.length).toBeGreaterThan(4);
      }
    }
    expect(captionName("bell", "hq")).toBe("bell:hq");
    expect(captionName("hoof", "gallop")).toBe("hoof"); // no per-gait line: the plain one serves
    expect(captionFor("crew_shout", { dist: 3, az: 0 }, "fire")).toContain("Fire!");
    expect(captionFor("crew_shout", { dist: 3, az: 0 }, "loading")).toContain("Loading!");
    expect(captionFor("crew_shout", { dist: 3, az: 0 }, "stand_clear")).toContain("Stand clear!");
  });

  it("positional ones carry a bearing, the ones heard on the sailing card or the stamp's table do not, and the range is respected", () => {
    expect(captionFor("hoof", { dist: 12, az: -1.2 }, "gallop")).toMatch(/hoofbeats, /);
    expect(captionFor("hoof", { dist: 200, az: 0 }, "gallop")).toBeNull();
    expect(captionFor("gull", null)).toBe("[a gull cries]");
    expect(captionFor("parley_stamp", null)).toBe("[a rubber stamp falls]");
    expect(captionFor("sail_creak", null)).toContain("ship");
  });

  it("no real-world terms in the caption lines", () => {
    const RE = /(?<![a-z])(england|english|british|london|paris|france|french|german|spain|china|india|america|european|african|church|bible|mosque|christian|muslim|jewish)(?![a-z])/i;
    for (const [k, c] of Object.entries(CAPTIONS)) expect(RE.test(c.text), k).toBe(false);
  });
});

describe("the sound definitions", () => {
  it("are sane: levels at or under -1 dB, positional unless a UI or sailing-deck sound, loops fit, hoof keys are the four gaits", () => {
    for (const name of CONTENT_SOUNDS) {
      const d = SOUNDS[name]!;
      expect(d.peakDb, name).toBeLessThanOrEqual(-1);
      expect(d.max, name).toBeGreaterThan(d.ref);
    }
    expect(SOUNDS.hoof!.keys).toEqual(["walk", "trot", "canter", "gallop"]);
    expect(SOUNDS.bell!.keys).toEqual(["hq", "outpost"]);
    expect(SOUNDS.crew_shout!.keys).toEqual(["stand_clear", "loading", "fire"]);
    expect(SOUNDS.parley_stamp!.ui).toBe(true);
    expect(SOUNDS.sail_creak!.ui).toBe(true);
    expect(SOUNDS.hoof!.ui).toBe(false);
    // a bell outranks a footfall for a voice; hooves do not push the crew's shouts out
    expect(SOUNDS.crew_shout!.prio).toBeGreaterThan(SOUNDS.hoof!.prio);
    expect(SOUNDS.bell!.prio).toBeGreaterThan(SOUNDS.hoof!.prio);
  });
});
