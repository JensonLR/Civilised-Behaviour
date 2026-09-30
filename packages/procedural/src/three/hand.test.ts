import { Box3, BufferGeometry, Mesh, Vector3 } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG, LIMB } from "@cb/shared";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { HandPoser, handGripTargets } from "./animatorExtras.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";
import { PartBuilder } from "./parts.ts";

afterAll(() => clearCharacterCaches());

const arm = (rig: CharacterRig, side: "L" | "R"): Mesh => {
  let found: Mesh | undefined;
  rig.root.traverse((o) => o instanceof Mesh && o.name === `mesh_hand${side}` && (found = o));
  return found!;
};

/** The forearm's vertex positions with the two grip morph targets applied at the given influences. */
function posed(geo: BufferGeometry, inf: readonly number[]): Float32Array {
  const p = geo.attributes.position!;
  const out = new Float32Array(p.array as Float32Array);
  geo.morphAttributes.position!.forEach((m, k) => {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (m.array[i] as number) * (inf[k] ?? 0);
  });
  return out;
}
const box = (a: Float32Array, from = 0): Box3 => {
  const b = new Box3();
  const v = new Vector3();
  for (let i = from; i < a.length / 3; i++) b.expandByPoint(v.set(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!));
  return b;
};

const plain = (seed: number, over: Partial<CharacterSpec> = {}): CharacterSpec => ({ ...generateCharacter(seed), jacket: 0, gloves: 0, hook: 0, woodenLeg: 0, ...over });

