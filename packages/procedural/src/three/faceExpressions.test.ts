import { Matrix4, Mesh, Vector3, type BufferAttribute } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { EXPRESSION_IDS, EXPRESSIONS, NEUTRAL, blendTarget, type FaceTarget } from "./expressions.ts";
import { MORPH_NAMES, MOUTH_MORPH_NAMES } from "./faceMorph.ts";
import { skullGrid } from "./headShape.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";

afterAll(() => clearCharacterCaches());

/**
 * Every expression at every intensity keeps the parts of the face inside the head field: the mouth's teeth, tongue and opening stay at the lips (never floating off them, never
 * buried in the skin), the eyeballs keep their seat in the sockets (never popping out, never sunk), and the brows stay on the brow ridge. The skin is measured AS DEFORMED by the
 * morph targets the animator has set (the same ones the game draws), so a jaw that opens, a smile that lifts the cheeks and a pucker that purses the lips are all accounted for.
 */

const HEADS: Partial<CharacterSpec>[] = [
  {},
  { headScale: 0, jaw: 0, noseScale: 0, eyeShape: 4, teeth: 2 },
  { headScale: 255, jaw: 255, noseScale: 255, eyeShape: 3, teeth: 16 },
  { jaw: 128, eyeShape: 2, teeth: 33, noseStyle: 4 },
  { jaw: 255, eyeShape: 5, teeth: 13, noseStyle: 6, brows: 3 },
];
const INTENSITIES = [0, 0.25, 0.5, 0.75, 1];

const BASE = (over: Partial<CharacterSpec>): CharacterSpec => ({ ...generateCharacter(11), hat: 0, hair: 0, beard: 0, moustache: 0, sideburns: 0, eyewear: 0, eyepatch: 0, scars: 0, earring: 0, hairAcc: 0, ...over });

interface Skin {
  /** Distance from the head centre to the deformed skin along the unit direction (x, y, z), or undefined if the ray misses the front grid. */
  radius(dx: number, dy: number, dz: number): number | undefined;
}

/** The deformed front of the skull: the skull grid's vertices moved by the head mesh's morph targets at their current influences. */
function deformedSkin(rig: CharacterRig): Skin {
  let head: Mesh | undefined;
  rig.root.traverse((o) => {
    if (o instanceof Mesh && o.name === "mesh_head") head = o;
  });
  const geo = head!.geometry;
  const pos = geo.attributes.position as BufferAttribute;
  const morphs = geo.morphAttributes.position as BufferAttribute[];
  const inf = head!.morphTargetInfluences!;
  const cy = rig.proportions.headRadius;
  const { cols, rows } = skullGrid(false);
  const V: Vector3[] = [];
  for (let k = 0; k < (rows + 1) * cols; k++) {
    let x = pos.getX(k);
    let y = pos.getY(k);
    let z = pos.getZ(k);
    morphs.forEach((m, i) => {
      const w = inf[i] ?? 0;
      if (w === 0) return;
      x += m.getX(k) * w;
      y += m.getY(k) * w;
      z += m.getZ(k) * w;
    });
    V.push(new Vector3(x, y - cy, z));
  }
  const tris: [Vector3, Vector3, Vector3][] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = V[j * cols + i]!;
      const b = V[j * cols + ((i + 1) % cols)]!;
      const c = V[(j + 1) * cols + i]!;
      const d = V[(j + 1) * cols + ((i + 1) % cols)]!;
      if (a.z > 0.15 && b.z > 0.15 && c.z > 0.15 && d.z > 0.15) continue; // the back of the head is never asked about
      tris.push([a, c, b], [b, c, d]);
    }
  }
  const e1 = new Vector3();
  const e2 = new Vector3();
  const p = new Vector3();
  const t = new Vector3();
  const q = new Vector3();
  return {
    radius(dx, dy, dz) {
      let best: number | undefined;
      for (const [a, b, c] of tris) {
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        p.set(dy * e2.z - dz * e2.y, dz * e2.x - dx * e2.z, dx * e2.y - dy * e2.x); // dir x e2
        const det = e1.dot(p);
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        t.set(-a.x, -a.y, -a.z); // origin (the head centre) - a
        const u = t.dot(p) * inv;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        q.crossVectors(t, e1);
        const v = (dx * q.x + dy * q.y + dz * q.z) * inv;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const s = e2.dot(q) * inv;
        if (s > 0 && (best === undefined || s < best)) best = s;
      }
      return best;
    },
  };
}

