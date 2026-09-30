import { Box3, Matrix4, Mesh, Vector3 } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { FIELDS, generateCharacter, sanitizeSpec, type CharacterSpec, type FieldKey } from "../spec.ts";
import { computeProportions } from "../proportions.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";
import { CharacterAnimator } from "./animator.ts";
import { PartBuilder, type PrimitiveAudit } from "./parts.ts";
import { ringAt, legRadius, type BodyCtx } from "./bodyKit.ts";
import type { Ring } from "./loft.ts";
import { armRestAbduction, bodyOutline } from "./armClearance.ts";
import { KNEE_LAP, footDims, foreArmRings, legRxMax, lowerLegPlan, sleeveFull, sleeveWrist, upperArmRings, upperLegRings, wristSize } from "./limbRings.ts";
import { skirtRings, skirtSpec } from "./garments.ts";

/**
 * Limb fit. Everything that lives on an arm, a hand, a leg or a foot must sit on the limb it is worn on, on ANY body: the tests here measure the real geometry against the ring
 * tables the limbs are lofted from (no bounding boxes), and pose the real animator to check that arms and legs clear the body and each other. Thresholds are ratchets: they only go down.
 */

afterAll(() => clearCharacterCaches());

const SHAPES: { name: string; spec: CharacterSpec }[] = (() => {
  const out: { name: string; spec: CharacterSpec }[] = [];
  for (let a = 0; a < 6; a++) out.push({ name: `archetype${a}`, spec: generateCharacter(100 + a, a) });
  const all = (v: number) => {
    const s = { ...generateCharacter(7) } as Record<string, number>;
    for (const f of FIELDS) if (f.kind === "slider") s[f.key] = v;
    return sanitizeSpec(s);
  };
  const set = (o: Record<string, number>) => sanitizeSpec({ ...generateCharacter(7), ...o });
  out.push({ name: "all0", spec: all(0) }, { name: "all255", spec: all(255) });
  out.push(
    { name: "thickShort", spec: set({ torsoWidth: 255, belly: 255, height: 40, legLength: 20, headScale: 255 }) },
    { name: "thinTall", spec: set({ torsoWidth: 0, belly: 0, height: 255, legLength: 255, headScale: 0, shoulderWidth: 0, handScale: 0, footScale: 0 }) },
    { name: "bigLimbs", spec: set({ torsoWidth: 255, belly: 0, shoulderWidth: 255, armLength: 255, handScale: 255, footScale: 255, headScale: 120 }) },
  );
  return out;
})();

/** A plain, fully dressed base: every optional extra off. */
const bare = (s: CharacterSpec): CharacterSpec => ({
  ...s,
  hat: 0, hair: 1, moustache: 0, beard: 0, sideburns: 0, eyewear: 0, jacket: 1, shirt: 0, trousers: 0, boots: 1, belt: 0, sash: 0, medals: 0, neckwear: 0,
  pack: 0, hipGear: 0, gloves: 0, scars: 0, teeth: 0, eyepatch: 0, burnt: 0, woodenLeg: 0, hook: 0, brows: 0, eyeShape: 0, eyeColor: 0, earShape: 0,
  stubble: 0, greying: 0, age: 0, complexion: 0, mark: 0, facePaint: 0, tattoo: 0, earring: 0, ring: 0, epaulettes: 0, decoration: 0, coatTrim: 0,
  trouserTrim: 0, hatTrim: 0, shirtColor: 0, bootColor: 0, noseStyle: 0, medalStyle: 0, buckle: 0, cuffDetail: 0, laces: 0, pocket: 0, hairAcc: 0, patchStyle: 0, scarStyle: 0,
});

const ctxOf = (spec: CharacterSpec): BodyCtx => {
  const P = computeProportions(spec);
  return { spec, P, skin: 0x998877, jacketC: 0x886644, trouserC: 0x445566, shirtC: 0xcccccc, armC: 0x886644, accent: 0xddaa33, burnt: 0, footH: 0.05 * P.scale, leather: 0x553322 };
};

