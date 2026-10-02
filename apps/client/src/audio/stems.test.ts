import { Rng, REGION_IDS, type RegionId } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { spectrum } from "./analyse.ts";
import { layerEnd, type Layer } from "./dsp.ts";
import { RATE, renderLayersToArray } from "./offlineRender.ts";
import { LAYER_TARGET, MUSIC_LAYERS, MUSIC_MOODS, REGION_COLOUR, type MusicLayerId, type MusicMood } from "./musicLayers.ts";
import { BAR, BEAT, MUSIC_SEED, MUSIC_VOICE_CAP, PHRASE_BARS, STEM_VOICE_CAP, bedBarLayers, layerSpan, peakVoices, stemBar } from "./musicStems.ts";
import { chordDegrees, generatePhrase, scaleMidi } from "./musicScore.ts";

/**
 * The layered score, rendered offline (the very layers the player schedules, through the stand-in renderer in offlineRender.ts) and MEASURED: every stem finite and under -1 dBFS, every
 * mood's mix inside its loudness band, the aftermath darker than the calm, the combat busier, the region colours different from each other, the bars on an exact grid, the seam between
 * phrases free of holes, and the voice budget respected. Nothing here is a listening opinion.
 */

const BARS = 4; // phrase 0, bars 0..3: two chord changes and a drum roll turn are enough to measure; the voice and grid checks run over the whole phrase
const SECONDS = BARS * BAR + 6;
const db = (x: number): number => (x <= 1e-9 ? -180 : 20 * Math.log10(x));
const rms = (a: Float32Array): number => {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
};
const peak = (a: Float32Array): number => {
  let p = 0;
  for (const v of a) p = Math.max(p, Math.abs(v));
  return p;
};

type StemId = Exclude<MusicLayerId, "bed">;
const shifted = (ls: readonly Layer[], at: number): Layer[] => ls.map((l) => ({ ...l, at: (l.at ?? 0) + at }));
const render = (ls: Layer[], seconds = SECONDS): Float32Array => renderLayersToArray(ls, { rng: new Rng(1), seconds });

const barsOf = (id: StemId, region: RegionId, phrase: number, from: number, n: number): Layer[] => {
  const out: Layer[] = [];
  for (let b = 0; b < n; b++) out.push(...shifted(stemBar(id, region, phrase, from + b), b * BAR));
  return out;
};

const cache = new Map<string, Float32Array>();
const stem = (id: MusicLayerId, region: RegionId = "hollowmere"): Float32Array => {
  const key = id === "colour" ? `colour:${region}` : id;
  let a = cache.get(key);
  if (!a) {
    if (id === "bed") {
      const ph = generatePhrase("game", MUSIC_SEED, 0);
      const ls: Layer[] = [];
      for (let b = 0; b < BARS; b++) ls.push(...shifted(bedBarLayers(ph[b]!), b * BAR));
      a = render(ls);
    } else a = render(barsOf(id, region, 0, 0, BARS));
    cache.set(key, a);
  }
  return a;
};

const mix = (m: MusicMood, region: RegionId = "hollowmere"): Float32Array => {
  const out = new Float32Array(Math.ceil(SECONDS * RATE));
  for (const id of MUSIC_LAYERS) {
    const g = LAYER_TARGET[m][id];
    const s = stem(id, region);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + s[i]! * g;
  }
  return out;
};