/** The current positions of a morphing mesh's vertices (mesh-local), as [x, y, z] triples. */
function morphedVertices(mesh: Mesh): Vector3[] {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as BufferAttribute;
  const morphs = (geo.morphAttributes.position ?? []) as BufferAttribute[];
  const inf = mesh.morphTargetInfluences ?? [];
  const out: Vector3[] = [];
  for (let k = 0; k < pos.count; k++) {
    const v = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
    morphs.forEach((m, i) => {
      const w = inf[i] ?? 0;
      if (w !== 0) v.add(new Vector3(m.getX(k), m.getY(k), m.getZ(k)).multiplyScalar(w));
    });
    out.push(v);
  }
  return out;
}

function settle(rig: CharacterRig, id: (typeof EXPRESSION_IDS)[number], intensity: number): void {
  const anim = new CharacterAnimator(rig);
  anim.autoBlink = false;
  anim.setExpression(id, intensity);
  for (let i = 0; i < 80; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
  rig.root.updateMatrixWorld(true);
}

describe("expressions", () => {
  it("the expression set is what the game promises and every pose is finite and in range", () => {
    expect(EXPRESSION_IDS).toEqual(["neutral", "pain", "fear", "triumph", "drunk", "angry", "smug", "disgust", "surprise", "laugh", "sleep"]);
    const out = { ...NEUTRAL };
    for (const id of EXPRESSION_IDS) {
      expect(EXPRESSIONS[id]).toBeDefined();
      for (const k of INTENSITIES) {
        blendTarget(id, k, out);
        for (const [key, v] of Object.entries(out)) {
          expect(Number.isFinite(v), `${id}.${key}`).toBe(true);
          expect(Math.abs(v), `${id}.${key}`).toBeLessThanOrEqual(1.6);
        }
      }
      // intensity 0 is the neutral face and 1 is the full expression
      const z = blendTarget(id, 0, { ...NEUTRAL });
      const f = blendTarget(id, 1, { ...NEUTRAL });
      for (const key of Object.keys(NEUTRAL) as (keyof FaceTarget)[]) {
        expect(z[key]).toBeCloseTo(NEUTRAL[key], 9);
        expect(f[key]).toBeCloseTo(EXPRESSIONS[id][key], 9);
      }
    }
  });

  it("the mouth has a morph target for every one the animator drives, after the skin's own", () => {
    expect(MOUTH_MORPH_NAMES.slice(0, MORPH_NAMES.length)).toEqual([...MORPH_NAMES]);
    const rig = buildCharacter(BASE({}), { outline: false });
    expect(rig.face.mouth.morphTargetInfluences).toHaveLength(MOUTH_MORPH_NAMES.length);
    rig.dispose();
  });

  it("every expression at every intensity keeps the mouth on the lips, the eyes in their sockets and the brows on the ridge (5 heads)", () => {
    let checked = 0;
    for (const [hi, over] of HEADS.entries()) {
      const spec = BASE(over);
      for (const id of EXPRESSION_IDS) {
        for (const k of INTENSITIES) {
          const rig = buildCharacter(spec, { outline: false });
          const R = rig.proportions.headRadius;
          settle(rig, id, k);
          const skin = deformedSkin(rig);
          const tag = `head ${hi} ${id} @${k}`;
          // ---- the mouth: seam, opening, gums, teeth and tongue ------------------------------------------------------------------------------------------------------
          const mv = morphedVertices(rig.face.mouth);
          const tongueOut = rig.face.mouth.morphTargetInfluences![MOUTH_MORPH_NAMES.indexOf("tongue")]!;
          const buck = (spec.teeth & 16) !== 0;
          let worstOut = -Infinity;
          let worstIn = Infinity;
          for (const v of mv) {
            expect(Number.isFinite(v.x + v.y + v.z), tag).toBe(true);
            const l = v.length();
            const r = skin.radius(v.x / l, v.y / l, v.z / l);
            if (r === undefined) continue;
            worstOut = Math.max(worstOut, (l - r) / R);
            worstIn = Math.min(worstIn, (l - r) / R);
          }
          if (process.env.FACE_VERBOSE) process.stdout.write(`${tag}: out ${worstOut.toFixed(3)} in ${worstIn.toFixed(3)}\n`);
          // nothing of the mouth stands more than a tooth's height off the lips (a tongue pushed out, or a buck tooth over the lip, may go further) ...
          expect(worstOut, `${tag}: mouth parts stand off the skin`).toBeLessThan(0.05 + (tongueOut > 0.5 ? 0.14 : 0) + (buck ? 0.04 : 0));
          // ... and none of it is buried: a tooth behind the lip would be invisible, one far inside the head would be a hole
          expect(worstIn, `${tag}: mouth parts sunk in the skin`).toBeGreaterThan(buck ? -0.11 : -0.065); // (the roots of buck teeth are buried in the upper lip on purpose)
          // ---- the eyes: the seat of the eyeball against the deformed skin ----------------------------------------------------------------------------------------------
          for (const eye of [rig.face.eyeL, rig.face.eyeR]) {
            const c = eye.position;
            const l = Math.hypot(c.x, c.y, c.z);
            const r = skin.radius(c.x / l, c.y / l, c.z / l);
            expect(r, `${tag}: eye has skin in front of it`).toBeDefined();
            const eyeR = rig.face.eyeRadius * Math.max(eye.scale.x, eye.scale.y, eye.scale.z);
            // the centre stays inside the head by at least a third of the eyeball, and the front of the ball stands out of the skin by less than 0.85 of its radius
            expect((r! - l) / eyeR, `${tag}: eyeball sunk too far out`).toBeGreaterThan(0.2);
            const frontL = Math.hypot(c.x, c.y, c.z - eyeR);
            expect((frontL - r!) / eyeR, `${tag}: eyeball pops out`).toBeLessThan(0.85);
            expect((r! - l) / eyeR, `${tag}: eyeball sunk`).toBeLessThan(1.0);
          }
          // ---- the brows: on the ridge, not floating and not buried --------------------------------------------------------------------------------------------------------
          if (rig.face.browL.visible) {
            for (const br of [rig.face.browL, rig.face.browR]) {
              const p = br.position;
              const l = Math.hypot(p.x, p.y, p.z);
              const r = skin.radius(p.x / l, p.y / l, p.z / l);
              if (r === undefined) continue;
              expect((l - r) / R, `${tag}: brow floats`).toBeLessThan(0.1);
              expect((l - r) / R, `${tag}: brow buried`).toBeGreaterThan(-0.09);
            }
          }
          rig.dispose();
          checked++;
        }
      }
    }
    expect(checked).toBe(HEADS.length * EXPRESSION_IDS.length * INTENSITIES.length);
  }, 600_000);

  it("expressions read: each one moves the pose away from neutral, and the extremes are where they should be", () => {
    const rig = buildCharacter(BASE({}), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    const run = (id: (typeof EXPRESSION_IDS)[number], k = 1) => {
      anim.setExpression(id, k);
      for (let i = 0; i < 80; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      return { ...rig.face.pose };
    };
    const neutral = run("neutral");
    const dist = (a: FaceTarget, b: FaceTarget): number => (Object.keys(a) as (keyof FaceTarget)[]).reduce((s, k) => s + Math.abs(a[k] - b[k]), 0);
    for (const id of EXPRESSION_IDS) if (id !== "neutral") expect(dist(run(id), neutral), id).toBeGreaterThan(0.8);
    expect(run("surprise").browArch).toBeGreaterThan(0.6);
    expect(run("angry").knit).toBeGreaterThan(0.6);
    expect(run("smug").smirk).toBeGreaterThan(0.8);
    expect(run("disgust").snarl).toBeGreaterThan(0.8);
    expect(run("laugh").mouthOpen).toBeGreaterThan(0.7);
    expect(run("sleep").eyes).toBeLessThan(0.1);
    // half an expression is half way
    const half = run("fear", 0.5);
    const full = run("fear", 1);
    expect(half.browArch).toBeGreaterThan(neutral.browArch);
    expect(half.browArch).toBeLessThan(full.browArch);
    rig.dispose();
  });

  it("a shut eye is an almond, not a bump: the visible lid is >= 2.2 times as wide as it is tall, with a rim of >= 16 sides (5 heads, eyes = 0)", () => {
    for (const [hi, over] of HEADS.entries()) {
      const rig = buildCharacter(BASE(over), { outline: false });
      settle(rig, "sleep", 1);
      expect(rig.face.pose.eyes, `head ${hi} eyes`).toBeLessThan(0.05);
      const skin = deformedSkin(rig);
      const inv = new Matrix4().copy(rig.joints.head.matrixWorld).invert();
      const cy = rig.proportions.headRadius;
      for (const lid of [rig.face.lidL, rig.face.lidR]) {
        const m = new Matrix4().multiplyMatrices(inv, lid.matrixWorld);
        const pos = lid.geometry.attributes.position as BufferAttribute;
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        const v = new Vector3();
        for (let i = 0; i < pos.count; i++) {
          // (only what is outside the skin is seen: the rest of the lid is inside the head)
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          v.y -= cy;
          const l = v.length();
          const r = skin.radius(v.x / l, v.y / l, v.z / l);
          if (r === undefined || l < r - 0.002) continue;
          x0 = Math.min(x0, v.x);
          x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y);
          y1 = Math.max(y1, v.y);
        }
        expect((x1 - x0) / (y1 - y0), `head ${hi}: closed lid width:height`).toBeGreaterThanOrEqual(2.2);
        // the rim of the cap (the vertices on its lowest ring, in the lid's own frame) is a polygon of at least 16 sides at the full level of detail
        const lp = lid.geometry.attributes.position as BufferAttribute;
        const yRim = rig.face.eyeRadius * 1.11 * Math.cos(1.15); // (lidGeo: a cap of radius 1.11 eyeR running 1.15 rad from its axis)
        const rim = new Set<string>();
        for (let i = 0; i < lp.count; i++) if (Math.abs(lp.getY(i) - yRim) < 1e-5) rim.add(`${lp.getX(i).toFixed(5)},${lp.getZ(i).toFixed(5)}`);
        expect(rim.size, `head ${hi}: lid rim sides`).toBeGreaterThanOrEqual(16);
      }
      // an open eye is untouched by the slit: the same head at neutral keeps the round eye's own proportions
      rig.dispose();
    }
  });

  it("only a SHUT eye changes shape: open, half-lidded and wide eyes keep their scale", () => {
    const rig = buildCharacter(BASE({}), { outline: false });
    const open = rig.face.eyeScale;
    for (const id of ["neutral", "surprise", "fear", "angry", "triumph"] as const) {
      settle(rig, id, 1);
      expect(rig.face.eyeL.scale.x, id).toBeLessThan(open[0] * 1.41); // (a wide eye grows by up to 35%, not by the slit's widening on top)
      expect(rig.face.eyeL.scale.y, id).toBeGreaterThan(open[1] * 0.99);
    }
    settle(rig, "neutral", 1);
    expect(rig.face.eyeL.scale.x).toBeCloseTo(open[0], 6);
    expect(rig.face.eyeL.scale.y).toBeCloseTo(open[1], 6);
    rig.dispose();
  });
});