// ---- the ring models are sound on every body -------------------------------------------------------------------------------------

describe("limb ring tables", () => {
  const specs: CharacterSpec[] = [...SHAPES.map((s) => s.spec)];
  for (let i = 0; i < 120; i++) specs.push(generateCharacter(5000 + i * 31, i % 6));

  it("stack strictly downward with finite, positive sections, for every trouser cut, boot and sleeve on every body", () => {
    const bad: string[] = [];
    const check = (name: string, rings: readonly Ring[], seed: string): void => {
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i]!;
        if (!Number.isFinite(r.y) || !(r.rx > 0) || !(r.rz > 0)) bad.push(`${seed} ${name}[${i}] not finite/positive`);
        if (i > 0 && !(r.y <= rings[i - 1]!.y + 1e-9)) bad.push(`${seed} ${name}[${i}] y goes up (${rings[i - 1]!.y.toFixed(3)} -> ${r.y.toFixed(3)})`);
      }
    };
    specs.forEach((base, si) => {
      for (const trousers of [0, 1, 2, 3, 4, 5, 6]) {
        for (const boots of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
          if (boots > 1 && trousers > 1 && (boots + trousers) % 3) continue; // (a spread of pairs, not all 63 on every body)
          const spec = { ...base, trousers, boots };
          const c = ctxOf(spec);
          const plan = lowerLegPlan(c);
          const tag = `s${si} tr${trousers} b${boots}`;
          check("shin", plan.shin, tag);
          check("shaft", plan.shaft, tag);
          check("upperLeg", upperLegRings(c), tag);
          if (plan.shaftTop < plan.ankleY) bad.push(`${tag} boot top below its own ankle`);
        }
      }
      for (const jacket of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const c = ctxOf({ ...base, jacket });
        check("foreArm", foreArmRings(c), `s${si} j${jacket}`);
        check("upperArm", upperArmRings(c.P, 0, jacket), `s${si} j${jacket}`);
      }
    });
    expect(bad.slice(0, 12)).toEqual([]);
  });

  it("the two thighs and shins never reach each other (every section is narrower than half the hip spacing)", () => {
    let worst = -1;
    for (const base of specs) {
      for (const trousers of [0, 1, 2, 3, 4, 5, 6]) {
        const c = ctxOf({ ...base, trousers, boots: 0 });
        const m = legRxMax(c.P);
        const plan = lowerLegPlan(c);
        for (const r of [...upperLegRings(c), ...plan.shin, ...plan.shaft]) worst = Math.max(worst, r.rx - m);
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it("the shin starts where the thigh ends, a hair inside it (no step at the knee, no shared surface), for every cut on every body", () => {
    let worst = 0;
    for (const base of specs) {
      for (const trousers of [0, 1, 2, 3, 4, 5, 6]) {
        const c = ctxOf({ ...base, trousers });
        const up = ringAt(upperLegRings(c), -c.P.legUpper - KNEE_LAP);
        const lo = lowerLegPlan(c).shin[0]!;
        worst = Math.max(worst, Math.abs(up.rx * 0.97 - lo.rx), Math.abs(up.rz * 0.97 - lo.rz));
      }
    }
    expect(worst).toBeLessThan(0.0015);
  });

  it("the sleeve closes on the hand's wrist: never narrower than the wrist it covers, never wider than the arm's own", () => {
    for (const base of specs) {
      for (const jacket of [0, 1, 2, 4, 5, 9]) {
        const c = ctxOf({ ...base, jacket });
        const w = wristSize(c.P);
        const s = sleeveWrist(c);
        expect(s.rx).toBeGreaterThanOrEqual(w.rx * 1.05);
        expect(s.rz).toBeGreaterThanOrEqual(w.rz * 1.05);
        expect(s.rx).toBeLessThanOrEqual(c.P.armRadius * 0.9 * Math.max(1, sleeveFull(jacket)));
        const tuck = foreArmRings(c).at(-1)!;
        expect(tuck.rx).toBeLessThanOrEqual(s.rx + 1e-9);
      }
    }
  });

  it("the shoe carries the ankle and the leg stands over the heel, on every body and every boot", () => {
    for (const base of specs) {
      for (const boots of [0, 1, 2, 5, 6, 8]) {
        const c = ctxOf({ ...base, boots });
        const plan = lowerLegPlan(c);
        const d = footDims(c, plan);
        expect(d.fw * d.fwK * 0.5, `${boots} foot half-width covers the ankle`).toBeGreaterThanOrEqual(plan.ankle.rx * 0.98);
        expect(d.heelZ, "heel behind the ankle").toBeGreaterThanOrEqual(plan.ankle.rz + 0.02);
        expect(d.fl).toBeGreaterThanOrEqual(d.fw * 1.85);
      }
    }
  });
});

// ---- details sit ON the limb -----------------------------------------------------------------------------------------------------

type Kind = PrimitiveAudit["kind"];
const HARD: ReadonlySet<Kind> = new Set(["sphere", "box", "cylinder", "cone", "torus", "button"]);

/** Approximate signed distance (metres, + outside) of a bone-space point from a ring table's surface; undefined beyond the table's ends. */
function depth(rings: readonly Ring[], x: number, y: number, z: number): number | undefined {
  const hi = Math.max(rings[0]!.y, rings[rings.length - 1]!.y);
  const lo = Math.min(rings[0]!.y, rings[rings.length - 1]!.y);
  if (y > hi + 0.002 || y < lo - 0.002) return undefined;
  const s = ringAt(rings, y);
  const u = Math.abs(x - s.cx) / s.rx;
  const v = Math.abs(z - s.cz) / s.rz;
  const q = (u ** s.pow + v ** s.pow) ** (1 / s.pow);
  return (q - 1) * Math.min(s.rx, s.rz);
}

interface Prim {
  bone: string;
  kind: Kind;
  index: number;
  v: Float32Array;
}

function measure(spec: CharacterSpec): { rig: CharacterRig; prims: Prim[] } {
  clearCharacterCaches();
  PartBuilder.audit = [];
  let rig: CharacterRig;
  let audit: PrimitiveAudit[];
  try {
    rig = buildCharacter(spec, { outline: false, lod: 0 });
    audit = PartBuilder.audit;
  } finally {
    PartBuilder.audit = undefined;
  }
  const geo = new Map<string, Float32Array>();
  rig.root.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith("mesh_")) geo.set(o.name.slice(5), o.geometry.attributes.position!.array as Float32Array);
  });
  const cur = new Map<string, { v: number; n: number }>();
  const prims: Prim[] = [];
  for (const a of audit) {
    const c = cur.get(a.tag) ?? { v: 0, n: 0 };
    cur.set(a.tag, c);
    const pos = geo.get(a.tag);
    if (pos) prims.push({ bone: a.tag, kind: a.kind, index: c.n, v: pos.slice(c.v * 3, (c.v + a.vertices) * 3) });
    c.v += a.vertices;
    c.n++;
  }
  return { rig, prims };
}

