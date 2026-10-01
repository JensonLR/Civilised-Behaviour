import type { RegionId } from "@cb/shared";

/**
 * THE MUSIC LAYER CONTRACT (D-038, docs/_notes/polish2.md section 6). The jolly theme stays: the player likes it, and a bright march over a bloody field is the game's tone. What was
 * missing is GRIT, so the score becomes layered stems (all synthesised through the existing engine, no assets) that a state driver fades in and out from what the server says is
 * happening. The comic rule: the jolly bed never fully stops. In a fight it is still playing, thinner and darker, underneath the drums.
 *
 * This file is the NAMES and the PURE DRIVER. Package A owns it from here: it writes the stem generators (musicScore.ts / music.ts), the per-region colour, the one-shots and the mix, and
 * may retune every number below; it must keep the exported names, the four moods, the seven layer ids and `stepMusic`'s signature (the integrator wires `MusicSignals` from the session).
 */

/** What the score is doing. Four states; the driver moves between them with hysteresis (nothing flaps). */
export type MusicMood = "calm" | "tension" | "combat" | "aftermath";
export const MUSIC_MOODS: readonly MusicMood[] = ["calm", "tension", "combat", "aftermath"];

/**
 * The stems, each a looping generative voice-group on the same clock and key as the bed, so any combination is in tune and in time:
 *  bed      the existing jolly game bed (bell melody, bass, pad, arp)
 *  pulse    a soft ticking ostinato and a muted heartbeat (tension)
 *  dread    a low bowed drone with a close dissonance (tension, and under combat)
 *  drive    war drums and a driving bass (combat)
 *  stabs    reed and brass stabs, one a bar (combat accents; the "march" turned nasty)
 *  dirge    a slow minor pad and a lone slow line (aftermath)
 *  colour   the region's own instrument, quiet, always on (see REGION_COLOUR)
 */
export const MUSIC_LAYERS = ["bed", "pulse", "dread", "drive", "stabs", "dirge", "colour"] as const;
export type MusicLayerId = (typeof MUSIC_LAYERS)[number];

/** Target gain (0..1) of each layer in each mood. The driver eases the live gains toward these. */
export const LAYER_TARGET: Readonly<Record<MusicMood, Readonly<Record<MusicLayerId, number>>>> = {
  calm: { bed: 1, pulse: 0, dread: 0, drive: 0, stabs: 0, dirge: 0, colour: 0.45 },
  tension: { bed: 0.55, pulse: 0.8, dread: 0.55, drive: 0, stabs: 0, dirge: 0, colour: 0.55 },
  combat: { bed: 0.28, pulse: 0.35, dread: 0.5, drive: 1, stabs: 0.8, dirge: 0, colour: 0.4 },
  aftermath: { bed: 0.12, pulse: 0, dread: 0.2, drive: 0, stabs: 0, dirge: 1, colour: 0.3 },
};

/** Seconds a layer takes to go from 0 to 1 (attack) and from 1 to 0 (release): drums arrive fast and leave slowly, the dirge arrives slowly. */
export const LAYER_RATE: Readonly<Record<MusicLayerId, { attack: number; release: number }>> = {
  bed: { attack: 3, release: 1.5 }, pulse: { attack: 2, release: 4 }, dread: { attack: 3, release: 5 }, drive: { attack: 0.8, release: 5 }, stabs: { attack: 0.6, release: 3 },
  dirge: { attack: 4, release: 6 }, colour: { attack: 3, release: 3 },
};

/** The region's colour: which instrument carries its stem and the scale it favours (the bed stays major so the jolliness survives). Package A builds the instruments. */
export const REGION_COLOUR: Readonly<Record<RegionId, { instrument: string; scale: "major" | "mixolydian" | "dorian" | "minor-pentatonic"; note: string }>> = {
  hollowmere: { instrument: "music-box-and-fiddle", scale: "major", note: "the depot's parlour: a bright fiddle over the music box" },
  kessar: { instrument: "reed-pipe-and-lamp-bells", scale: "dorian", note: "a thin reed pipe and the nine lamps ringing on their chains" },
  highmark: { instrument: "lyre-and-herd-bells", scale: "mixolydian", note: "a plucked lyre over wooden herd-bells, ceremonial and unhurried" },
  vesper: { instrument: "bowed-saw-and-copper-chimes", scale: "minor-pentatonic", note: "a bowed saw and copper chimes, funerary and dry" },
  saltmarket: { instrument: "squeeze-reed-and-bottle-blows", scale: "mixolydian", note: "a wheezing reed organ and blown bottles, the tide-tally's waltz" },
};