describe("hands", () => {
  it("a full-detail forearm carries two grip morph targets (positions and normals, relative), the crowd levels carry none", () => {
    const rig = buildCharacter(plain(5), { outline: false });
    for (const side of ["L", "R"] as const) {
      const g = arm(rig, side).geometry;
      expect(g.morphAttributes.position).toHaveLength(2);
      expect(g.morphAttributes.normal).toHaveLength(2);
      expect(g.morphTargetsRelative).toBe(true);
      for (const m of [...g.morphAttributes.position!, ...g.morphAttributes.normal!]) {
        expect(m.count).toBe(g.attributes.position!.count);
        for (let i = 0; i < m.array.length; i++) expect(Number.isFinite(m.array[i])).toBe(true);
      }
      expect(arm(rig, side).morphTargetInfluences).toHaveLength(2);
    }
    rig.setLod(1);
    expect(arm(rig, "L").geometry.morphAttributes.position ?? []).toHaveLength(0);
    rig.setLod(2);
    expect(arm(rig, "R").geometry.morphAttributes.position ?? []).toHaveLength(0);
    rig.dispose();
  });

  it("setHandGrip is exact at 0, half and full, clamped, remembered across levels of detail, and moves only the hand", () => {
    const rig = buildCharacter(plain(6), { outline: false });
    const inf = () => [...arm(rig, "R").morphTargetInfluences!];
    expect(rig.handGrip("R")).toBe(0);
    rig.setHandGrip("R", 0.5);
    expect(inf()[0]).toBeCloseTo(1, 9);
    expect(inf()[1]).toBeCloseTo(0, 9);
    rig.setHandGrip("R", 1);
    expect(inf()[0]).toBeCloseTo(0, 9);
    expect(inf()[1]).toBeCloseTo(1, 9);
    rig.setHandGrip("R", 7);
    expect(rig.handGrip("R")).toBe(1);
    rig.setHandGrip("R", Number.NaN);
    expect(rig.handGrip("R")).toBe(0);
    rig.setHandGrip("R", 0.75);
    expect(rig.handGrip("L")).toBe(0);
    expect([...arm(rig, "L").morphTargetInfluences!]).toEqual([0, 0]);
    rig.setLod(1);
    rig.setLod(0);
    expect(rig.handGrip("R")).toBe(0.75);
    const w = inf();
    expect(w[0]).toBeCloseTo(4 * 0.75 * 0.25, 9);
    expect(w[1]).toBeCloseTo(0.75 * 0.5, 9);
    rig.dispose();
  });

  it("a fist is shorter and more compact than a relaxed hand, and the fingers really move (every finger vertex is in the same place at grip 0 and elsewhere at grip 1)", () => {
    for (const seed of [3, 9, 21]) {
      const rig = buildCharacter(plain(seed), { outline: false });
      const g = arm(rig, "R").geometry;
      const open = posed(g, [0, 0]);
      const half = posed(g, [1, 0]);
      const fist = posed(g, [0, 1]);
      const handTop = 0; // the wrist (the hand bone's origin)
      const below = (a: Float32Array): Box3 => {
        // the hand: everything below the wrist
        const b = new Box3();
        const v = new Vector3();
        for (let i = 0; i < a.length / 3; i++) if (a[i * 3 + 1]! < handTop - 0.005) b.expandByPoint(v.set(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!));
        return b;
      };
      const bo = below(open);
      const bh = below(half);
      const bf = below(fist);
      expect(bo.max.y - bo.min.y).toBeGreaterThan(0);
      // the relaxed hand hangs lower than a half grip, which hangs lower than a fist
      expect(bf.min.y).toBeGreaterThan(bo.min.y + rig.proportions.handRadius * 0.4);
      expect(bh.min.y).toBeGreaterThan(bo.min.y);
      expect(bh.min.y).toBeLessThan(bf.min.y + 1e-6);
      // some vertices moved a lot, most (the sleeve) not at all
      let moved = 0;
      let still = 0;
      for (let i = 0; i < open.length / 3; i++) {
        const d = Math.hypot(open[i * 3]! - fist[i * 3]!, open[i * 3 + 1]! - fist[i * 3 + 1]!, open[i * 3 + 2]! - fist[i * 3 + 2]!);
        if (d > rig.proportions.handRadius * 0.3) moved++;
        else if (d < 1e-6) still++;
      }
      expect(moved).toBeGreaterThan(40);
      expect(still).toBeGreaterThan(open.length / 3 / 8); // (the palm and the ball of the wrist stay)
      // a fist stays a compact thing: no finger flies off (the whole hand is at most ~3 hand radii tall, ~2 wide)
      const hr = rig.proportions.handRadius;
      expect(bf.max.y - bf.min.y).toBeLessThan(hr * 2.9);
      expect(bf.max.x - bf.min.x).toBeLessThan(hr * 2.6);
      expect(bf.max.z - bf.min.z).toBeLessThan(hr * 2.6);
      rig.dispose();
    }
  });

  it("has fingers: a full-detail hand is a palm, four fingers and a thumb (a mitten has one mass and a thumb), crowd levels a single fist", () => {
    const count = (spec: CharacterSpec, lod: 0 | 1): number => {
      clearCharacterCaches();
      PartBuilder.audit = [];
      const rig = buildCharacter(spec, { outline: false, lod });
      const sweeps = PartBuilder.audit.filter((a) => a.tag === "handR" && a.kind === "sweep").length;
      PartBuilder.audit = undefined;
      rig.dispose();
      return sweeps;
    };
    expect(count(plain(4), 0)).toBeGreaterThanOrEqual(5);
    expect(count(plain(4, { gloves: 5 }), 0)).toBeLessThanOrEqual(2);
    expect(count(plain(4), 1)).toBe(0);
  });

  it("every glove, ring and tattoo keeps the hand well formed and morphable, and a hook hand has nothing to grip", () => {
    for (let gloves = 0; gloves <= 5; gloves++) {
      for (const ring of [0, 1, 2, 3, 4]) {
        const rig = buildCharacter(plain(11, { gloves, ring, tattoo: gloves === 0 ? 2 : 0 }), { outline: false });
        for (const side of ["L", "R"] as const) {
          const g = arm(rig, side).geometry;
          expect(g.morphAttributes.position, `gloves ${gloves} ring ${ring}`).toHaveLength(2);
          for (const inf of [[0, 0], [1, 0], [0, 1]]) {
            const a = posed(g, inf);
            for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i])).toBe(true);
          }
        }
        rig.dispose();
      }
    }
    const hooked = buildCharacter(plain(11, { hook: 2 }), { outline: false });
    expect(arm(hooked, "R")).toBeUndefined(); // (the hook replaces the hand: no hand bone mesh, and nothing to grip)
    expect(arm(hooked, "L").geometry.morphAttributes.position).toHaveLength(2);
    hooked.setHandGrip("R", 1); // (nothing to close: must not throw)
    hooked.dispose();
  });

  it("a severed forearm keeps the grip it had", () => {
    const rig = buildCharacter(plain(8), { outline: false });
    rig.setHandGrip("L", 1);
    const limb = rig.detachLimb(LIMB.ARM_L);
    expect(limb).toBeDefined();
    let ok = false;
    limb!.traverse((o) => {
      if (o instanceof Mesh && o.morphTargetInfluences?.length === 2 && o.morphTargetInfluences[1]! > 0.99) ok = true;
    });
    expect(ok).toBe(true);
    rig.dispose();
  });
});

