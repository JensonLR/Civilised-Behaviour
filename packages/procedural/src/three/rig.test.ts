import { Box3, Mesh, Vector3 } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { MAX_HALF_WIDTH } from "../proportions.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";
import { CharacterAnimator, type ExpressionId } from "./animator.ts";

const triangles = (rig: CharacterRig): number => {
  let t = 0;
  rig.root.traverse((o) => {
    if (o instanceof Mesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
  });
  return t;
};

const bounds = (rig: CharacterRig): Box3 => {
  rig.root.updateMatrixWorld(true);
  return new Box3().setFromObject(rig.root);
};

afterAll(() => clearCharacterCaches());

describe("buildCharacter", () => {
  it("builds every seed without error, within draw-call and triangle budgets", () => {
    let maxTris = 0;
    let maxMeshes = 0;
    let sumTris = 0;
    const N = 150;
    for (let seed = 0; seed < N; seed++) {
      const rig = buildCharacter(generateCharacter(seed));
      const t = triangles(rig);
      maxTris = Math.max(maxTris, t);
      sumTris += t;
      maxMeshes = Math.max(maxMeshes, rig.meshCount);
      rig.dispose();
    }
    // Budgets: recorded in docs/PERFORMANCE.md; tighten when LOD lands (M4/M12).
    expect(maxMeshes).toBeLessThanOrEqual(20);
    expect(maxTris).toBeLessThan(9000); // measured 2026-09-29: avg 5.9k, max 7.6k
    expect(sumTris / N).toBeLessThan(7000);
  });

  it("bone geometry carries vertex colours and normals, and no UVs", () => {
    const rig = buildCharacter(generateCharacter(5));
    let bones = 0;
    rig.root.traverse((o) => {
      if (o instanceof Mesh && o.name.startsWith("mesh_")) {
        bones++;
        expect(o.geometry.attributes.color).toBeDefined();
        expect(o.geometry.attributes.normal).toBeDefined();
        expect(o.geometry.attributes.uv).toBeUndefined();
      }
    });
    expect(bones).toBeGreaterThanOrEqual(9);
  });

  it("stands on the ground and stays inside the gameplay envelope (excluding headwear)", () => {
    for (let seed = 0; seed < 120; seed++) {
      const spec = { ...generateCharacter(seed), hat: 0 };
      const rig = buildCharacter(spec);
      const b = bounds(rig);
      expect(b.min.y).toBeGreaterThan(-0.08);
      expect(b.min.y).toBeLessThan(0.05);
      // Head top may exceed the nominal height slightly (hair, skull ellipsoid) but never wildly.
      expect(b.max.y).toBeLessThan(rig.proportions.totalHeight + 0.3);
      expect(b.max.y).toBeGreaterThan(rig.proportions.totalHeight - 0.35);
      const half = Math.max(b.max.x, -b.min.x);
      expect(half).toBeLessThanOrEqual(MAX_HALF_WIDTH + 0.22); // ears, belly, moustache flourishes
      rig.dispose();
    }
  });

  it("identical specs share GPU geometry (crowds are cheap)", () => {
    const spec = generateCharacter(42);
    const a = buildCharacter(spec);
    const b = buildCharacter(spec);
    const geosA = new Set<unknown>();
    a.root.traverse((o) => o instanceof Mesh && o.name.startsWith("mesh_") && geosA.add(o.geometry));
    let shared = 0;
    b.root.traverse((o) => o instanceof Mesh && o.name.startsWith("mesh_") && geosA.has(o.geometry) && shared++);
    expect(shared).toBe(geosA.size);
  });

  it("dispose leaves shared bone geometry usable", () => {
    const spec = generateCharacter(9);
    const a = buildCharacter(spec);
    a.dispose();
    const b = buildCharacter(spec);
    expect(triangles(b)).toBeGreaterThan(1000);
  });

  it("history fields change the mesh (scars, eyepatch, wooden leg, burnt clothing)", () => {
    const base = generateCharacter(3);
    const plain = triangles(buildCharacter(base));
    const marked = triangles(buildCharacter({ ...base, scars: 31, eyepatch: 1, woodenLeg: 2, teeth: 3, burnt: 3, medals: 5 }));
    expect(marked).not.toBe(plain);
  });
});

describe("CharacterAnimator", () => {
  const exprs: ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry"];

  it("never produces NaN across random poses, expressions and long runs", () => {
    const rig = buildCharacter(generateCharacter(7));
    const anim = new CharacterAnimator(rig);
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 4000; i++) {
      if (i % 100 === 0) anim.setExpression(exprs[Math.floor(rnd() * exprs.length)]!);
      const flags = [FLAG.GROUNDED, 0, FLAG.GROUNDED | FLAG.CROUCHING, FLAG.GROUNDED | FLAG.CARRYING, FLAG.GROUNDED | FLAG.DOWNED, FLAG.GROUNDED | FLAG.SPRINTING][Math.floor(rnd() * 6)]!;
      anim.update(1 / 30 + rnd() * 0.02, { speed: rnd() * 8, flags, vy: rnd() * 10 - 5 });
    }
    rig.root.traverse((o) => {
      for (const v of [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x]) expect(Number.isFinite(v)).toBe(true);
    });
  });

  it("gait is distance-locked: legs swing more the faster you move, and stop at rest", () => {
    const rig = buildCharacter(generateCharacter(2));
    const anim = new CharacterAnimator(rig);
    const swingAt = (speed: number): number => {
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        anim.update(1 / 30, { speed, flags: FLAG.GROUNDED, vy: 0 });
        peak = Math.max(peak, Math.abs(rig.joints.hipL.rotation.x));
      }
      return peak;
    };
    const rest = swingAt(0);
    const walk = swingAt(2.2);
    const run = swingAt(4.4);
    expect(rest).toBeLessThan(0.05);
    expect(walk).toBeGreaterThan(rest + 0.15);
    expect(run).toBeGreaterThan(walk);
  });

  it("downed lays the figure on its back, carrying raises the arms", () => {
    const rig = buildCharacter(generateCharacter(2));
    const anim = new CharacterAnimator(rig);
    for (let i = 0; i < 90; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED | FLAG.DOWNED, vy: 0 });
    expect(rig.root.rotation.x).toBeLessThan(-1.2);
    const rig2 = buildCharacter(generateCharacter(2));
    const anim2 = new CharacterAnimator(rig2);
    for (let i = 0; i < 90; i++) anim2.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED | FLAG.CARRYING, vy: 0 });
    expect(rig2.joints.shoulderL.rotation.x).toBeLessThan(-0.9);
  });

  it("expressions move the face: fear raises brows, pain closes eyes, triumph smiles", () => {
    const rig = buildCharacter(generateCharacter(2));
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false; // sample expressions, not blinks
    const run = (e: ExpressionId) => {
      anim.setExpression(e);
      for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      return { brow: rig.face.browL.position.y, lid: rig.face.lidL.rotation.x, smile: rig.face.mouth.rotation.z };
    };
    const neutral = run("neutral");
    const fear = run("fear");
    const pain = run("pain");
    const triumph = run("triumph");
    expect(fear.brow).toBeGreaterThan(neutral.brow);
    expect(pain.lid).toBeLessThan(neutral.lid - 0.5); // lid rotated toward closed
    expect(triumph.smile).toBeCloseTo(Math.PI, 3);
    expect(pain.smile).toBeCloseTo(0, 3); // frown
  });

  void Vector3;
});
