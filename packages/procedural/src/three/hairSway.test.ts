import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { Vector3, type BufferAttribute, type Mesh, type MeshToonMaterial, type ShaderMaterial } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import * as K from "../catalog.ts";
import { computeProportions } from "../proportions.ts";
import { generateCharacter, sanitizeSpec, type CharacterSpec } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { HAIR_SWAY_MAX, swayOffset } from "./hairSway.ts";
import { buildHead, headFitFor } from "./head.ts";
import { AUDIT_COLORS } from "./headAudit.ts";
import { PartBuilder } from "./parts.ts";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const G = FLAG.GROUNDED;
const STYLES = K.HAIR_STYLES.length;
const set = (base: CharacterSpec, o: Partial<Record<string, number>>): CharacterSpec => sanitizeSpec({ ...base, ...o });
const base0 = generateCharacter(31);
const plain = (o: Partial<Record<string, number>> = {}): CharacterSpec =>
  set(base0, { hat: 0, hair: 1, moustache: 0, beard: 0, sideburns: 0, eyewear: 0, hairAcc: 0, earring: 0, eyepatch: 0, jacket: 1, neckwear: 0, jaw: 128, noseScale: 128, earScale: 128, headScale: 128, ...o });
const HEADS: Record<string, Partial<Record<string, number>>>[] = [
  { tiny: { headScale: 0 } },
  { huge: { headScale: 255 } },
  { narrowJaw: { jaw: 0, noseScale: 0, earScale: 0 } },
  { heavyJaw: { headScale: 200, jaw: 255, noseScale: 255, earScale: 255 } },
  { worstBody: { headScale: 255, torsoWidth: 255, belly: 255, height: 40, legLength: 20, jaw: 255, earScale: 255 } },
];
const hswOf = (g: { getAttribute(n: string): unknown }): BufferAttribute | undefined => (g.getAttribute("hsw") as BufferAttribute | null) ?? undefined;
/** The long styles: their tips hang or stand well clear of the scalp (wild tufts, long lank, ponytail, plait, shaggy mane). */
const LONG = [K.HAIR_STYLES.indexOf("Wild Tufts"), K.HAIR_STYLES.indexOf("Long Lank"), K.HAIR_STYLES.indexOf("Ponytail"), K.HAIR_STYLES.indexOf("Plait"), K.HAIR_STYLES.indexOf("Shaggy Mane")];

