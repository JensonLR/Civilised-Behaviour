import { BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, ExtrudeGeometry, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshToonMaterial, Quaternion, Shape, SRGBColorSpace, Vector3, CylinderGeometry, type Object3D } from "three";
import { sharedToonRamp } from "@cb/procedural/three";
import { PALETTE, cssHex, hqRoute, type CollisionWorld, type HqSign } from "@cb/shared";
import { Kit } from "./kit.ts";

/**
 * The finger-posts of the way round HQ (D-035, R). The route and the posts are the shared `hqRoute()` (the same numbers make the collision: tag `fingerpost`); this
 * dresses them: a post, a cap, and per board an arrow-shaped plank pointing where it says, merged into ONE vertex-coloured geometry, and the lettering as decals on
 * both faces of every plank, merged into ONE textured geometry. Two draws for the whole route, no ink hull (they are small and the camp's own ink budget is spent).
 * Colours: existing `PALETTE.camp` keys only. Lettering is drawn at runtime on a canvas in the bundled IM Fell face (no files), redrawn when the font arrives.
 */

const C = PALETTE.camp;
export const BOARD_DEPTH = 0.05;
export const BOARD_HALF_H = 0.15;
/** Pixels of one lettering strip in the atlas. */
export const STRIP_W = 512;
export const STRIP_H = 64;
/** The share of a board's length the lettering fills (the rest is the arrow's tip). */
const TEXT_FILL = 0.8;
/** The post stands this deep in the ground so a slope never shows its foot. */
const SINK = 0.3;

const up = new Vector3(0, 1, 0);
const q = new Quaternion();
const m4 = new Matrix4();
const v = new Vector3();
const n = new Vector3();

function arrowShape(len: number): Shape {
  const s = new Shape();
  s.moveTo(-0.12, -BOARD_HALF_H);
  s.lineTo(len - 0.28, -BOARD_HALF_H);
  s.lineTo(len, 0);
  s.lineTo(len - 0.28, BOARD_HALF_H);
  s.lineTo(-0.12, BOARD_HALF_H);
  s.closePath();
  return s;
}

/** One entry per board of every sign, in order: the atlas strip index of a board is its position here. */
export function boardTexts(signs: readonly HqSign[]): string[] {
  const out: string[] = [];
  for (const s of signs) for (const b of s.boards) out.push(b.text);
  return out;
}

/** The posts, caps and planks of every sign, vertex-coloured, one geometry (or undefined with no signs). */
export function buildHqRouteSolid(signs: readonly HqSign[], ground: (x: number, z: number) => number): BufferGeometry | undefined {
  const k = new Kit();
  for (const s of signs) {
    const g = ground(s.x, s.z);
    k.clearBase();
    k.setBase(s.x, g, s.z, 0);
    k.add(new CylinderGeometry(0.075, 0.09, s.height + SINK, 6), { at: [0, (s.height - SINK) / 2, 0], colour: C.signWood, flat: true });
    k.add(new CylinderGeometry(0.0, 0.13, 0.2, 4), { at: [0, s.height + 0.1, 0], rot: [0, Math.PI / 4, 0], colour: C.signWood, flat: true });
    for (const b of s.boards) {
      k.clearBase();
      k.setBase(s.x, g, s.z, b.yaw);
      const plank = new ExtrudeGeometry(arrowShape(b.len), { depth: BOARD_DEPTH, bevelEnabled: false });
      k.add(plank, { at: [0, b.y, -BOARD_DEPTH / 2], colour: C.pole, flat: true });
      // an iron strap where the plank meets the post
      k.add(new CylinderGeometry(0.1, 0.1, BOARD_HALF_H * 2 + 0.04, 6), { at: [0, b.y, 0], colour: C.iron, flat: true });
    }
  }
  k.clearBase();
  return k.build();
}

/** Where a board's strip sits in the atlas: u0, v0, u1, v1 (v = 1 is the canvas top). */
export function stripUv(i: number, total: number): readonly [number, number, number, number] {
  const h = total * STRIP_H;
  return [0, 1 - ((i + 1) * STRIP_H) / h, 1, 1 - (i * STRIP_H) / h];
}