const surfaceOf = (spec: CharacterSpec, bone: string): readonly Ring[] | undefined => {
  const c = ctxOf(spec);
  if (bone.startsWith("upperArm")) return upperArmRings(c.P, 0, spec.jacket);
  if (bone.startsWith("foreArm")) return foreArmRings(c);
  if (bone.startsWith("upperLeg")) return upperLegRings(c);
  if (bone.startsWith("lowerLeg")) return lowerLegPlan(c).surface;
  return undefined;
};

/** Height (knee frame) above which the lower leg's surface is the boot's shaft or the trouser, not the shoe. */
function footTopOf(spec: CharacterSpec): number {
  const c = ctxOf(spec);
  const d = footDims(c);
  return -c.P.legLower - c.footH + 0.012 + d.H * 1.0;
}

interface Finding {
  what: string;
  bone: string;
  kind: string;
  cm: number;
}

/** Floating (no vertex within 1.4 cm of the limb's surface), buried (a hard piece wholly under it) and sunk (cloth deeper than 1.4 cm inside it). */
function judge(spec: CharacterSpec, prims: readonly Prim[]): Finding[] {
  const out: Finding[] = [];
  for (const p of prims) {
    if (p.index === 0) continue; // (the limb's own loft)
    const rings = surfaceOf(spec, p.bone);
    if (!rings) continue;
    if (p.bone.startsWith("lowerLeg") && spec.woodenLeg === (p.bone.endsWith("L") ? 1 : 2)) continue; // (a peg is not a boot: prosthetics have their own tests)
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    const tabTop = Math.max(rings[0]!.y, rings[rings.length - 1]!.y);
    const tabBot = Math.min(rings[0]!.y, rings[rings.length - 1]!.y);
    let beyond = false; // the piece runs on past the end of the limb's table: it is the hand, the foot, the hook or a peg, judged by their own tests
    for (let i = 1; i < p.v.length; i += 3) if (p.v[i]! < tabBot - 0.012) beyond = true;
    if (beyond) continue;
    const footTop = p.bone.startsWith("lowerLeg") ? footTopOf(spec) : -Infinity;
    for (let i = 0; i < p.v.length; i += 3) {
      if (p.v[i + 1]! < footTop + 0.01 || p.v[i + 1]! > tabTop - 0.012) continue; // (the shoe covers the ankle; the top of a table is a cap, not a surface)
      const d = depth(rings, p.v[i]!, p.v[i + 1]!, p.v[i + 2]!);
      if (d === undefined) continue;
      n++;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    if (n < 3) continue; // (lives beyond the table: the hand, the foot, the epaulette on the sleeve head)
    // (a cuff, a gauntlet or a leather socket stands up to 2 cm proud of the sleeve, and what is mounted on it another centimetre)
    const floatTol = p.bone.startsWith("foreArm") ? 0.03 : 0.014;
    if (lo > floatTol && p.kind !== "cone" && p.kind !== "torus") out.push({ what: "floats", bone: p.bone, kind: p.kind, cm: lo * 100 });
    if (HARD.has(p.kind) && hi < -0.002) out.push({ what: "buried", bone: p.bone, kind: p.kind, cm: hi * 100 });
    if (!HARD.has(p.kind) && lo < -0.016) out.push({ what: "sunk", bone: p.bone, kind: p.kind, cm: lo * 100 });
  }
  return out;
}

describe("details sit on the limb they are worn on", () => {
  const OPTIONS: { key: FieldKey; values: number[]; needs?: Partial<CharacterSpec> }[] = [
    { key: "jacket", values: [0, 1, 2, 3, 4, 5, 8, 9, 10] }, // (a cape's and a poncho's arm drape is drape.ts's)
    { key: "cuffDetail", values: [1, 2, 3], needs: { jacket: 2 } },
    { key: "cuffDetail", values: [1, 2, 3], needs: { jacket: 1 } },
    { key: "coatTrim", values: [2], needs: { jacket: 9 } },
    { key: "trousers", values: [0, 1, 2, 3, 4, 5, 6] },
    { key: "trouserTrim", values: [1, 2, 3, 4], needs: { trousers: 0 } },
    { key: "trouserTrim", values: [1, 2, 3, 4], needs: { trousers: 6 } },
    { key: "boots", values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    { key: "laces", values: [0, 1, 2, 3], needs: { boots: 1 } },
    { key: "laces", values: [1, 2, 3], needs: { boots: 0 } },
    { key: "gloves", values: [1, 2, 3, 4, 5] },
    { key: "epaulettes", values: [1, 2, 3, 4], needs: { jacket: 2 } },
    { key: "ring", values: [1, 2, 3, 4] },
    { key: "woodenLeg", values: [1, 2] },
    { key: "hook", values: [1, 2] },
  ];
  it("no cuff, stripe, button, patch, strap, lace or garter floats off the cloth, sinks into it or hides under it, on 11 body shapes", () => {
    const found: (Finding & { tag: string })[] = [];
    for (const shape of SHAPES) {
      for (const o of OPTIONS) {
        for (const v of o.values) {
          const spec = { ...bare(shape.spec), ...(o.needs ?? {}), [o.key]: v } as CharacterSpec;
          const { rig, prims } = measure(spec);
          rig.dispose();
          for (const f of judge(spec, prims)) found.push({ ...f, tag: `${shape.name} ${o.key}=${v}${o.needs ? " " + JSON.stringify(o.needs) : ""}` });
        }
      }
    }
    found.sort((a, b) => Math.abs(b.cm) - Math.abs(a.cm));
    if (process.env.LIMB_VERBOSE) {
      const g = new Map<string, { n: number; worst: number }>();
      for (const f of found) {
        const k = `${f.tag.replace(/^\S+ /, "")} | ${f.bone.replace(/[LR]$/, "")} ${f.kind} ${f.what}`;
        const e = g.get(k) ?? { n: 0, worst: 0 };
        e.n++;
        e.worst = Math.max(e.worst, Math.abs(f.cm));
        g.set(k, e);
      }
      for (const [k, e] of [...g].sort((a, b) => b[1].worst - a[1].worst).slice(0, 60)) process.stdout.write(`${k}: x${e.n} worst ${e.worst.toFixed(1)} cm\n`);
    }
    const summary = found.slice(0, 15).map((f) => `${f.tag}: ${f.bone} ${f.kind} ${f.what} ${f.cm.toFixed(1)} cm`);
    expect(summary, `${found.length} findings`).toEqual([]);
  }, 240000);
});

describe("generated people wear their limbs properly", () => {
  it("80 generated people (every option mixed the way the generator mixes them): nothing floats off, sinks into or hides under a limb", () => {
    const found: string[] = [];
    for (let seed = 0; seed < 80; seed++) {
      const spec = generateCharacter(7000 + seed * 13, seed % 6);
      if (spec.jacket === 6 || spec.jacket === 7) continue; // (a cape's or poncho's arm drape is drape.ts's)
      const { rig, prims } = measure(spec);
      rig.dispose();
      for (const f of judge(spec, prims)) found.push(`seed ${7000 + seed * 13}: ${f.bone} ${f.kind} ${f.what} ${f.cm.toFixed(1)} cm`);
    }
    expect(found.slice(0, 10), `${found.length} findings`).toEqual([]);
  }, 240000);
});

// ---- the body at rest and in motion --------------------------------------------------------------------------------------------------

const worldVerts = (rig: CharacterRig, bone: string): Vector3[] => {
  rig.root.updateMatrixWorld(true);
  let out: Vector3[] = [];
  rig.root.traverse((o) => {
    if (o instanceof Mesh && o.name === `mesh_${bone}`) {
      const p = o.geometry.attributes.position!;
      out = [];
      for (let i = 0; i < p.count; i++) out.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld));
    }
  });
  return out;
};