describe("hair sway: the geometry", () => {
  it("every hair style carries the sway attribute at the full and the mid level (main mesh and ink hull), a bald head and the far level do not", () => {
    for (let style = 0; style < STYLES; style++) {
      const spec = plain({ hair: style });
      const P = computeProportions(spec);
      for (const lod of [0, 1, 2] as const) {
        for (const hull of [false, true]) {
          PartBuilder.lod = lod;
          PartBuilder.hullMode = hull;
          try {
            const g = buildHead(spec, P, { ...AUDIT_COLORS, morph: lod === 0 && !hull ? true : lod === 0 });
            const has = g!.hasAttribute("hsw");
            expect(has, `style ${style} lod ${lod} hull ${hull}`).toBe(style !== 0 && lod <= 1);
            if (has) expect(hswOf(g!)!.itemSize).toBe(4);
            g!.dispose();
          } finally {
            PartBuilder.lod = 0;
            PartBuilder.hullMode = false;
          }
        }
      }
    }
  });

  it("not one triangle or vertex is added: the same head with and without the attribute has the same size", () => {
    for (const style of [2, 8, 10, 11, 15]) {
      const spec = plain({ hair: style });
      const P = computeProportions(spec);
      const a = buildHead(spec, P, { ...AUDIT_COLORS, morph: true })!;
      PartBuilder.sway = false;
      const b = buildHead(spec, P, { ...AUDIT_COLORS, morph: true })!;
      PartBuilder.sway = true;
      expect(a.hasAttribute("hsw")).toBe(true);
      expect(b.hasAttribute("hsw")).toBe(false);
      expect(a.index!.count).toBe(b.index!.count);
      expect(a.attributes.position!.count).toBe(b.attributes.position!.count);
      expect(Array.from(a.attributes.position!.array)).toEqual(Array.from(b.attributes.position!.array));
    }
  });

  it("roots do not move and the tips of long styles do: weight 0 on the scalp, > 0.3 at the tips", () => {
    for (const style of LONG) {
      const spec = plain({ hair: style });
      const P = computeProportions(spec);
      const g = buildHead(spec, P, AUDIT_COLORS)!;
      const hsw = hswOf(g)!;
      const pos = g.attributes.position!;
      const { hf } = headFitFor(spec, P);
      let tip = 0;
      let rootMax = 0;
      for (let i = 0; i < hsw.count; i++) {
        const w = Math.max(hsw.getX(i), hsw.getY(i), hsw.getZ(i), hsw.getW(i));
        tip = Math.max(tip, w);
        // a vertex within 5% of the head's radius of the scalp is a root
        const dy = pos.getY(i) - P.headRadius;
        const l = Math.hypot(pos.getX(i), dy, pos.getZ(i)) || 1e-9;
        const stand = l - hf.shape.radius(pos.getX(i) / l, dy / l, pos.getZ(i) / l);
        if (stand < 0.05 * P.headRadius) rootMax = Math.max(rootMax, w);
      }
      expect(tip, `${K.HAIR_STYLES[style]} tips`).toBeGreaterThan(0.3);
      expect(rootMax, `${K.HAIR_STYLES[style]} roots`).toBeLessThan(0.02);
    }
  });

  it("at the furthest sway (every corner of the box the animator may drive) no hair vertex sinks more than 5 mm deeper into the skull, neck, trunk or arms than it already sits (5 heads x every style)", () => {
    const corners: Vector3[] = [];
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) corners.push(new Vector3(sx * HAIR_SWAY_MAX.x, HAIR_SWAY_MAX.y, sz * HAIR_SWAY_MAX.z), new Vector3(sx * HAIR_SWAY_MAX.x, 0, sz * HAIR_SWAY_MAX.z));
    const d = new Vector3();
    let worst = 0;
    let moved = 0;
    for (const entry of HEADS) {
      const [name, over] = Object.entries(entry)[0]!;
      for (let style = 1; style < STYLES; style++) {
        const spec = plain({ ...over, hair: style });
        const P = computeProportions(spec);
        const { hf } = headFitFor(spec, P);
        const g = buildHead(spec, P, AUDIT_COLORS)!;
        const hsw = hswOf(g)!;
        const hsy = g.getAttribute("hsy") as BufferAttribute;
        const pos = g.attributes.position!;
        for (let i = 0; i < hsw.count; i++) {
          if (hsw.getX(i) <= 0 && hsw.getY(i) <= 0 && hsw.getZ(i) <= 0 && hsw.getW(i) <= 0) continue;
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          const s0 = Math.min(0, hf.solidDist(x, y, z));
          const h: [number, number, number, number] = [hsw.getX(i), hsw.getY(i), hsw.getZ(i), hsw.getW(i)];
          const hy = hsy.getX(i);
          for (const c of corners) {
            swayOffset(h, hy, c, d);
            const s1 = hf.solidDist(x + d.x, y + d.y, z + d.z);
            worst = Math.max(worst, s0 - s1);
            if (s0 - s1 > 0.005) expect.soft(s0 - s1, `${name} style ${K.HAIR_STYLES[style]} vertex ${i} sinks`).toBeLessThanOrEqual(0.005);
          }
          moved++;
        }
        g.dispose();
      }
    }
    expect(moved).toBeGreaterThan(5000);
    expect(worst).toBeLessThanOrEqual(0.005);
  }, 600_000);
});