/** The lettering decals: two quads per board (front and mirrored back), position + normal + uv. */
export function buildHqRouteLettering(signs: readonly HqSign[], ground: (x: number, z: number) => number): BufferGeometry | undefined {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const total = signs.reduce((a, s) => a + s.boards.length, 0);
  if (total === 0) return undefined;
  let i = 0;
  for (const s of signs) {
    const g = ground(s.x, s.z);
    for (const b of s.boards) {
      const [u0, v0, u1, v1] = stripUv(i++, total);
      q.setFromAxisAngle(up, -b.yaw);
      m4.compose(v.set(s.x, g + b.y, s.z), q, n.set(1, 1, 1));
      const textLen = (b.len - 0.36) * TEXT_FILL * 1.25;
      for (const side of [1, -1]) {
        const zf = side > 0 ? BOARD_DEPTH / 2 + 0.006 : -BOARD_DEPTH / 2 - 0.006;
        const x0 = -0.04;
        const x1 = x0 + textLen;
        // corners CCW seen from the face; the back face lists its corners from the far end, which turns the strip around
        const corners: [number, number][] = side > 0 ? [[x0, -BOARD_HALF_H + 0.02], [x1, -BOARD_HALF_H + 0.02], [x1, BOARD_HALF_H - 0.02], [x0, BOARD_HALF_H - 0.02]] : [[x1, -BOARD_HALF_H + 0.02], [x0, -BOARD_HALF_H + 0.02], [x0, BOARD_HALF_H - 0.02], [x1, BOARD_HALF_H - 0.02]];
        const uvs: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; // same strip order on both faces: the back face's corners already run x1 -> x0, so u runs against x there and the lettering reads left to right from behind
        const wp = corners.map(([x, y]) => v.set(x, y, zf).applyMatrix4(m4).toArray() as [number, number, number]);
        n.set(0, 0, side).applyQuaternion(q);
        for (const t of [0, 1, 2, 0, 2, 3] as const) {
          pos.push(...wp[t]!);
          nor.push(n.x, n.y, n.z);
          uv.push(...uvs[t]!);
        }
        n.set(1, 1, 1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Paints every strip: board-paint lettering on transparent ground (the plank's own colour shows through), fitted to the strip's width. */
export function drawRouteAtlas(ctx: CanvasRenderingContext2D, texts: readonly string[]): void {
  ctx.clearRect(0, 0, STRIP_W, texts.length * STRIP_H);
  ctx.fillStyle = cssHex(C.signPaint);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  texts.forEach((text, i) => {
    let size = 40;
    ctx.font = `${size}px "IM Fell English SC", "IM Fell English", serif`;
    while (size > 14 && ctx.measureText(text).width > STRIP_W - 24) {
      size -= 2;
      ctx.font = `${size}px "IM Fell English SC", "IM Fell English", serif`;
    }
    ctx.fillText(text, 12, i * STRIP_H + STRIP_H / 2 + 2);
  });
}

/** The atlas as a texture, or undefined where there is no canvas (Node tests). Redrawn once the bundled fonts have loaded so it never bakes in a fallback face. */
export function createRouteAtlas(texts: readonly string[]): CanvasTexture | undefined {
  if (typeof document === "undefined" || texts.length === 0) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = STRIP_W;
  canvas.height = texts.length * STRIP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  drawRouteAtlas(ctx, texts);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const fonts = (document as { fonts?: { load(f: string): Promise<unknown> } }).fonts;
  if (fonts) {
    void Promise.all([fonts.load('40px "IM Fell English SC"'), fonts.load('16px "IM Fell English"')]).then(() => {
      drawRouteAtlas(ctx, texts);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

/**
 * The route's meshes in `parent`: at most two draws. The integrator mounts it from `WorldView` for Hollowmere only (`new HqRouteView(root, world)`) and calls `dispose()`
 * with the rest of the view. `texture` is injectable for tests; by default a canvas atlas is drawn (and where there is no DOM the lettering is simply left out).
 */
export class HqRouteView {
  readonly meshes: Mesh[] = [];
  private readonly geos: BufferGeometry[] = [];
  private readonly mats: MeshToonMaterial[] = [];
  private readonly tex: CanvasTexture | undefined;

  constructor(private readonly parent: Object3D, world: CollisionWorld, opts: { texture?: CanvasTexture | undefined } = {}) {
    const signs = hqRoute().signs;
    const ground = (x: number, z: number): number => world.terrainHeight(x, z);
    const solid = buildHqRouteSolid(signs, ground);
    if (solid) {
      const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() });
      this.add("hq-route", solid, mat, true);
    }
    const tex = "texture" in opts ? opts.texture : createRouteAtlas(boardTexts(signs));
    this.tex = tex;
    const letters = tex ? buildHqRouteLettering(signs, ground) : undefined;
    if (letters && tex) {
      const mat = new MeshToonMaterial({ map: tex, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp(), color: new Color(0xffffff) });
      this.add("hq-route-lettering", letters, mat, false);
    }
  }

  private add(name: string, geo: BufferGeometry, mat: MeshToonMaterial, cast: boolean): void {
    const mesh = new Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    this.meshes.push(mesh);
    this.geos.push(geo);
    this.mats.push(mat);
  }

  get draws(): number {
    return this.meshes.length;
  }

  dispose(): void {
    for (const m of this.meshes) this.parent.remove(m);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex?.dispose();
    this.meshes.length = 0;
    this.geos.length = 0;
    this.mats.length = 0;
  }
}
