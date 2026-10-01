import { describe, expect, it } from "vitest";
import { REGION_IDS } from "@cb/shared";
import { LAYER_RATE, LAYER_TARGET, MUSIC_LAYERS, MUSIC_MOODS, MUSIC_TUNING, REGION_COLOUR, newMusicState, newSignals, stepMusic, threatOf, type MusicSignals, type MusicState } from "./musicLayers.ts";

/** The music driver: calm -> tension -> combat -> aftermath -> calm, with hysteresis; the jolly bed never stops; frozen holds; parley ducks. */

const run = (st: MusicState, sig: MusicSignals, seconds: number, dt = 1 / 30): void => {
  for (let t = 0; t < seconds; t += dt) stepMusic(st, sig, dt);
};

describe("the tables", () => {
  it("every mood sets every layer, within 0..1, and the jolly bed never goes silent", () => {
    for (const m of MUSIC_MOODS) {
      for (const l of MUSIC_LAYERS) {
        expect(LAYER_TARGET[m][l]).toBeGreaterThanOrEqual(0);
        expect(LAYER_TARGET[m][l]).toBeLessThanOrEqual(1);
      }
      expect(LAYER_TARGET[m].bed, `${m}: the bed keeps playing`).toBeGreaterThan(0);
    }
    for (const l of MUSIC_LAYERS) expect(LAYER_RATE[l].attack).toBeGreaterThan(0);
  });
  it("combat is louder in drums than calm, aftermath is the only mood with the dirge", () => {
    expect(LAYER_TARGET.combat.drive).toBeGreaterThan(LAYER_TARGET.calm.drive);
    for (const m of MUSIC_MOODS) expect(LAYER_TARGET[m].dirge > 0.5).toBe(m === "aftermath");
  });
  it("the aftermath is the quiet, dark mood: the dirge carries it, the drums and stabs are out, the colour is thinner than in the calm", () => {
    const a = LAYER_TARGET.aftermath;
    expect(a.dirge).toBe(1);
    expect(a.drive + a.stabs + a.pulse).toBe(0);
    expect(a.colour).toBeLessThan(LAYER_TARGET.calm.colour);
    expect(a.bed).toBeLessThan(LAYER_TARGET.tension.bed);
  });
  it("combat keeps the jolly bed under the drums (thinner, never gone), and tension adds the pulse and the drone before any drum", () => {
    expect(LAYER_TARGET.combat.bed).toBeGreaterThan(0.2);
    expect(LAYER_TARGET.combat.drive + LAYER_TARGET.combat.stabs).toBeGreaterThan(1.5);
    expect(LAYER_TARGET.tension.drive).toBe(0);
    expect(LAYER_TARGET.tension.pulse + LAYER_TARGET.tension.dread).toBeGreaterThan(1);
  });
  it("every region has a colour", () => {
    for (const r of REGION_IDS) expect(REGION_COLOUR[r].instrument.length).toBeGreaterThan(3);
  });
});

