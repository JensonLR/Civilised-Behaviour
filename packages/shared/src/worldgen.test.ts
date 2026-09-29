import { describe, expect, it } from "vitest";
import { CAMP, campObstacles, inCampFootprint, insideObstacle } from "./camp.ts";
import { createArena, spawnPoint, ARENA_RADIUS } from "./arena.ts";
import { chroma, PALETTE } from "./palette.ts";
import { MAX_PLAYERS } from "./constants.ts";
import { classifyObstacle, coverDensity, groundColour, inMeadow, treeSpecies, type Rgb } from "./worldgen.ts";
import { scatterProps } from "./props.ts";
import { createTerrain } from "./terrain.ts";
import type { Obstacle } from "./collision.ts";

const hex = (c: Rgb): number => (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
const footprint = (o: Obstacle): number => (o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz));

describe("tree species", () => {
  it("is a pure function of position, and both species stand in the arena in real groves", () => {
    expect(treeSpecies(12.3, -40.1)).toBe(treeSpecies(12.3, -40.1));
    const w = createArena(7);
    const kinds = w.obstacles.filter((o) => classifyObstacle(o) === "tree").map((o) => treeSpecies(o.x, o.z));
    expect(kinds.filter((k) => k === "broadleaf").length).toBeGreaterThan(5);
    expect(kinds.filter((k) => k === "acacia").length).toBeGreaterThan(5);
  });

  it("groves are mostly one species: neighbours agree far more often than chance", () => {
    let agree = 0;
    let pairs = 0;
    for (let x = -80; x <= 80; x += 6) {
      for (let z = -80; z <= 80; z += 6) {
        pairs++;
        if (treeSpecies(x, z) === treeSpecies(x + 3, z + 3)) agree++;
      }
    }
    expect(agree / pairs).toBeGreaterThan(0.68); // 14% strays on each side bound this near 0.76; independent species would give 0.5
  });
});

