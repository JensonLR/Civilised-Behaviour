import { describe, expect, it } from "vitest";
import { CollisionWorld, OUTPOST_STAGES, type RegionDress } from "@cb/shared";
import { boardLetteringGeometry, outpostBoards } from "./outpostSigns.ts";

/** The outpost's boards, lettered: the foundation's board carries the post's name and stage at every stage; the Syndicate's its pitch, at Kessar only. */
const world = new CollisionWorld({ height: () => 0 }, [], 400);
const dress = (over: Partial<RegionDress> = {}): RegionDress => ({ outpost: "camp", rivalPost: 0, road: 0, telegraph: false, launch: false, name: "Small Mercy", ...over });

describe("the outpost's boards", () => {
  it("the foundation's board names the post and says what it is now, at every stage", () => {
    for (const stage of OUTPOST_STAGES) {
      const b = outpostBoards(world, dress({ outpost: stage }), "highmark");
      expect(b.length, stage).toBe(1);
      expect(b[0]!.text).toMatch(/^Small Mercy\. /);
      expect(b[0]!.y).toBeCloseTo(1.4, 6); // (on its pole, as outpost.ts sets the plank)
    }
    expect(outpostBoards(world, dress({ outpost: "trading_post" }), "kessar")[0]!.text).toBe("Small Mercy. Trading Post");
    expect(outpostBoards(world, dress({ name: "   " }), "kessar")[0]!.text).not.toMatch(/^\s*\./); // (a blank name falls back to a real one)
  });

  it("the Syndicate's board is lettered only where its post stands (Kessar, once it has one)", () => {
    expect(outpostBoards(world, dress({ rivalPost: 1 }), "kessar").map((b) => b.text)).toContainEqual(expect.stringMatching(/Syndicate/));
    expect(outpostBoards(world, dress({ rivalPost: 0 }), "kessar").length).toBe(1);
    expect(outpostBoards(world, dress({ rivalPost: 2 }), "vesper").length).toBe(1);
  });

  it("each board has a decal on both faces, a hair proud of the paint, within the board; the back one runs the other way so it reads from behind", () => {
    const boards = outpostBoards(world, dress({ rivalPost: 1 }), "kessar");
    const g = boardLetteringGeometry(boards)!;
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    const uv = g.attributes.uv!;
    expect(pos.count).toBe(boards.length * 2 * 6);
    for (let i = 0; i < pos.count; i++) {
      const b = boards[Math.floor(i / 12)]!;
      const side = nor.getZ(i);
      expect(Math.abs(pos.getZ(i) - (b.z + side * (b.depth / 2 + 0.004)))).toBeLessThan(1e-5);
      expect(Math.abs(pos.getX(i) - b.x)).toBeLessThanOrEqual(b.w / 2);
      expect(Math.abs(pos.getY(i) - b.y)).toBeLessThanOrEqual(b.h / 2);
      // the text's start (u = 0) is to the reader's left: west seen from the north face... and east seen from the south
      if (uv.getX(i) === 0) expect(Math.sign(b.x - pos.getX(i))).toBe(side);
    }
    expect(boardLetteringGeometry([])).toBeUndefined();
  });
});
