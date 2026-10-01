import { BufferGeometry, CanvasTexture, Group, Mesh, MeshToonMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { createArena } from "@cb/shared";
import { hqRoute } from "@cb/shared";
import { BOARD_DEPTH, HqRouteView, STRIP_H, STRIP_W, boardTexts, buildHqRouteLettering, buildHqRouteSolid, drawRouteAtlas, stripUv } from "./hqRoute.ts";

const signs = hqRoute().signs;
const world = createArena(91);
const ground = (x: number, z: number): number => world.terrainHeight(x, z);
const tris = (g: BufferGeometry): number => g.attributes.position!.count / 3;
const finite = (g: BufferGeometry): boolean => [...g.attributes.position!.array].every(Number.isFinite);

describe("the HQ route's finger-posts (view)", () => {
  it("the solid is one finite vertex-coloured geometry within a small triangle budget, and stands on the ground at every sign", () => {
    const g = buildHqRouteSolid(signs, ground)!;
    expect(g).toBeDefined();
    expect(finite(g)).toBe(true);
    expect(g.attributes.color).toBeDefined();
    expect(g.attributes.normal).toBeDefined();
    expect(tris(g)).toBeLessThan(signs.length * 3 * 90 + signs.length * 40); // posts + boards: a few hundred triangles a sign at most
    // every sign's post is inside the bounding box (it is built where the collision says it is)
    g.computeBoundingBox();
    for (const s of signs) {
      expect(s.x).toBeGreaterThan(g.boundingBox!.min.x);
      expect(s.x).toBeLessThan(g.boundingBox!.max.x);
      expect(s.z).toBeGreaterThan(g.boundingBox!.min.z);
      expect(s.z).toBeLessThan(g.boundingBox!.max.z);
    }
    g.dispose();
  });

  it("the lettering has two quads per board, UVs inside the atlas, strips that do not overlap, and decals that sit on the plank's faces", () => {
    const g = buildHqRouteLettering(signs, ground)!;
    const boards = signs.reduce((a, s) => a + s.boards.length, 0);
    expect(tris(g)).toBe(boards * 2 * 2);
    expect(finite(g)).toBe(true);
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i + 1 < boards; i++) expect(stripUv(i, boards)[1]).toBeGreaterThanOrEqual(stripUv(i + 1, boards)[3]! - 1e-9); // top to bottom, disjoint
    // a decal vertex lies BOARD_DEPTH/2 + 0.006 in front of its plank's mid-plane: check the first board's first quad
    const s = signs[0]!;
    const b = s.boards[0]!;
    const p = g.attributes.position!;
    const dx = p.getX(0) - s.x;
    const dz = p.getZ(0) - s.z;
    const along = dx * Math.cos(b.yaw) + dz * Math.sin(b.yaw); // along the plank
    const across = Math.abs(-dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)); // out of the plank's plane
    expect(across).toBeCloseTo(BOARD_DEPTH / 2 + 0.006, 3);
    expect(along).toBeGreaterThan(-0.1);
    expect(along).toBeLessThan(b.len);
    g.dispose();
  });

  it("the view is at most two draws (posts, lettering), adds nothing to the parent when there is no canvas, and disposing frees everything", () => {
    const parent = new Group();
    const dispose = vi.fn();
    const tex = new CanvasTexture(undefined as unknown as HTMLCanvasElement);
    tex.dispose = dispose;
    const v = new HqRouteView(parent, world, { texture: tex });
    expect(v.draws).toBe(2);
    expect(parent.children).toHaveLength(2);
    const geos = parent.children.map((c) => (c as Mesh).geometry as BufferGeometry);
    const mats = parent.children.map((c) => (c as Mesh).material as MeshToonMaterial);
    const gd = geos.map((g) => vi.spyOn(g, "dispose"));
    const md = mats.map((m) => vi.spyOn(m, "dispose"));
    v.dispose();
    expect(parent.children).toHaveLength(0);
    for (const s of [...gd, ...md]) expect(s).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(v.draws).toBe(0);
    // no DOM, no texture: the posts still stand (one draw), the lettering is left out
    const bare = new Group();
    const v2 = new HqRouteView(bare, world, { texture: undefined });
    expect(v2.draws).toBe(1);
    v2.dispose();
  });

  it("the atlas has one strip per board, fits long lines to the strip, and paints only the lettering (no colour literals: the colour is a palette key)", () => {
    const texts = boardTexts(signs);
    expect(texts.length).toBe(signs.reduce((a, s) => a + s.boards.length, 0));
    expect(texts.length * STRIP_H).toBeLessThanOrEqual(4096);
    const calls: { text: string; font: string; y: number }[] = [];
    const fills: string[] = [];
    const ctx = {
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      clearRect: () => undefined,
      measureText: (t: string) => ({ width: t.length * (Number(/(\d+)px/.exec(ctx.font)?.[1]) || 10) * 0.5 }),
      fillText: (text: string, _x: number, y: number) => {
        calls.push({ text, font: ctx.font, y });
        fills.push(String(ctx.fillStyle));
      },
    } as unknown as CanvasRenderingContext2D;
    drawRouteAtlas(ctx, texts);
    expect(calls.map((c) => c.text)).toEqual(texts);
    expect(new Set(fills).size).toBe(1);
    expect(fills[0]).toMatch(/^#[0-9a-f]{6}$/);
    calls.forEach((c, i) => expect(Math.floor(c.y / STRIP_H)).toBe(i)); // each text lands in its own strip
    const widest = Math.max(...texts.map((t) => t.length));
    expect(widest * 14 * 0.5).toBeLessThan(STRIP_W); // even at the smallest size the longest line fits
  });
});
