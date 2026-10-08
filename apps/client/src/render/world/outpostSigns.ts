import { BufferAttribute, BufferGeometry, CanvasTexture, LinearFilter, LinearMipmapLinearFilter, MeshToonMaterial, SRGBColorSpace } from "three";
import { BOARD_LINE, KESSAR_OUTPOST, OUTPOST_NAMES, PALETTE, RIVAL_BOARD, outpostPlan, type CollisionWorld, type RegionDress, type RegionId } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import { letterSign } from "./signLettering.ts";

/**
 * The outpost's boards, lettered. The foundation's board stands at every stage of a post and was a plain painted plank; it now carries the post's name and what it has
 * become ("Small Mercy. Trading Post"), and the Syndicate's board at Kessar its own sales pitch. Each board gets a decal on both faces (the back one mirrored so it reads
 * from behind), drawn from one small canvas; rebuilt with the post when its stage or name changes. The boards themselves (and where they stand) are `outpost.ts`'s.
 */

/** A board's centre and size (metres); its faces look along +z and -z. */
export interface BoardSpec { x: number; y: number; z: number; w: number; h: number; depth: number; text: string }

/** The lettered boards of this dress, where `outpost.ts` puts them (the post's name board: 1.4 x 0.7 on its pole at the north of the yard, every stage; the Syndicate's: 1.5 x 0.9). Pure. */
export function outpostBoards(world: CollisionWorld, dress: RegionDress, region: RegionId): BoardSpec[] {
  const out: BoardSpec[] = [];
  const plan = outpostPlan(dress.outpost, region);
  const board = plan.pieces.find((p) => p.kind === "sign");
  if (board) {
    const name = dress.name.trim() || OUTPOST_NAMES[0]!;
    out.push({ x: board.x, y: world.terrainHeight(board.x, board.z) + 1.4, z: board.z, w: 1.4, h: 0.7, depth: 0.06, text: BOARD_LINE[dress.outpost].replace("{name}", name) });
  }
  if (region === "kessar" && dress.rivalPost > 0) {
    const at = KESSAR_OUTPOST.rivalSite;
    out.push({ x: at.x + 2, y: world.terrainHeight(at.x + 2, at.z - 3) + 1.1, z: at.z - 3, w: 1.5, h: 0.9, depth: 0.06, text: RIVAL_BOARD });
  }
  return out;
}

const ROW_W = 512;
const ROW_H = 256;
const c = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

/** The decals: both faces of every board, a hair proud of the paint (so they never fight it), UVs into the board's row of the atlas. */
export function boardLetteringGeometry(boards: readonly BoardSpec[]): BufferGeometry | undefined {
  if (boards.length === 0) return undefined;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  boards.forEach((b, i) => {
    const v0 = 1 - (i + 1) / boards.length;
    const v1 = 1 - i / boards.length;
    for (const side of [1, -1] as const) {
      const z = b.z + side * (b.depth / 2 + 0.004);
      const hw = b.w / 2 - 0.03;
      const hh = b.h / 2 - 0.03;
      // facing +z the text runs west to east; from behind (facing -z) it must run east to west to read
      const xl = b.x - side * hw;
      const xr = b.x + side * hw;
      const quad = [
        [xl, b.y - hh, 0, v0], [xr, b.y - hh, 1, v0], [xr, b.y + hh, 1, v1],
        [xl, b.y - hh, 0, v0], [xr, b.y + hh, 1, v1], [xl, b.y + hh, 0, v1],
      ] as const;
      for (const [x, y, u, v] of side === 1 ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]) {
        pos.push(x, y, z);
        nor.push(0, 0, side);
        uv.push(u, v);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  return g;
}

function drawBoards(ctx: CanvasRenderingContext2D, boards: readonly BoardSpec[]): void {
  boards.forEach((b, i) => {
    const y = i * ROW_H;
    ctx.fillStyle = c(PALETTE.outpost.sign);
    ctx.fillRect(0, y, ROW_W, ROW_H);
    ctx.strokeStyle = c(PALETTE.outpost.plankDark);
    ctx.lineWidth = 10;
    ctx.strokeRect(5, y + 5, ROW_W - 10, ROW_H - 10);
    ctx.fillStyle = c(PALETTE.ink);
    letterSign(ctx, b.text, 0, y, ROW_W, ROW_H);
  });
}

/** The lettering canvas for these boards, or undefined without a document (Node tests). Redrawn once the bundled sign face has loaded. */
export function boardLetteringTexture(boards: readonly BoardSpec[]): CanvasTexture | undefined {
  if (typeof document === "undefined" || boards.length === 0) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = ROW_W;
  canvas.height = ROW_H * boards.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  drawBoards(ctx, boards);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const fonts = (document as { fonts?: { load(f: string): Promise<unknown> } }).fonts;
  if (fonts) {
    void fonts.load('40px "IM Fell English SC"').then(() => {
      drawBoards(ctx, boards);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

/** Toon-lit like the board it sits on (the same ramp), so the lettering shades with the wood. */
export function boardLetteringMaterial(map: CanvasTexture | undefined): MeshToonMaterial {
  return new MeshToonMaterial({ map: map ?? null, gradientMap: sharedToonRamp(), color: map ? 0xffffff : PALETTE.outpost.sign });
}