/** The scenario's coarse stage as the music sees it (derived by the integrator from the scenario state: briefing and "waiting" are `idle`). */
export type MusicScenarioStage = "idle" | "brewing" | "standoff" | "clash" | "resolved";

/**
 * What the music reads from the server's state, one record per frame (the integrator fills it from the session's rows; every field is a plain number or flag so it is cheap and pure).
 * Distances are metres from the LOCAL player.
 */
export interface MusicSignals {
  region: RegionId;
  /** In a sailing card, a sheet that owns the screen, or the menu: stems hold their gains (no mood change). */
  frozen: boolean;
  /** Hostile NPC rows aware of the party (mode alert/advance/fire/cover/flank) within 50 m, and those within 20 m. */
  hostilesAware: number;
  hostilesNear: number;
  /** Shots heard (any shooter, any side) within 60 m during the last 4 s. */
  shotsHeard: number;
  /** The local player is downed, and how many other party members are. */
  selfDowned: boolean;
  alliesDowned: number;
  /** Deaths (a body that went down for good, NPC or party) within 60 m in the last 20 s. */
  deathsNear: number;
  scenario: MusicScenarioStage;
  /** A parley or audience sheet is open: everything ducks (the talk is the scene) but the mood does not change. */
  parley: boolean;
}

export const newSignals = (region: RegionId = "hollowmere"): MusicSignals => ({
  region, frozen: false, hostilesAware: 0, hostilesNear: 0, shotsHeard: 0, selfDowned: false, alliesDowned: 0, deathsNear: 0, scenario: "idle", parley: false,
});

export interface MusicState {
  mood: MusicMood;
  /** Seconds in the current mood. */
  since: number;
  /** Live gain of each layer 0..1 (the mixer applies these; `parleyDuck` is applied on top). */
  gain: Record<MusicLayerId, number>;
  /** 0..1: smoothed threat, for anything that wants a continuous value (a filter's cutoff, the colour stem's tempo). */
  threat: number;
  /** Seconds of "nothing is fighting" accumulated in combat; and the aftermath's remaining minimum. */
  quiet: number;
  aftermathLeft: number;
  /** Seconds the threat has been above the tension line while calm. */
  rising: number;
  /** 0..1 multiplier the mixer puts on every layer while a parley is open (eases to 0.5). */
  parleyDuck: number;
}

export const newMusicState = (): MusicState => ({
  mood: "calm", since: 0, gain: { bed: 1, pulse: 0, dread: 0, drive: 0, stabs: 0, dirge: 0, colour: 0.45 }, threat: 0, quiet: 0, aftermathLeft: 0, rising: 0, parleyDuck: 1,
});

/** The driver's thresholds (seconds and scores). Package A tunes these by ear. */
export const MUSIC_TUNING = {
  /** A threat above this for `riseSeconds` moves calm -> tension. */
  tensionAt: 0.25,
  riseSeconds: 1.5,
  /** Combat starts the moment shots are heard near, or hostiles are within 20 m, or the scenario clashes. */
  /** Least time in each mood before it may change (aftermath's is `aftermathMin`). Combat may always re-enter instantly. */
  minTension: 4,
  minCombat: 8,
  /** Combat ends after this many quiet seconds. */
  quietSeconds: 6,
  /** Aftermath lasts at least this long after a fight that cost someone; longer while anyone in the party is still down. */
  aftermathMin: 22,
  /** Calm after a fight nobody lost anything in: straight back after this. */
  noLossSeconds: 8,
  threatRate: 0.9,
  duckTo: 0.5,
} as const;