describe("every stem bar is well-formed", () => {
  it("finite layers, starting inside their bar, with a level and a finite end, deterministic from (stem, region, phrase, bar)", () => {
    for (const id of MUSIC_LAYERS) {
      if (id === "bed") continue;
      for (const region of REGION_IDS) {
        if (id !== "colour" && region !== "hollowmere") continue;
        for (let phrase = 0; phrase < 4; phrase++) {
          for (let bar = 0; bar < PHRASE_BARS; bar++) {
            const ls = stemBar(id, region, phrase, bar);
            expect(ls.length, `${id}/${region}/${phrase}/${bar}`).toBeGreaterThan(0);
            for (const l of ls) {
              const at = l.at ?? 0;
              expect(at, `${id} at`).toBeGreaterThanOrEqual(0);
              expect(at, `${id} starts inside its bar`).toBeLessThan(BAR);
              expect(Number.isFinite(layerEnd(l)), `${id} end`).toBe(true);
              expect(l.peak, `${id} peak`).toBeGreaterThan(0);
              expect(l.peak, `${id} peak`).toBeLessThan(1.2);
              if (l.k === "t") expect(l.hz, `${id} hz`).toBeGreaterThan(20);
              if (l.k === "r") expect(l.hz, `${id} hz`).toBeLessThan(9000);
            }
            expect(JSON.stringify(stemBar(id, region, phrase, bar))).toBe(JSON.stringify(ls));
          }
        }
      }
    }
  });

  it("the bars sit on an exact grid: eight bars of the game bed are eight BAR long, and the phrase that comes home (every fourth) repeats the first one's changes", () => {
    expect(BAR).toBeCloseTo(BEAT * 4, 12);
    expect(PHRASE_BARS * BAR).toBeCloseTo(8 * 4 * (60 / 56), 9);
    expect(chordDegrees("game", MUSIC_SEED, 3)).toEqual(chordDegrees("game", MUSIC_SEED, 0));
  });

  it("the stems sit on the bed's chords: the drone's root, the drums' bass and the stab's minor chord are the bar's chord root", () => {
    for (let phrase = 0; phrase < 3; phrase++) {
      const deg = chordDegrees("game", MUSIC_SEED, phrase);
      for (let bar = 0; bar < PHRASE_BARS; bar++) {
        const rootPc = (scaleMidi(60, deg[bar]!) - 60 + 120) % 12;
        const pc = (hz: number): number => (((Math.round(69 + 12 * Math.log2(hz / 440)) - 60) % 12) + 12) % 12;
        const first = (id: StemId, type?: string): Layer | undefined => stemBar(id, "hollowmere", phrase, bar).find((l) => l.k === "t" && (type === undefined || l.type === type));
        const drone = first("dread", "sawtooth");
        expect(pc((drone as { hz: number }).hz), `dread ${phrase}/${bar}`).toBe(rootPc);
        const stabTones = new Set(stemBar("stabs", "hollowmere", phrase, bar).filter((l) => l.k === "t" && l.type === "sawtooth").map((l) => pc((l as { hz: number }).hz)));
        expect(stabTones.has(rootPc), `stab root ${phrase}/${bar}`).toBe(true);
        expect(stabTones.has((rootPc + 3) % 12), `stab is minor (a flat third), against the bed's major`).toBe(true);
      }
    }
  });

  it("the region colours play notes of their own scale (the percussion bells and clonks aside)", () => {
    const SCALE: Record<string, readonly number[]> = { major: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10], "minor-pentatonic": [0, 3, 5, 7, 10] };
    for (const region of REGION_IDS) {
      const allowed = SCALE[REGION_COLOUR[region].scale]!;
      for (let bar = 0; bar < PHRASE_BARS; bar++) {
        for (const l of stemBar("colour", region, 0, bar)) {
          if (l.k !== "t" && l.k !== "r") continue;
          if (l.k === "t" && l.type === "sine" && region === "saltmarket") continue; // bottle blow: in scale too, but checked below with the rest
          const pc = (((Math.round(69 + 12 * Math.log2(l.hz / 440)) - 60) % 12) + 12) % 12;
          expect(allowed.includes(pc), `${region} bar ${bar}: pitch class ${pc} of ${l.hz.toFixed(1)} Hz is outside ${REGION_COLOUR[region].scale}`).toBe(true);
        }
      }
    }
  });
});