describe("the driver", () => {
  it("stays calm on a quiet field and the layer gains sit at the calm targets", () => {
    const st = newMusicState();
    run(st, newSignals(), 30);
    expect(st.mood).toBe("calm");
    for (const l of MUSIC_LAYERS) expect(st.gain[l]).toBeCloseTo(LAYER_TARGET.calm[l], 3);
  });
  it("a sustained threat raises tension; a flicker does not", () => {
    const st = newMusicState();
    const sig = { ...newSignals(), hostilesAware: 3 };
    run(st, sig, 0.5);
    run(st, newSignals(), 5);
    expect(st.mood).toBe("calm");
    run(st, sig, MUSIC_TUNING.riseSeconds + 1);
    expect(st.mood).toBe("tension");
    expect(st.gain.pulse).toBeGreaterThan(0.2);
  });
  it("shots start combat at once and hold it for the minimum; drums arrive within a second or two", () => {
    const st = newMusicState();
    stepMusic(st, { ...newSignals(), shotsHeard: 2 }, 1 / 30);
    expect(st.mood).toBe("combat");
    run(st, newSignals(), MUSIC_TUNING.minCombat - 1);
    expect(st.mood).toBe("combat");
    const st2 = newMusicState();
    run(st2, { ...newSignals(), shotsHeard: 2 }, 2);
    expect(st2.gain.drive).toBeGreaterThan(0.9);
    expect(st2.gain.bed).toBeGreaterThanOrEqual(LAYER_TARGET.combat.bed); // the bed fights on, thinner
    const st3 = newMusicState();
    run(st3, { ...newSignals(), shotsHeard: 2 }, 0.4);
    expect(st3.gain.bed).toBeGreaterThan(LAYER_TARGET.combat.bed); // it eases down, it does not cut
  });
  it("a fight that cost someone ends in the aftermath, which lasts and then gives way to calm", () => {
    const st = newMusicState();
    run(st, { ...newSignals(), shotsHeard: 3, hostilesNear: 2, deathsNear: 1 }, 10);
    expect(st.mood).toBe("combat");
    run(st, { ...newSignals(), deathsNear: 1 }, MUSIC_TUNING.quietSeconds + 1);
    expect(st.mood).toBe("aftermath");
    run(st, newSignals(), MUSIC_TUNING.aftermathMin - 4);
    expect(st.mood).toBe("aftermath");
    expect(st.gain.dirge).toBeGreaterThan(0.5);
    run(st, newSignals(), 12);
    expect(st.mood).toBe("calm");
  });
  it("a fight that cost nobody goes straight back to calm, and never through the aftermath", () => {
    const st = newMusicState();
    const seen = new Set<string>();
    const sig = { ...newSignals(), shotsHeard: 1 };
    for (let t = 0; t < 8; t += 1 / 30) {
      stepMusic(st, sig, 1 / 30);
      seen.add(st.mood);
    }
    for (let t = 0; t < 40; t += 1 / 30) {
      stepMusic(st, newSignals(), 1 / 30);
      seen.add(st.mood);
    }
    expect(st.mood).toBe("calm");
    expect(seen.has("aftermath")).toBe(false);
  });
  it("renewed shooting in the aftermath returns to combat; someone still down keeps the aftermath", () => {
    const st = newMusicState();
    run(st, { ...newSignals(), shotsHeard: 3, deathsNear: 1 }, 10);
    run(st, { ...newSignals(), deathsNear: 1 }, 8);
    expect(st.mood).toBe("aftermath");
    run(st, { ...newSignals(), alliesDowned: 1 }, 60);
    expect(st.mood).toBe("aftermath");
    run(st, { ...newSignals(), shotsHeard: 1 }, 1);
    expect(st.mood).toBe("combat");
  });
  it("does not flap: across a noisy 5 minute fight the mood changes only a handful of times", () => {
    const st = newMusicState();
    let changes = 0;
    let prev = st.mood;
    for (let i = 0; i < 30 * 300; i++) {
      const t = i / 30;
      const sig = { ...newSignals(), shotsHeard: Math.sin(t * 1.7) > 0.4 ? 1 : 0, hostilesNear: Math.sin(t * 0.9) > 0 ? 1 : 0, deathsNear: Math.floor(t / 40) % 2 };
      stepMusic(st, sig, 1 / 30);
      if (st.mood !== prev) changes++;
      prev = st.mood;
    }
    expect(changes).toBeLessThan(40);
  });
  it("frozen holds every gain and the mood; a parley ducks everything to half without changing the mood", () => {
    const st = newMusicState();
    run(st, { ...newSignals(), shotsHeard: 1 }, 4);
    const snap = JSON.stringify(st);
    run(st, { ...newSignals(), frozen: true }, 10);
    expect(JSON.stringify(st)).toBe(snap);
    run(st, { ...newSignals(), shotsHeard: 1, parley: true }, 3);
    expect(st.mood).toBe("combat");
    expect(st.parleyDuck).toBeCloseTo(MUSIC_TUNING.duckTo, 1);
    run(st, { ...newSignals(), shotsHeard: 1 }, 3);
    expect(st.parleyDuck).toBeGreaterThan(0.95);
  });
  it("threat is monotone in what the signals say and capped at 1", () => {
    const base = threatOf(newSignals());
    expect(base).toBe(0);
    expect(threatOf({ ...newSignals(), hostilesAware: 3 })).toBeGreaterThan(base);
    expect(threatOf({ ...newSignals(), hostilesAware: 3, hostilesNear: 2, shotsHeard: 4, scenario: "clash", selfDowned: true })).toBe(1);
    expect(threatOf({ ...newSignals(), scenario: "clash" })).toBeGreaterThan(threatOf({ ...newSignals(), scenario: "brewing" }));
  });
  it("a zero or negative step changes nothing", () => {
    const st = newMusicState();
    const snap = JSON.stringify(st);
    stepMusic(st, { ...newSignals(), shotsHeard: 5 }, 0);
    stepMusic(st, { ...newSignals(), shotsHeard: 5 }, -1);
    expect(JSON.stringify(st)).toBe(snap);
  });
});
