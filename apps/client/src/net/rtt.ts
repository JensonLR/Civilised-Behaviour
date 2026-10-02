/**
 * The debug overlay's round-trip estimate (F3; the perf capture prints it). The first ping of a session goes out before the world is built, and its pong is read only when the main
 * thread comes back, tens of seconds later on a software renderer: that is the page's stall, not the network, and an average seeded with it read "64681 ms" for minutes (D-047).
 * A sample longer than STALL_MS is dropped; the rest are smoothed (the first real one seeds the average).
 */
export const STALL_MS = 5000;

export function smoothRtt(prev: number, sample: number): number {
  if (!Number.isFinite(sample) || sample < 0 || sample > STALL_MS) return prev;
  return prev === 0 ? sample : prev * 0.8 + sample * 0.2;
}