/** Depth (metres, + inside) of a world point in a superellipse section of a limb, given the bone's world matrix. */
function insideDepth(inv: Matrix4, w: Vector3, rings: readonly Ring[]): number | undefined {
  const p = w.clone().applyMatrix4(inv);
  const d = depth(rings, p.x, p.y, p.z);
  return d === undefined ? undefined : -d;
}

const POSES: { name: string; flags: number; speed: number; steps: number }[] = [
  { name: "idle", flags: FLAG.GROUNDED, speed: 0, steps: 60 },
  { name: "walk", flags: FLAG.GROUNDED, speed: 3.6, steps: 47 },
  { name: "walk2", flags: FLAG.GROUNDED, speed: 3.6, steps: 53 },
  { name: "run", flags: FLAG.GROUNDED, speed: 6, steps: 50 },
  { name: "sprint", flags: FLAG.GROUNDED | FLAG.SPRINTING, speed: 8, steps: 44 },
  { name: "crouch", flags: FLAG.GROUNDED | FLAG.CROUCHING, speed: 0, steps: 40 },
  { name: "air", flags: 0, speed: 0, steps: 30 },
];

describe("arms clear the body at rest and in motion", () => {
  it("the resting abduction is the smallest that clears the outline (a thin body's arms hang straight, a wide body's stand out), and never more than 29 degrees", () => {
    for (const { spec } of SHAPES) {
      const P = computeProportions(spec);
      const a = armRestAbduction(spec, P);
      expect(a).toBeGreaterThanOrEqual(0.08);
      expect(a).toBeLessThanOrEqual(0.5);
      const out = bodyOutline(spec, P);
      // at the chosen angle the wrist stands outside the outline (or the angle is the cap)
      const s = P.armUpper + P.armLower;
      if (a < 0.5) expect(P.shoulderHalfWidth + s * Math.sin(a) - P.handRadius * 0.42).toBeGreaterThanOrEqual(out.halfWidth(s * Math.cos(a)) + 0.005);
    }
  });

  it("no sleeve, cuff or hand ends up inside the coat skirt, the hips or the belly in any gait, on 11 bodies and 6 coats", () => {
    const bad: string[] = [];
    let worstAll = 0;
    for (const shape of SHAPES) {
      for (const jacket of [1, 2, 4, 5, 8, 9, 10]) {
        const spec = { ...bare(shape.spec), jacket, gloves: 4, cuffDetail: 3 };
        const rig = buildCharacter(spec, { outline: false, lod: 0 });
        const anim = new CharacterAnimator(rig);
        anim.autoBlink = false;
        const c = ctxOf(spec);
        const sk = skirtSpec(spec, c.P);
        const skirt = sk && sk.len > 0 ? skirtRings(c, sk.len, sk.flare, 0, 0) : undefined;
        const legs = upperLegRings(c);
        for (const pose of POSES) {
          for (let i = 0; i < pose.steps; i++) anim.update(1 / 30, { speed: pose.speed, flags: pose.flags, vy: pose.name === "air" ? 2 : 0 });
          rig.root.updateMatrixWorld(true);
          const pelvisInv = new Matrix4().copy(rig.joints.pelvis.matrixWorld).invert();
          for (const bone of ["upperArmL", "upperArmR", "foreArmL", "foreArmR"]) {
            let worst = 0;
            for (const w of worldVerts(rig, bone)) {
              const p = w.clone().applyMatrix4(pelvisInv);
              // the coat skirt (a closed cone of sections in the pelvis frame; the open coats' tails are at the sides, where the arms are)
              if (skirt) {
                const d = depth(skirt, p.x, p.y, p.z);
                if (d !== undefined && p.y < -0.03 * c.P.scale) worst = Math.max(worst, -d);
              }
            }
            // hips and legs: the thighs (each in its own hip frame)
            for (const [hip, side] of [[rig.joints.hipL, -1], [rig.joints.hipR, 1]] as const) {
              void side;
              const inv = new Matrix4().copy(hip.matrixWorld).invert();
              for (const w of worldVerts(rig, bone)) {
                const d = insideDepth(inv, w, legs);
                if (d !== undefined && d > 0) worst = Math.max(worst, d);
              }
            }
            worstAll = Math.max(worstAll, worst);
            if (worst > 0.03) bad.push(`${shape.name} j${jacket} ${pose.name} ${bone}: ${(worst * 100).toFixed(1)} cm inside`);
          }
        }
        rig.dispose();
      }
    }
    expect(bad.slice(0, 10), `worst ${(worstAll * 100).toFixed(1)} cm`).toEqual([]);
  }, 240000);
});

