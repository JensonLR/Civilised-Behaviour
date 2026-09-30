import { describe, expect, it } from "vitest";
import { MODES, beatSeconds, generatePhrase, inScale, scaleMidi, type MusicMode } from "./musicScore.ts";

const MODE_LIST: MusicMode[] = ["menu", "game"];

describe("generative score", () => {
  it("is deterministic: the same seed and phrase always give the same music", () => {
    for (const mode of MODE_LIST) for (let p = 0; p < 6; p++) expect(generatePhrase(mode, 1234, p)).toEqual(generatePhrase(mode, 1234, p));
  });

  it("different seeds and different phrases give different tunes", () => {
    const a = JSON.stringify(generatePhrase("menu", 1, 0));
    expect(JSON.stringify(generatePhrase("menu", 2, 0))).not.toBe(a);
    expect(JSON.stringify(generatePhrase("menu", 1, 1))).not.toBe(a);
  });

  it("every fourth phrase brings the first tune home", () => {
    expect(generatePhrase("menu", 77, 3)).toEqual(generatePhrase("menu", 77, 0));
    expect(generatePhrase("game", 77, 7)).toEqual(generatePhrase("game", 77, 0));
  });

  it("stays inside its scale, its register and its bar", () => {
    for (const mode of MODE_LIST) {
      const info = MODES[mode];
      for (const seed of [1, 42, 999, 0xc0ffee]) {
        for (let phrase = 0; phrase < 8; phrase++) {
          const bars = generatePhrase(mode, seed, phrase);
          expect(bars).toHaveLength(info.bars);
          for (const bar of bars) {
            for (const n of bar) {
              expect(inScale(info.root, n.midi), `${mode} ${seed}/${phrase}: midi ${n.midi}`).toBe(true);
              expect(n.midi).toBeGreaterThanOrEqual(36);
              expect(n.midi).toBeLessThanOrEqual(96);
              expect(n.beat).toBeGreaterThanOrEqual(0);
              expect(n.beat).toBeLessThan(info.beats);
              expect(n.dur).toBeGreaterThan(0);
              expect(n.vel).toBeGreaterThan(0);
              expect(n.vel).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it("every phrase ends on the tonic, so the loop resolves", () => {
    for (const mode of MODE_LIST) {
      const info = MODES[mode];
      for (let phrase = 0; phrase < 8; phrase++) {
        const bars = generatePhrase(mode, 2024, phrase);
        const melody = bars[bars.length - 1]!.filter((n) => n.voice === "melody");
        expect(melody.length).toBeGreaterThan(0);
        expect((melody[melody.length - 1]!.midi - info.root + 120) % 12).toBe(0);
      }
    }
  });

  it("the waltz has an oom-pah-pah: a bass on one and chords on two and three", () => {
    const bar = generatePhrase("menu", 5, 0)[0]!;
    expect(bar.filter((n) => n.voice === "bass").map((n) => n.beat)).toEqual([0]);
    expect([...new Set(bar.filter((n) => n.voice === "chord").map((n) => n.beat))].sort()).toEqual([1, 2]);
    expect(MODES.menu.beats).toBe(3);
  });

  it("the field version is calmer than the menu: slower, and sparser in melody", () => {
    expect(MODES.game.bpm).toBeLessThan(MODES.menu.bpm);
    const count = (mode: MusicMode): number => {
      let n = 0;
      for (let p = 0; p < 8; p++) for (const bar of generatePhrase(mode, 9, p)) n += bar.filter((x) => x.voice === "melody").length;
      return n;
    };
    expect(count("game")).toBeLessThan(count("menu"));
  });

  it("scale helpers: octaves wrap and negative indices go below", () => {
    expect(scaleMidi(60, 0)).toBe(60);
    expect(scaleMidi(60, 7)).toBe(72);
    expect(scaleMidi(60, -1)).toBe(59);
    expect(scaleMidi(60, 2)).toBe(64);
    expect(beatSeconds("menu")).toBeCloseTo(60 / 104, 6);
    expect(inScale(60, 61)).toBe(false);
  });
});
