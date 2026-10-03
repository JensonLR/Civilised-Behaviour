import { describe, expect, it } from "vitest";
import { COMMAND_IDS, FLAG, NPC } from "@cb/shared";
import { PlateCache, RAY_SPREAD, RAY_TTL_S, type PlateRow } from "./plates.ts";

const HANDS: ReadonlySet<number> = new Set([NPC.PORTER, NPC.HIRED_RIFLE, NPC.SURGEON]);
const row = (over: Partial<PlateRow> = {}): PlateRow => ({ name: "Hobbs", connected: true, flags: 0, npc: 0, cmd: 255, morale: 80, ...over });

describe("plate text: rebuilt only when something it shows changes", () => {
  it("is the same string object until (name, connected, down, order, nerve band) changes", () => {
    const c = new PlateCache(HANDS);
    const hand = row({ name: "Pike", npc: NPC.HIRED_RIFLE, cmd: 0, morale: 90 });
    c.beginFrame();
    const a = c.text("h", hand);
    expect(a).toBe(`Pike · ${COMMAND_IDS[0]} · ${a.split(" · ")[2]}`);
    for (let i = 0; i < 50; i++) {
      c.beginFrame();
      expect(c.text("h", hand)).toBe(a);
    }
    c.beginFrame();
    hand.morale = 89; // inside the same band: no rebuild (and the same text)
    expect(c.text("h", hand)).toBe(a);
    hand.morale = 5; // a different band
    expect(c.text("h", hand)).not.toBe(a);
    hand.cmd = 1;
    expect(c.text("h", hand)).toContain(COMMAND_IDS[1]!);
    hand.cmd = 255; // no order: "follow"
    expect(c.text("h", hand)).toContain("follow");
    hand.flags = FLAG.DOWNED;
    expect(c.text("h", hand)).toBe("Pike ✚ DOWN");
    hand.flags = 0;
    hand.connected = false;
    expect(c.text("h", hand)).toContain("(reconnecting)");
  });

  it("matches the old inline rule for a human, a downed hand and a soldier", () => {
    const c = new PlateCache(HANDS);
    c.beginFrame();
    expect(c.text("p", row({ name: "Ada" }))).toBe("Ada");
    expect(c.text("p2", row({ name: "Bea", connected: false, flags: FLAG.DOWNED }))).toBe("Bea (reconnecting) ✚ DOWN");
    expect(c.text("s", row({ name: "Sentry 1", npc: NPC.SENTRY }))).toBe("Sentry 1");
  });
});

describe("the sight ray: cached per NPC for 0.15 s and spread across frames", () => {
  const frames = (npcs: number, count: number, dt = 1 / 60): { perFrame: number[]; total: number } => {
    const c = new PlateCache(HANDS);
    let now = 0;
    let rays = 0;
    const perFrame: number[] = [];
    for (let f = 0; f < count; f++) {
      now += dt;
      c.beginFrame();
      const before = rays;
      for (let i = 0; i < npcs; i++) {
        const id = `npc:${i}`;
        c.text(id, row({ name: `N${i}`, npc: NPC.SENTRY }));
        if (c.due(id, now)) {
          rays++;
          c.report(id, i % 2 === 0);
        }
      }
      c.endFrame();
      perFrame.push(rays - before);
    }
    return { perFrame, total: rays };
  };

  it("12 NPCs over 120 frames: never more than ceil(12 / 9) = 2 rays in a frame, and each NPC is re-checked about every 0.15 s", () => {
    const { perFrame, total } = frames(12, 120);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(Math.ceil(12 / RAY_SPREAD));
    // 2 s of frames, 12 NPCs, a ray per 0.15 s each: about 160; the old code cast 12 x 120 = 1440
    expect(total).toBeLessThan(12 * (2 / RAY_TTL_S) + 24);
    expect(total).toBeGreaterThan(12 * 8); // and they ARE re-checked, not frozen
  });

  it("every NPC gets a first answer within a handful of frames; before that a plate assumes no sight", () => {
    const c = new PlateCache(HANDS);
    let now = 0;
    const first = new Map<string, number>();
    for (let f = 0; f < 30; f++) {
      now += 1 / 60;
      c.beginFrame();
      for (let i = 0; i < 12; i++) {
        const id = `n${i}`;
        c.text(id, row({ npc: NPC.SENTRY }));
        if (f === 0) expect(c.sight(id)).toBe(false);
        if (c.due(id, now)) {
          c.report(id, true);
          if (!first.has(id)) first.set(id, f);
        }
      }
    }
    expect(first.size).toBe(12);
    expect(Math.max(...first.values())).toBeLessThanOrEqual(12);
  });

  it("an actor that leaves has its entry forgotten once the crowd thins", () => {
    const c = new PlateCache(HANDS);
    c.beginFrame();
    for (let i = 0; i < 200; i++) c.text(`a${i}`, row());
    c.endFrame();
    expect(c.size).toBe(200);
    c.beginFrame();
    c.text("a0", row());
    c.endFrame();
    expect(c.size).toBe(1);
  });
});

describe("only the party's own hands carry orders and nerve (D-048)", () => {
  it("a man of a hand's role who is not on the roster (the post's watch) has a plain plate; a hand on it keeps the order and band; a changed roster takes effect", () => {
    const c = new PlateCache(HANDS);
    c.setRoster(["hand-1"]);
    const watch = row({ name: "Watchman Abel Crouch (Society pensioner)", npc: NPC.HIRED_RIFLE, cmd: 255, morale: 0 });
    const hand = row({ name: "Pike", npc: NPC.HIRED_RIFLE, cmd: 255, morale: 90 });
    c.beginFrame();
    expect(c.text("npc:watch-0", watch)).toBe("Watchman Abel Crouch (Society pensioner)");
    expect(c.text("npc:hand-1", hand)).toContain("· follow ·");
    c.setRoster(["hand-1", "watch-0"]);
    c.beginFrame();
    expect(c.text("npc:watch-0", watch)).toContain("· follow ·");
    c.setRoster([]);
    c.beginFrame();
    expect(c.text("npc:hand-1", hand)).toBe("Pike");
  });
});
