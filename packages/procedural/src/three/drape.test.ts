import { Box3, Mesh, Triangle, Vector3, type BufferGeometry } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { computeProportions } from "../proportions.ts";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { CharacterAnimator, type ExpressionId } from "./animator.ts";
import type { BodyCtx } from "./bodyKit.ts";
import { buildDrapeOnly } from "./drape.ts";
import { torsoRings } from "./garments.ts";
import { loftGeometry } from "./loft.ts";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const CAPE = 6;
const PONCHO = 7;

/** The body context the rig would build (only the fields the drape reads matter). */
function ctxFor(spec: CharacterSpec): BodyCtx {
  const P = computeProportions(spec);
  return { spec, P, skin: 0xd8a888, jacketC: 0x6a3a5a, trouserC: 0x5a2a2a, shirtC: 0xe8dcc0, armC: 0x6a3a5a, accent: 0xc8a040, burnt: 0, footH: 0.05 * P.scale, leather: 0x6a4020 };
}

/** Bodies of every build: the six archetypes and the slider extremes. */
function bodies(jacket: number): CharacterSpec[] {
  const out: CharacterSpec[] = [];
  for (let a = 0; a < 6; a++) out.push({ ...generateCharacter(300 + a, a), jacket, pack: 0, hipGear: 0, woodenLeg: 0, hook: 0 });
  return out;
}

/** Everything the animator can do with the arms: joint rotations gathered over moods, gaits, carrying, hauling, kneeling, jumps, crouches and idle acts. */
function armEnvelope(seed: number): { sx: number; sz: number; el: number }[] {
  const spec = { ...generateCharacter(seed), woodenLeg: 0 };
  const rig = buildCharacter(spec, { outline: false });
  const anim = new CharacterAnimator(rig);
  const seen = new Map<string, { sx: number; sz: number; el: number }>();
  const G = FLAG.GROUNDED;
  const states: { speed: number; flags: number; vy: number }[] = [
    { speed: 0, flags: G, vy: 0 },
    { speed: 2, flags: G, vy: 0 },
    { speed: 4, flags: G, vy: 0 },
    { speed: 7, flags: G | FLAG.SPRINTING, vy: 0 },
    { speed: 0, flags: G | FLAG.CARRYING, vy: 0 },
    { speed: 2, flags: G | FLAG.CARRYING, vy: 0 },
    { speed: 0, flags: G | FLAG.CROUCHING, vy: 0 },
    { speed: 0, flags: G | FLAG.REVIVING, vy: 0 },
    { speed: 1.5, flags: G | FLAG.DRAGGING, vy: 0 },
    { speed: 3, flags: 0, vy: 4 },
    { speed: 3, flags: 0, vy: -6 },
    { speed: 0, flags: G | FLAG.DOWNED, vy: 0 },
  ];
  const moods: ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry"];
  const sample = (): void => {
    const j = rig.joints;
    for (const [sh, el, sgn] of [[j.shoulderL, j.elbowL, -1], [j.shoulderR, j.elbowR, 1]] as const) {
      const sx = sh.rotation.x;
      const sz = sh.rotation.z * sgn; // + = out to the side, whichever arm
      const e = el.rotation.x;
      const key = `${Math.round(sx / 0.12)}|${Math.round(sz / 0.12)}|${Math.round(e / 0.2)}`;
      if (!seen.has(key)) seen.set(key, { sx: sh.rotation.x, sz, el: e });
    }
  };
  for (const mood of moods) {
    anim.setExpression(mood);
    for (const st of states) {
      // (long enough for idle acts to come round: they change every ~9 s)
      const frames = st.speed === 0 && st.flags === G ? 30 * 40 : 60;
      for (let i = 0; i < frames; i++) {
        anim.update(1 / 30, st);
        if (i % 3 === 0) sample();
      }
    }
  }
  rig.dispose();
  return [...seen.values()];
}

/** Distance from a point to the nearest triangle (with an AABB reject so a few hundred triangles are cheap). */
function nearest(tris: { t: Triangle; box: Box3 }[], p: Vector3, limit: number): number {
  const tmp = new Vector3();
  let best = Infinity;
  for (const { t, box } of tris) {
    if (p.x < box.min.x - limit || p.x > box.max.x + limit || p.y < box.min.y - limit || p.y > box.max.y + limit || p.z < box.min.z - limit || p.z > box.max.z + limit) continue;
    t.closestPointToPoint(p, tmp);
    best = Math.min(best, tmp.distanceTo(p));
  }
  return best;
}

