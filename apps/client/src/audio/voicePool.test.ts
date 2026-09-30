import { describe, expect, it } from "vitest";
import { VoicePool } from "./voicePool.ts";

describe("voice pool", () => {
  it("never holds more voices than it has slots", () => {
    const pool = new VoicePool(4);
    let played = 0;
    for (let i = 0; i < 20; i++) if (pool.acquire(`s${i}`, 1, 8, 0, 10, 0) >= 0) played++;
    expect(played).toBe(20); // equal priority: newcomers steal the oldest, so they all play...
    expect(pool.count(0)).toBe(4); // ...but never more than 4 at once
  });

  it("caps simultaneous voices of one sound: a repeat replaces that sound's oldest voice", () => {
    const pool = new VoicePool(10);
    const slots: number[] = [];
    for (let i = 0; i < 6; i++) slots.push(pool.acquire("footstep", 0, 3, i * 0.1, 5, i * 0.1));
    expect(pool.countOf("footstep", 0.6)).toBe(3);
    // the fourth play took over the first play's slot
    expect(slots[3]).toBe(slots[0]);
    expect(pool.stolen).toBeGreaterThanOrEqual(0);
  });

  it("stealing skips voices that outrank the newcomer, and drops the newcomer if everything does", () => {
    const pool = new VoicePool(2);
    expect(pool.acquire("cannon", 4, 3, 0, 10, 0)).toBeGreaterThanOrEqual(0);
    expect(pool.acquire("explosion", 4, 3, 0, 10, 0)).toBeGreaterThanOrEqual(0);
    expect(pool.acquire("footstep", 0, 4, 0, 1, 0)).toBe(-1); // both slots hold louder priorities
    expect(pool.acquire("musket", 3, 6, 0, 3, 0)).toBe(-1);
    const slot = pool.acquire("bang", 4, 3, 0, 3, 0); // equal priority may take the oldest
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it("cuts the lowest priority first, oldest among equals", () => {
    const pool = new VoicePool(3);
    const a = pool.acquire("a", 2, 4, 0, 10, 0);
    const b = pool.acquire("b", 0, 4, 1, 10, 1);
    pool.acquire("c", 0, 4, 2, 10, 2);
    const d = pool.acquire("d", 1, 4, 3, 10, 3);
    expect(d).toBe(b); // b: lowest priority and older than c
    expect(pool.nameOf(a)).toBe("a");
    expect(pool.stolen).toBe(b);
  });

  it("finished voices free their slots without stealing", () => {
    const pool = new VoicePool(2);
    pool.acquire("a", 1, 4, 0, 1, 0);
    pool.acquire("b", 1, 4, 0, 1, 0);
    expect(pool.count(0.5)).toBe(2);
    expect(pool.count(1.5)).toBe(0);
    const s = pool.acquire("c", 1, 4, 2, 3, 2);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(pool.stolen).toBe(-1);
  });

  it("a loop kept alive can be ended by shortening it", () => {
    const pool = new VoicePool(2);
    const s = pool.acquire("revive", 2, 1, 0, Infinity, 0);
    expect(pool.count(100)).toBe(1);
    pool.setEnd(s, 5);
    expect(pool.count(6)).toBe(0);
    pool.release(s);
    expect(pool.isUsed(s)).toBe(false);
  });
});