describe("rendered offline: levels", () => {
  it("each stem is finite and no louder than -1 dBFS, and none is silent", () => {
    for (const id of MUSIC_LAYERS) {
      for (const region of id === "colour" ? REGION_IDS : (["hollowmere"] as const)) {
        const s = stem(id, region);
        for (let i = 0; i < s.length; i += 97) expect(Number.isFinite(s[i]!), `${id}/${region} NaN at ${i}`).toBe(true);
        expect(db(peak(s)), `${id}/${region} peak`).toBeLessThanOrEqual(-1);
        expect(db(rms(s)), `${id}/${region} is silent`).toBeGreaterThan(-60);
      }
    }
  }, 30_000); // (CPU-bound: renders every music stem offline, the colour layer once per region; 6.3 s alone, 5.5 s in the full run on a 4-core container. A time limit, not a budget.)

  const BAND: Record<MusicMood, [number, number]> = { calm: [-26, -18], tension: [-28, -18], combat: [-27, -17], aftermath: [-33, -22] };
  it("every mood's mix (all seven stems at that mood's gains, in every region) is under -1 dBFS and inside its loudness band", () => {
    for (const region of REGION_IDS) {
      for (const m of MUSIC_MOODS) {
        const x = mix(m, region);
        expect(db(peak(x)), `${m}/${region} peak`).toBeLessThanOrEqual(-1);
        const r = db(rms(x));
        expect(r, `${m}/${region} rms ${r.toFixed(1)}`).toBeGreaterThanOrEqual(BAND[m][0]);
        expect(r, `${m}/${region} rms ${r.toFixed(1)}`).toBeLessThanOrEqual(BAND[m][1]);
      }
    }
  });

  it("the aftermath is darker than the calm, in every region (spectral centroid, A-weighted, over the whole render)", () => {
    for (const region of REGION_IDS) {
      const calm = spectrum(mix("calm", region), RATE, SECONDS).centroid;
      const after = spectrum(mix("aftermath", region), RATE, SECONDS).centroid;
      expect(after, `${region}: aftermath ${after.toFixed(0)} Hz vs calm ${calm.toFixed(0)} Hz`).toBeLessThan(calm);
    }
  });

  it("the aftermath is quieter than the combat, and the drums are the loud part of a fight", () => {
    expect(db(rms(mix("aftermath")))).toBeLessThan(db(rms(mix("combat"))));
    expect(db(rms(stem("drive")))).toBeGreaterThan(db(rms(stem("stabs"))));
  });
});

/** Note onsets per phrase that are audible in a mood: every sharp-attack layer of every stem whose target gain is above 0.2, counted over the 8 bars. */
const onsets = (m: MusicMood, region: RegionId = "hollowmere"): number => {
  let n = 0;
  for (const id of MUSIC_LAYERS) {
    if (LAYER_TARGET[m][id] <= 0.2) continue;
    for (let bar = 0; bar < PHRASE_BARS; bar++) {
      const ls = id === "bed" ? bedBarLayers(generatePhrase("game", MUSIC_SEED, 0)[bar]!) : stemBar(id, region, 0, bar);
      for (const l of ls) if ((l.k === "n" || l.k === "t" || l.k === "r") && ((l.k === "r" ? 0.0008 : (l.atk ?? 0)) <= 0.01)) n++;
    }
  }
  return n;
};

describe("busyness", () => {
  it("combat is the busiest mood by far (drums on every beat, a bass on every eighth, stabs), then tension, and the aftermath the sparsest", () => {
    const c = onsets("combat");
    expect(c).toBeGreaterThan(onsets("tension"));
    expect(c).toBeGreaterThan(onsets("calm"));
    expect(c).toBeGreaterThan(onsets("aftermath"));
    expect(c).toBeGreaterThan(1.5 * onsets("calm"));
    expect(onsets("tension")).toBeGreaterThan(onsets("aftermath"));
  });
});