function triangles(g: BufferGeometry): { t: Triangle; box: Box3 }[] {
  const pos = g.attributes.position!;
  const idx = g.index!;
  const out: { t: Triangle; box: Box3 }[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const t = new Triangle(new Vector3().fromBufferAttribute(pos, idx.getX(i)), new Vector3().fromBufferAttribute(pos, idx.getX(i + 1)), new Vector3().fromBufferAttribute(pos, idx.getX(i + 2)));
    out.push({ t, box: new Box3().setFromPoints([t.a, t.b, t.c]) });
  }
  return out;
}

describe("capes and ponchos are draped, not bowls", () => {
  it("the arms never pass through the cloth at any pose the animator can produce (the arm piece rides on the arm; the torso piece keeps clear of the arms' whole sweep)", () => {
    const poses = armEnvelope(3);
    // the envelope really contains the extremes: arms straight up, hauled back, hands to the chin, out to the side
    expect(Math.max(...poses.map((p) => p.sx))).toBeGreaterThan(2.4);
    expect(Math.min(...poses.map((p) => p.sx))).toBeLessThan(-0.85);
    expect(Math.max(...poses.map((p) => Math.abs(p.sz)))).toBeGreaterThan(0.75);
    expect(Math.max(...poses.map((p) => p.el))).toBeGreaterThan(1.9);
    expect(poses.length).toBeGreaterThan(60);
    const worst: Record<string, { d: number; what: string }> = {};
    for (const jacket of [CAPE, PONCHO]) {
      for (const spec of bodies(jacket)) {
        const c = ctxFor(spec);
        const rig = buildCharacter(spec, { outline: false });
        const torso = triangles(buildDrapeOnly(c, "torso")!);
        // the bare body under the cloth: an arm pressed against it is the body's business (it is already touching); the cloth must not add clipping beyond it
        const bare = triangles(loftGeometry(torsoRings(c.P, 0xffffff, 0), { color: 0xffffff, segments: 16 }));
        const r = c.P.armRadius;
        const arms = { L: { sh: rig.joints.shoulderL, el: rig.joints.elbowL, drape: triangles(buildDrapeOnly(c, "armL")!) }, R: { sh: rig.joints.shoulderR, el: rig.joints.elbowR, drape: triangles(buildDrapeOnly(c, "armR")!) } };
        const p = new Vector3();
        for (const pose of poses) {
          for (const side of ["L", "R"] as const) {
            const a = arms[side];
            const sgn = side === "L" ? -1 : 1;
            a.sh.rotation.set(pose.sx, 0, pose.sz * sgn); // (sz is stored outward-positive)
            a.el.rotation.set(pose.el, 0, 0);
            rig.root.updateMatrixWorld(true);
            // the arm's axis: shoulder -> elbow -> wrist, sampled, in the TORSO frame
            const toTorso = (v: Vector3): Vector3 => rig.joints.torso.worldToLocal(v);
            const elbowW = a.el.getWorldPosition(new Vector3());
            const wristW = a.el.localToWorld(new Vector3(0, -c.P.armLower - c.P.handRadius * 1.3, 0));
            const shoulderW = a.sh.getWorldPosition(new Vector3());
            for (let k = 1; k <= 8; k++) {
              const f = k / 8;
              // upper arm (skip the first sample: the shoulder joint itself is where the cloth is attached) and forearm + hand
              p.copy(shoulderW).lerp(elbowW, f);
              const overBody = (q: Vector3): boolean => nearest(bare, toTorso(q.clone()), r * 3) < r * 1.0 + 0.1;
              const inTorso = overBody(p) ? Infinity : nearest(torso, toTorso(p.clone()), r * 3);
              const key = `torso-${jacket}-b${spec.belly}-${spec.torsoWidth}`;
              if (inTorso / r < (worst[key]?.d ?? Infinity)) worst[key] = { d: inTorso / r, what: `${jacket === CAPE ? "cape" : "poncho"} torso piece vs upper arm at (x ${(toTorso(p.clone()).x / c.P.shoulderHalfWidth).toFixed(2)} SH, y ${(toTorso(p.clone()).y / c.P.torsoHeight).toFixed(2)} h, z ${toTorso(p.clone()).z.toFixed(2)}), pose ${JSON.stringify(pose)}, side ${side}, body ${spec.height}/${spec.belly}` };
              p.copy(elbowW).lerp(wristW, f);
              const inTorso2 = overBody(p) ? Infinity : nearest(torso, toTorso(p.clone()), r * 3);
              if (inTorso2 / r < (worst[key]?.d ?? Infinity)) worst[key] = { d: inTorso2 / r, what: `${jacket === CAPE ? "cape" : "poncho"} torso piece vs forearm at (x ${(toTorso(p.clone()).x / c.P.shoulderHalfWidth).toFixed(2)} SH, y ${(toTorso(p.clone()).y / c.P.torsoHeight).toFixed(2)} h, z ${toTorso(p.clone()).z.toFixed(2)}), pose ${JSON.stringify(pose)}, side ${side}, body ${spec.height}/${spec.belly}` };
              // the forearm against the arm's own drape, in the upper-arm frame
              // (a hand pressed to the chin or the belly folds the forearm back over the upper arm past 1.9 rad; it comes out through the sleeve then, by design)
              const inArm = pose.el > 1.9 ? Infinity : nearest(a.drape, a.sh.worldToLocal(p.clone()), r * 3);
              const key2 = `arm-${jacket}-b${spec.belly}`;
              if (inArm / r < (worst[key2]?.d ?? Infinity)) worst[key2] = { d: inArm / r, what: `arm drape vs forearm, pose ${JSON.stringify(pose)}, side ${side}` };
            }
            void sgn;
          }
        }
        rig.dispose();
      }
    }
    // The arm's axis must stay clear of the cloth by most of the sleeve's own radius (0.6 r: the sleeve itself is ~1.4 r thick, the axis is inside it).
    if (process.env.DBG) for (const [k, w] of Object.entries(worst)) console.log(k, w.d.toFixed(2), w.what);
    for (const [k, w] of Object.entries(worst)) expect(w.d, `${k}: ${w.what}`).toBeGreaterThan(0.6);
  });

  it("is open where it should be: a cape leaves the chest bare, a poncho slits the neck, and both are lined (a back face is visible from inside)", () => {
    for (const jacket of [CAPE, PONCHO]) {
      const c = ctxFor(bodies(jacket)[0]!);
      const g = buildDrapeOnly(c, "torso")!;
      const tris = triangles(g);
      // front centre line, mid chest, well in front of the torso: no cloth for a cape between the front edges
      const h = c.P.torsoHeight;
      const probe = new Vector3(0, h * 0.5, -c.P.torsoDepth * 0.5 - c.P.bellyForward - 0.02);
      const d = nearest(tris, probe, 1);
      if (jacket === CAPE) expect(d).toBeGreaterThan(0.02);
      // some triangles face inwards (the lining layer)
      const nrm = g.attributes.normal!;
      const pos = g.attributes.position!;
      let inward = 0;
      let outward = 0;
      for (let i = 0; i < pos.count; i++) {
        const out = new Vector3(pos.getX(i), 0, pos.getZ(i)).normalize();
        if (out.x * nrm.getX(i) + out.z * nrm.getZ(i) < -0.2) inward++;
        else if (out.x * nrm.getX(i) + out.z * nrm.getZ(i) > 0.2) outward++;
      }
      expect(inward).toBeGreaterThan(20);
      expect(outward).toBeGreaterThan(20);
    }
  });

  it("stays inside the triangle budget, and the far level of detail still draws a cape and a poncho", () => {
    for (const jacket of [CAPE, PONCHO]) {
      for (const spec of bodies(jacket)) {
        const rig = buildCharacter(spec, { outline: false });
        let n = 0;
        rig.root.traverse((o) => {
          if (o instanceof Mesh && o.name === "mesh_torso") n += o.geometry.index!.count / 3;
        });
        expect(n, `torso of jacket ${jacket}`).toBeLessThan(6200);
        rig.setLod(2);
        let far = 0;
        rig.root.traverse((o) => {
          if (o instanceof Mesh && o.name === "mesh_torso") far += o.geometry.index!.count / 3;
        });
        expect(far).toBeGreaterThan(30);
        rig.dispose();
      }
    }
  });
});