describe("painted ground", () => {
  it("is finite, inside 0..1 and as muted as the palette allows (chroma <= 0.4) everywhere, whatever the height and slope", () => {
    const out: Rgb = { r: 0, g: 0, b: 0 };
    for (let x = -120; x <= 120; x += 7.3) {
      for (let z = -120; z <= 120; z += 7.3) {
        for (const [h, s] of [[-4, 0], [0, 0], [2, 0.3], [5, 0.9], [1, 2]] as const) {
          groundColour(x, z, h, s, out);
          for (const v of [out.r, out.g, out.b]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          expect(chroma(hex(out)), `${x},${z},${h},${s}`).toBeLessThanOrEqual(0.4);
        }
      }
    }
  });

  it("reads as the intended places: worn earth in the camp, ash at the hearth, dry gold on rises, deep green in hollows, grey on cliffs", () => {
    const at = (x: number, z: number, h = 0, s = 0): Rgb => groundColour(x, z, h, s, { r: 0, g: 0, b: 0 });
    const warm = (c: Rgb): number => c.r - c.b; // earth is warmer than grass
    const camp = at(-1, 4);
    const meadow = at(60, 30);
    expect(warm(camp)).toBeGreaterThan(warm(meadow));
    const hearth = at(CAMP.fire.x, CAMP.fire.z);
    expect(hearth.r + hearth.g + hearth.b).toBeLessThan(camp.r + camp.g + camp.b + 0.2);
    // same place, different height: a rise is lighter/yellower than a hollow
    const rise = at(50, 50, 3.5);
    const hollow = at(50, 50, -2);
    expect(rise.r).toBeGreaterThan(hollow.r);
    // steep is greyer (less saturated) than flat
    const flat = at(50, 50, 0, 0);
    const cliff = at(50, 50, 0, 1.2);
    expect(Math.max(cliff.r, cliff.g, cliff.b) - Math.min(cliff.r, cliff.g, cliff.b)).toBeLessThan(Math.max(flat.r, flat.g, flat.b) - Math.min(flat.r, flat.g, flat.b));
  });

  it("ground cover grows in the meadow, not on the trampled camp, the hearth or cliffs", () => {
    expect(coverDensity(CAMP.fire.x, CAMP.fire.z, 0)).toBe(0);
    expect(coverDensity(0, 0, 0)).toBeLessThan(0.1);
    expect(coverDensity(60, 30, 1.5)).toBe(0);
    expect(coverDensity(60, 30, 0)).toBeGreaterThan(0.9);
    for (let x = -90; x <= 90; x += 9) for (let z = -90; z <= 90; z += 9) {
      const d = coverDensity(x, z, 0.1);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
    expect(typeof inMeadow(3, 4)).toBe("boolean");
    void PALETTE;
  });
});

describe("the arena and the camp", () => {
  it("is deterministic: same seed, same obstacles; another seed, different dressing", () => {
    expect(JSON.stringify(createArena(5).obstacles)).toBe(JSON.stringify(createArena(5).obstacles));
    expect(JSON.stringify(createArena(5).obstacles)).not.toBe(JSON.stringify(createArena(6).obstacles));
    // the authored camp is the same in every seed (up to the terrain height under it)
    const pos = (seed: number) => createArena(seed).obstacles.filter((o) => classifyObstacle(o) === "tent").map((o) => [o.x, o.z]);
    expect(pos(1)).toEqual(pos(2));
  });

  it("every obstacle is tagged, and the tag agrees with the original height contract for trees and rocks", () => {
    for (const seed of [1, 7, 42]) {
      for (const o of createArena(seed).obstacles) {
        expect(o.tag, `${o.kind} at ${o.x},${o.z}`).toBeDefined();
        if (o.kind === "circle" && (o.tag === "tree" || o.tag === "snag")) expect(o.y1 - o.y0).toBeGreaterThanOrEqual(5);
        if (o.kind === "circle" && o.tag === "rock") expect(o.y1 - o.y0).toBeLessThan(5);
      }
    }
    // untagged obstacles still classify by the old contract
    expect(classifyObstacle({ kind: "circle", x: 0, z: 0, r: 1, y0: 0, y1: 7 })).toBe("tree");
    expect(classifyObstacle({ kind: "circle", x: 0, z: 0, r: 1, y0: 0, y1: 2 })).toBe("rock");
  });

  it("has the landmarks: two tents, a fire, a flag, a signpost, luggage, a cart, the wall and both crates", () => {
    const tags = createArena(3).obstacles.map((o) => o.tag);
    const count = (t: string): number => tags.filter((x) => x === t).length;
    expect(count("tent")).toBe(2);
    for (const t of ["fire", "flag", "sign", "luggage", "cart", "wall"]) expect(count(t), t).toBe(1);
    expect(count("crate")).toBe(2);
  });

  it("nothing is built on a player's spawn, camp pieces do not overlap each other, and nothing else grows in the camp", () => {
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      const w = createArena(seed);
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        const sp = spawnPoint(slot, MAX_PLAYERS);
        for (const o of w.obstacles) expect(insideObstacle(o, sp.x, sp.z, 0.6), `seed ${seed} slot ${slot} vs ${o.tag}`).toBe(false);
      }
      const camp = w.obstacles.filter((o) => ["tent", "fire", "flag", "sign", "luggage", "cart", "crate", "wall", "table", "scope", "pole", "hammock"].includes(o.tag!));
      for (let i = 0; i < camp.length; i++) {
        for (let j = i + 1; j < camp.length; j++) {
          const a = camp[i]!;
          const b = camp[j]!;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.tag}/${b.tag}`).toBeGreaterThan(footprint(a) * 0.6 + footprint(b) * 0.6);
        }
      }
      for (const o of w.obstacles) {
        if (camp.includes(o)) continue;
        expect(Math.hypot(o.x, o.z) - footprint(o), `${o.tag} at ${o.x},${o.z}`).toBeGreaterThan(14);
      }
    }
  });

  it("the camp sits in the flat spawn clearing (radius 14) and inside the arena", () => {
    for (const o of campObstacles(createTerrain(1))) {
      const corners: [number, number][] = o.kind === "circle" ? [[o.r, 0], [-o.r, 0], [0, o.r], [0, -o.r]] : [[o.hx, o.hz], [-o.hx, o.hz], [o.hx, -o.hz], [-o.hx, -o.hz]];
      for (const [cx, cz] of corners) {
        const c = o.kind === "box" ? Math.cos(o.yaw) : 1;
        const s = o.kind === "box" ? Math.sin(o.yaw) : 0;
        expect(Math.hypot(o.x + cx * c - cz * s, o.z + cx * s + cz * c), o.tag).toBeLessThanOrEqual(14);
      }
    }
    for (const o of createArena(1).obstacles) expect(Math.hypot(o.x, o.z)).toBeLessThan(ARENA_RADIUS);
  });

  it("scattered props never spawn inside a landmark, and the count is honoured", () => {
    for (const seed of [1, 2, 3, 7, 99, 4242]) {
      const t = createTerrain(seed);
      const props = scatterProps(seed, t, 14);
      expect(props.length).toBe(14);
      for (const p of props) expect(inCampFootprint(p.x, p.z, 0.5), `seed ${seed} ${p.x},${p.z}`).toBe(false);
    }
  });
});