describe("the hand is its own bone", () => {
  it("wristL and wristR hang from the elbows at the end of the forearm, carry the hand mesh (and its outline), and the hand turns with the wrist", () => {
    const rig = buildCharacter(plain(5));
    const P = rig.proportions;
    for (const side of ["L", "R"] as const) {
      const wrist = rig.joints[`wrist${side}`];
      expect(wrist.parent).toBe(rig.joints[`elbow${side}`]);
      expect(wrist.position.y).toBeCloseTo(-P.armLower, 9);
      expect(arm(rig, side).parent).toBe(wrist);
      let ink = 0;
      wrist.traverse((o) => o instanceof Mesh && o.name === `outline_hand${side}` && ink++);
      expect(ink).toBe(1);
    }
    // turning the wrist swings the hand (its fingertips) and leaves the forearm where it is
    rig.root.updateMatrixWorld(true);
    const tip = (): Vector3 => rig.joints.wristR.localToWorld(new Vector3(0, -P.handRadius * 1.5, 0));
    const forearmEnd = (): Vector3 => rig.joints.elbowR.localToWorld(new Vector3(0, -P.armLower * 0.5, 0));
    const t0 = tip();
    const f0 = forearmEnd();
    rig.joints.wristR.rotation.x = 0.9;
    rig.root.updateMatrixWorld(true);
    expect(tip().distanceTo(t0)).toBeGreaterThan(P.handRadius * 0.9);
    expect(forearmEnd().distanceTo(f0)).toBeLessThan(1e-9);
    rig.dispose();
  });

  it("a turned wrist never opens the sleeve: the palm's ball stays inside the sleeve's end (and the hand's own vertices stay within reach of the wrist joint) at every turn in range", () => {
    for (const seed of [3, 9, 21]) {
      const rig = buildCharacter(plain(seed), { outline: false });
      const g = arm(rig, "R").geometry;
      const pos = g.attributes.position!;
      const P = rig.proportions;
      // the ball: every hand vertex above the wrist joint lies within the wrist's radius of the joint (a sphere about the pivot is unchanged by any turn)
      let above = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 0.002) {
          above++;
          const d = Math.hypot(pos.getX(i), y, pos.getZ(i));
          expect(d, `seed ${seed} vertex ${i}`).toBeLessThan(Math.max(P.handRadius * 0.5, P.armRadius * 0.9));
        }
      }
      expect(above).toBeGreaterThan(4);
      rig.dispose();
    }
  });

  it("a lost arm takes its hand with it, a far level draws the fist on the forearm (no hand mesh), and coming back to full detail restores the hand", () => {
    const rig = buildCharacter(plain(6), { outline: true });
    const vis = (name: string): boolean => {
      let v = false;
      rig.root.traverse((o) => {
        if (o.name === name) {
          let on = true;
          for (let n: typeof o | null = o; n; n = n.parent as typeof o | null) if (!n.visible) on = false;
          v = on;
        }
      });
      return v;
    };
    expect(vis("mesh_handL")).toBe(true);
    rig.setMissing(LIMB.ARM_L);
    expect(vis("mesh_handL")).toBe(false);
    expect(vis("outline_handL")).toBe(false);
    expect(vis("mesh_handR")).toBe(true);
    rig.setMissing(0);
    expect(vis("mesh_handL")).toBe(true);
    expect(vis("outline_handL")).toBe(true);
    rig.setLod(2);
    expect(vis("mesh_handL")).toBe(false);
    expect(vis("outline_handL")).toBe(false);
    expect(vis("mesh_foreArmL")).toBe(true);
    rig.setLod(1);
    expect(vis("mesh_handL")).toBe(true);
    rig.setLod(2);
    rig.setLod(0);
    expect(vis("mesh_handR")).toBe(true);
    expect(arm(rig, "R").geometry.morphAttributes.position).toHaveLength(2);
    rig.dispose();
  });
});

describe("HandPoser", () => {
  it("angry and triumphant hands are fists, a carried load is gripped, fear opens the hands, and a held weapon decides its own grip", () => {
    const base = { flags: FLAG.GROUNDED, speed: 0 };
    expect(handGripTargets({ ...base, expression: "neutral" }).L).toBeLessThan(0.2);
    expect(handGripTargets({ ...base, expression: "angry" })).toEqual({ L: 1, R: 1 });
    expect(handGripTargets({ ...base, expression: "triumph" })).toEqual({ L: 1, R: 1 });
    expect(handGripTargets({ ...base, flags: FLAG.GROUNDED | FLAG.CARRYING, expression: "neutral" }).R).toBeGreaterThan(0.8);
    expect(handGripTargets({ ...base, expression: "fear" }).L).toBeLessThan(0.5);
    expect(handGripTargets({ ...base, expression: "pain" }).R).toBe(1);
    expect(handGripTargets({ ...base, speed: 7, flags: FLAG.GROUNDED | FLAG.SPRINTING, expression: "neutral" }).L).toBeGreaterThan(0.6);
    const held = handGripTargets({ ...base, expression: "angry", holdR: 0.8 });
    expect(held.R).toBe(0.8);
    expect(held.L).toBe(1);
  });

  it("eases toward its target (closing faster than opening), never overshoots, and ignores a bad step", () => {
    const rig = buildCharacter(plain(2), { outline: false });
    const poser = new HandPoser(rig);
    let last = 0;
    for (let i = 0; i < 40; i++) {
      poser.update(1 / 30, FLAG.GROUNDED, 0, "angry");
      const g = rig.handGrip("L");
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g).toBeLessThanOrEqual(1);
      last = g;
    }
    expect(last).toBeGreaterThan(0.98);
    poser.update(Number.NaN, FLAG.GROUNDED, 0, "neutral");
    expect(rig.handGrip("L")).toBe(last);
    for (let i = 0; i < 10; i++) poser.update(1 / 30, FLAG.GROUNDED, 0, "neutral");
    const opening = rig.handGrip("L");
    expect(opening).toBeLessThan(last);
    expect(opening).toBeGreaterThan(0.1); // (slower than closing: 10 frames do not undo 40)
    rig.dispose();
  });
});