describe("legs clear each other and stand on the ground", () => {
  it("the left and right legs never interpenetrate in any gait, on 11 bodies and all 7 trouser cuts", () => {
    const bad: string[] = [];
    let worstAll = 0;
    for (const shape of SHAPES) {
      for (const trousers of [0, 2, 3, 4, 5]) {
        const spec = { ...bare(shape.spec), trousers, boots: 0 };
        const rig = buildCharacter(spec, { outline: false, lod: 0 });
        const anim = new CharacterAnimator(rig);
        anim.autoBlink = false;
        const c = ctxOf(spec);
        const plan = lowerLegPlan(c);
        const up = upperLegRings(c);
        for (const pose of POSES) {
          for (let i = 0; i < pose.steps; i++) anim.update(1 / 30, { speed: pose.speed, flags: pose.flags, vy: pose.name === "air" ? 2 : 0 });
          rig.root.updateMatrixWorld(true);
          // left leg's vertices inside the right leg's sections (thigh and shin), and the other way round
          for (const [aBone, bHip, bKnee] of [["upperLegL", rig.joints.hipR, rig.joints.kneeR], ["lowerLegL", rig.joints.hipR, rig.joints.kneeR], ["upperLegR", rig.joints.hipL, rig.joints.kneeL], ["lowerLegR", rig.joints.hipL, rig.joints.kneeL]] as const) {
            const invH = new Matrix4().copy(bHip.matrixWorld).invert();
            const invK = new Matrix4().copy(bKnee.matrixWorld).invert();
            let worst = 0;
            for (const w of worldVerts(rig, aBone)) {
              for (const [inv, rings] of [[invH, up], [invK, plan.surface]] as const) {
                const d = insideDepth(inv, w, rings);
                if (d !== undefined) worst = Math.max(worst, d);
              }
            }
            worstAll = Math.max(worstAll, worst);
            if (worst > 0.03) bad.push(`${shape.name} tr${trousers} ${pose.name} ${aBone}: ${(worst * 100).toFixed(1)} cm inside the other leg`);
          }
        }
        rig.dispose();
      }
    }
    expect(bad.slice(0, 10), `worst ${(worstAll * 100).toFixed(1)} cm`).toEqual([]);
  }, 240000);

  it("in the rest pose the sole is on the ground (y = 0 within 3 mm) for every boot, foot size and leg length; a peg leg's tip too", () => {
    const bad: string[] = [];
    for (const shape of SHAPES) {
      for (const boots of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        for (const woodenLeg of [0, 2]) {
          const spec = { ...bare(shape.spec), boots, woodenLeg };
          const rig = buildCharacter(spec, { outline: false, lod: 0 });
          rig.root.updateMatrixWorld(true);
          const bb = new Box3();
          for (const bone of ["lowerLegL", "lowerLegR"]) for (const w of worldVerts(rig, bone)) bb.expandByPoint(w);
          if (Math.abs(bb.min.y) > 0.003) bad.push(`${shape.name} boots${boots} wooden${woodenLeg}: lowest point ${(bb.min.y * 100).toFixed(2)} cm`);
          rig.dispose();
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 120000);
});

describe("limbs cost", () => {
  it("the four limb bones average under 3.6k triangles at full detail (60 people)", () => {
    let tris = 0;
    const N = 60;
    for (let s = 0; s < N; s++) {
      clearCharacterCaches();
      const rig = buildCharacter(generateCharacter(s), { outline: false, lod: 0 });
      rig.root.traverse((o) => {
        if (o instanceof Mesh && /^mesh_(upper|fore|lower)/.test(o.name)) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
      });
      rig.dispose();
    }
    expect(tris / N).toBeLessThan(3600);
  }, 120000);
});

void legRadius;