describe("hair sway: the animator", () => {
  const make = (over: Partial<Record<string, number>> = {}, seed = 5): { rig: ReturnType<typeof buildCharacter>; anim: CharacterAnimator } => {
    const rig = buildCharacter(set({ ...generateCharacter(seed), woodenLeg: 0 }, { hair: K.HAIR_STYLES.indexOf("Ponytail"), hat: 0, ...over }), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    return { rig, anim };
  };
  const trace = (m: ReturnType<typeof make>, seconds: number, pose: { speed: number; flags: number; yawRate?: number }, f?: (v: Vector3) => void): void => {
    for (let i = 0; i < seconds * 30; i++) {
      m.anim.update(1 / 30, { vy: 0, ...pose });
      f?.(m.rig.hairSway.value);
    }
  };

  it("at a standstill the hair moves less than a millimetre; running swings the tips 2 to 8 cm; the furthest is bounded", () => {
    const m = make();
    let idle = 0;
    trace(m, 4, { speed: 0, flags: G }, (v) => (idle = Math.max(idle, v.length())));
    expect(idle).toBeLessThan(0.001);
    let run = 0;
    trace(m, 1, { speed: 5.5, flags: G });
    trace(m, 2, { speed: 5.5, flags: G, yawRate: 2 }, (v) => (run = Math.max(run, Math.abs(v.z))));
    expect(run).toBeGreaterThanOrEqual(0.02);
    expect(run).toBeLessThanOrEqual(0.08);
    let sprint = 0;
    let side = 0;
    let up = 0;
    trace(m, 3, { speed: 9, flags: G | FLAG.SPRINTING, yawRate: 5 }, (v) => {
      sprint = Math.max(sprint, Math.abs(v.z));
      side = Math.max(side, Math.abs(v.x));
      up = Math.max(up, v.y);
    });
    expect(sprint).toBeLessThanOrEqual(HAIR_SWAY_MAX.z);
    expect(side).toBeLessThanOrEqual(HAIR_SWAY_MAX.x);
    expect(up).toBeLessThanOrEqual(HAIR_SWAY_MAX.y);
    m.rig.dispose();
  });

  it("scaled by the motion option: 30% under reduced motion, nothing at 0", () => {
    const peak = (motion: number): number => {
      const m = make();
      m.anim.motion = motion;
      let p = 0;
      trace(m, 1, { speed: 5.5, flags: G });
      trace(m, 2, { speed: 5.5, flags: G }, (v) => (p = Math.max(p, v.length())));
      m.rig.dispose();
      return p;
    };
    const full = peak(1);
    expect(full).toBeGreaterThan(0.02);
    expect(peak(0.3)).toBeCloseTo(full * 0.3, 6);
    expect(peak(0)).toBe(0);
  });

  it("deterministic (the phase comes from the spec) and finite; a downed body lets the hair fall still", () => {
    const run = (): number[] => {
      const m = make();
      const out: number[] = [];
      trace(m, 2, { speed: 4, flags: G }, (v) => out.push(v.x, v.y, v.z));
      trace(m, 2, { speed: 0, flags: G | FLAG.DOWNED }, (v) => out.push(v.x, v.y, v.z));
      expect(out.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(out[out.length - 3]!, out[out.length - 2]!, out[out.length - 1]!)).toBeLessThan(0.002);
      m.rig.dispose();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("a slow frame cannot blow the spring up (dt is capped and sub-stepped)", () => {
    const m = make();
    for (let i = 0; i < 40; i++) m.anim.update(i % 2 ? 0.1 : 0.0005, { speed: 8, flags: G, vy: 0 });
    expect(m.rig.hairSway.value.length()).toBeLessThan(0.2);
    m.rig.dispose();
  });

  it("allocation-free: thousands of frames retain no heap", () => {
    const m = make();
    trace(m, 1, { speed: 4, flags: G });
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    trace(m, 160, { speed: 4, flags: G, yawRate: 1 }); // (warm: the optimiser's own bookkeeping is not what is measured)
    gc();
    const before = process.memoryUsage().heapUsed;
    trace(m, 160, { speed: 4, flags: G, yawRate: 1 });
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(2e5);
    m.rig.dispose();
  });
});

describe("hair sway: the rig", () => {
  const head = (rig: ReturnType<typeof buildCharacter>): Mesh => rig.root.getObjectByName("mesh_head") as Mesh;
  const hull = (rig: ReturnType<typeof buildCharacter>): Mesh => rig.root.getObjectByName("outline_head") as Mesh;

  it("a head with hair draws with its OWN material and hull (one character's hair never moves another's); a bald head uses the shared ones", () => {
    const spec = { ...generateCharacter(5), hair: 10, hat: 0, woodenLeg: 0 };
    const a = buildCharacter(spec, { outline: true });
    const b = buildCharacter(spec, { outline: true });
    expect(head(a).material).not.toBe(head(b).material);
    expect(hull(a).material).not.toBe(hull(b).material);
    expect(a.hairSway.value).not.toBe(b.hairSway.value);
    // each reads its own uniform
    a.hairSway.value.set(0.01, 0.02, 0.03);
    const shader = { uniforms: {} as Record<string, { value: Vector3 }>, vertexShader: "#include <common>\n#include <begin_vertex>" };
    (head(a).material as MeshToonMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uSway!.value).toBe(a.hairSway.value);
    expect(shader.vertexShader).toContain("transformed += hairSway();");
    const hullShader = (hull(a).material as ShaderMaterial).vertexShader;
    expect(hullShader).toContain("hairSway()");
    expect((hull(a).material as ShaderMaterial).uniforms.uSway!.value).toBe(a.hairSway.value);
    expect(hullShader).toContain("morphtarget_vertex"); // (the morphing face's hull keeps its morphs)
    // bald: nothing to move, the shared materials
    const bald = buildCharacter({ ...spec, hair: 0 }, { outline: true });
    expect(head(bald).geometry.hasAttribute("hsw")).toBe(false);
    expect(head(bald).material).toBe(head(buildCharacter({ ...spec, hair: 0, jacket: 3 }, { outline: true })).material);
    for (const r of [a, b, bald]) r.dispose();
  });

  it("the far level and the merged crowd levels cost nothing: no attribute, no sway material in play", () => {
    const spec = { ...generateCharacter(5), hair: 10, hat: 0, woodenLeg: 0 };
    const rig = buildCharacter(spec, { outline: false, lod: 2 });
    expect(head(rig)?.geometry.hasAttribute("hsw") ?? false).toBe(false);
    rig.setLod(0);
    expect(head(rig).geometry.hasAttribute("hsw")).toBe(true);
    expect(head(rig).material).not.toBe(undefined);
    rig.setLod(2);
    expect(head(rig).geometry.hasAttribute("hsw")).toBe(false);
    expect(PartBuilder.sway).toBe(true);
    rig.dispose();
  });
});