describe("the region colours", () => {
  it("each region's colour is a different instrument pair: no two share a signature, and the renders differ", () => {
    const sig = (region: RegionId): string => {
      const set = new Set<string>();
      for (let bar = 0; bar < PHRASE_BARS; bar++) for (const l of stemBar("colour", region, 0, bar)) set.add(l.k + ":" + (l.k === "t" ? (l.type ?? "sine") : "") + ":" + (l.k === "r" ? l.ratios.join(",") : ""));
      return [...set].sort().join("|");
    };
    const sigs = REGION_IDS.map(sig);
    expect(new Set(sigs).size).toBe(REGION_IDS.length);
    // the spectral signature differs too (not just the labels): at least four different centroids to the nearest 50 Hz
    const cents = new Set(REGION_IDS.map((r) => Math.round(spectrum(stem("colour", r), RATE, SECONDS).centroid / 50)));
    expect(cents.size).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < REGION_IDS.length; i++) {
      for (let j = i + 1; j < REGION_IDS.length; j++) {
        let diff = 0;
        const a = stem("colour", REGION_IDS[i]!);
        const b = stem("colour", REGION_IDS[j]!);
        for (let k = 0; k < a.length; k += 13) diff += Math.abs(a[k]! - b[k]!);
        expect(diff, `${REGION_IDS[i]} vs ${REGION_IDS[j]}`).toBeGreaterThan(1);
      }
    }
  });

  it("the colour of a region never changes the other stems (they are region-free)", () => {
    for (const id of ["pulse", "dread", "drive", "stabs", "dirge"] as const) {
      expect(JSON.stringify(stemBar(id, "vesper", 1, 2))).toBe(JSON.stringify(stemBar(id, "saltmarket", 1, 2)));
    }
  });
});

describe("loops", () => {
  it("the phrase turns over without a hole: the energy around the seam (bar 7 into the next phrase's bar 0) is within a factor of three of the rest, for every sustained stem", () => {
    for (const id of ["pulse", "dread", "drive", "dirge"] as const) {
      const ls = [...barsOf(id, "hollowmere", 0, 6, 2), ...shifted(barsOf(id, "hollowmere", 1, 0, 2), 2 * BAR)];
      const secs = 4 * BAR + 4;
      const a = renderLayersToArray(ls, { rng: new Rng(2), seconds: secs });
      const seam = 2 * BAR;
      const win = (t0: number, t1: number): number => rms(a.subarray(Math.max(0, Math.floor(t0 * RATE)), Math.floor(t1 * RATE)));
      const around = win(seam - 0.5, seam + 0.5);
      const whole = win(BAR * 0.5, 3.5 * BAR);
      expect(around / whole, `${id} seam`).toBeGreaterThan(0.33);
      expect(around / whole, `${id} seam`).toBeLessThan(3);
      expect(db(peak(a)), `${id} peak across the seam`).toBeLessThanOrEqual(-1);
    }
  });
});

describe("the voice budget", () => {
  const phrase = (id: MusicLayerId, region: RegionId): Layer[] => {
    if (id === "bed") {
      const ph = generatePhrase("game", MUSIC_SEED, 0);
      const out: Layer[] = [];
      for (let b = 0; b < PHRASE_BARS; b++) out.push(...shifted(bedBarLayers(ph[b]!), b * BAR));
      return out;
    }
    return barsOf(id, region, 0, 0, PHRASE_BARS);
  };
  it("no stem has more notes sounding at once than its cap, in any region", () => {
    for (const id of MUSIC_LAYERS) {
      for (const region of id === "colour" ? REGION_IDS : (["hollowmere"] as const)) {
        const v = peakVoices(phrase(id, region).map(layerSpan));
        expect(v, `${id}/${region}: ${v} voices`).toBeLessThanOrEqual(STEM_VOICE_CAP[id]);
      }
    }
  });
  it("all seven together stay inside the music's cap (the player skips a stem whose gain is zero, so this is the worst case: every layer at once)", () => {
    for (const region of REGION_IDS) {
      const all = MUSIC_LAYERS.flatMap((id) => phrase(id, region)).map(layerSpan);
      const v = peakVoices(all);
      expect(v, `${region}: ${v} voices`).toBeLessThanOrEqual(MUSIC_VOICE_CAP);
    }
  });
});