/** The instantaneous 0..1 threat the signals describe. */
export function threatOf(s: MusicSignals): number {
  const stage = s.scenario === "clash" ? 1 : s.scenario === "standoff" ? 0.55 : s.scenario === "brewing" ? 0.28 : 0;
  const t = 0.3 * Math.min(1, s.hostilesAware / 3) + 0.4 * Math.min(1, s.hostilesNear / 2) + (s.shotsHeard > 0 ? 0.5 : 0) + stage * 0.5 + (s.selfDowned ? 0.25 : 0) + (s.alliesDowned > 0 ? 0.15 : 0);
  return t > 1 ? 1 : t;
}

/** True while something is actively fighting near the player (the thing combat is made of). */
export const fighting = (s: MusicSignals): boolean => s.shotsHeard > 0 || s.hostilesNear > 0 || s.scenario === "clash";

/**
 * One frame of the driver. Mutates `st` (allocation-free). Hysteresis: tension needs a sustained threat, combat is instant but held for `minCombat`, leaving combat needs `quietSeconds` of quiet,
 * a fight that cost somebody (a death, a downing) hands over to the aftermath for `aftermathMin` seconds (and while anyone in the party is down), a fight that cost nothing goes straight back
 * to calm. `frozen` holds everything. The layer gains ease toward `LAYER_TARGET[mood]` at `LAYER_RATE`.
 */
export function stepMusic(st: MusicState, sig: MusicSignals, dt: number): void {
  if (!(dt > 0)) return;
  if (sig.frozen) return;
  const T = MUSIC_TUNING;
  const raw = threatOf(sig);
  st.threat += (raw - st.threat) * Math.min(1, dt * T.threatRate * (raw > st.threat ? 3 : 1));
  st.since += dt;
  const fight = fighting(sig);
  const lost = sig.deathsNear > 0 || sig.selfDowned || sig.alliesDowned > 0;
  switch (st.mood) {
    case "calm":
      st.rising = raw >= T.tensionAt ? st.rising + dt : 0;
      if (fight) enter(st, "combat");
      else if (st.rising >= T.riseSeconds) enter(st, "tension");
      break;
    case "tension":
      if (fight) enter(st, "combat");
      else if (st.since >= T.minTension && raw < T.tensionAt * 0.7) enter(st, lost ? "aftermath" : "calm");
      break;
    case "combat":
      st.quiet = fight ? 0 : st.quiet + dt;
      if (lost) st.aftermathLeft = T.aftermathMin; // a loss during the fight arms the aftermath
      if (st.since >= T.minCombat && st.quiet >= T.quietSeconds) enter(st, st.aftermathLeft > 0 || lost ? "aftermath" : "calm");
      break;
    case "aftermath":
      if (fight) enter(st, "combat");
      else {
        st.aftermathLeft = Math.max(st.aftermathLeft - dt, sig.selfDowned || sig.alliesDowned > 0 ? 3 : 0);
        if (st.aftermathLeft <= 0 && st.since >= T.noLossSeconds && raw < T.tensionAt) enter(st, "calm");
      }
      break;
  }
  const target = LAYER_TARGET[st.mood];
  for (const id of MUSIC_LAYERS) {
    const g = st.gain[id];
    const goal = target[id];
    const r = LAYER_RATE[id];
    const step = dt / (goal > g ? r.attack : r.release);
    st.gain[id] = goal > g ? Math.min(goal, g + step) : Math.max(goal, g - step);
  }
  const duck = sig.parley ? T.duckTo : 1;
  st.parleyDuck += (duck - st.parleyDuck) * Math.min(1, dt * 4);
}

function enter(st: MusicState, mood: MusicMood): void {
  if (st.mood === mood) return;
  st.mood = mood;
  st.since = 0;
  st.quiet = 0;
  st.rising = 0;
  if (mood === "aftermath" && st.aftermathLeft <= 0) st.aftermathLeft = MUSIC_TUNING.aftermathMin;
  if (mood !== "aftermath" && mood !== "combat") st.aftermathLeft = 0;
}
