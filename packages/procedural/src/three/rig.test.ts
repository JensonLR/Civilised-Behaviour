import { Box3, Mesh, Vector3, type Object3D } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG, ZONE, ZONE_COUNT, setWound } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { MAX_HALF_WIDTH } from "../proportions.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";
import { CharacterAnimator, type ExpressionId } from "./animator.ts";

const shown = (o: Object3D): boolean => {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const triangles = (rig: CharacterRig): number => {
  let t = 0;
  rig.root.traverse((o) => {
    if (o instanceof Mesh && shown(o)) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
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
      const rig = buildCharacter(generateCharacter(seed), { outline: false });
      const t = triangles(rig);
      maxTris = Math.max(maxTris, t);
      sumTris += t;
      maxMeshes = Math.max(maxMeshes, rig.meshCount);
      rig.dispose();
    }
    // Budgets: recorded in docs/PERFORMANCE.md; tighten when LOD lands (M4/M12).
    expect(maxMeshes).toBeLessThanOrEqual(34); // measured below (12 bones + eyes, lids, brows, mouth)
    expect(maxTris).toBeLessThan(15000); // budget: LOD0 max <= ~15k tris without the outline hulls (docs/PERFORMANCE.md) // measured 2026-09-29 after gear, fingers and full-resolution shells: avg 9.2k, max 11.3k (crowds need the LOD in PERFORMANCE.md) // measured 2026-09-29 after the face sculpt: avg 7.5k, max 8.6k (body rebuild was 5.6k / 7.1k; the head is 3.3k of it)
    expect(sumTris / N).toBeLessThan(12000); // ... and avg <= ~12k // measured 2026-09-29 after cosmetics rebuild (shell beards, eyewear sweeps, surface sash): avg 7.8k, max 9.5k
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

describe("outline", () => {
  it("every bone has a closed, cheaper hull with smoothed outline normals (a missing outline once shipped silently)", () => {
    const rig = buildCharacter(generateCharacter(3), { outline: true });
    const mains = new Map<string, Mesh>();
    const hulls = new Map<string, Mesh>();
    rig.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (o.name.startsWith("mesh_")) mains.set(o.name.slice(5), o);
      if (o.name.startsWith("outline_")) hulls.set(o.name.slice(8), o);
    });
    expect(hulls.size).toBeGreaterThanOrEqual(9);
    for (const [bone, hull] of hulls) {
      const g = hull.geometry;
      expect(g.getAttribute("onormal"), `${bone} hull needs onormal`).toBeDefined();
      expect(g.getAttribute("color"), `${bone} hull is flat-coloured`).toBeUndefined();
      const on = g.getAttribute("onormal")!;
      for (let i = 0; i < on.count; i += Math.max(1, Math.floor(on.count / 20))) {
        expect(Math.hypot(on.getX(i), on.getY(i), on.getZ(i))).toBeCloseTo(1, 3);
      }
      const tris = (geo: typeof g) => (geo.index ? geo.index.count : geo.attributes.position!.count) / 3;
      expect(tris(g), `${bone} hull must be cheaper than the mesh it outlines`).toBeLessThan(tris(mains.get(bone)!.geometry));
    }
  });

  it("can be switched off, restoring the cheaper draw count", () => {
    const rig = buildCharacter(generateCharacter(4), { outline: true });
    const on = rig.meshCount;
    rig.setOutline(false);
    expect(rig.meshCount).toBeLessThan(on);
    rig.setOutline(true);
    expect(rig.meshCount).toBe(on);
    expect(buildCharacter(generateCharacter(4), { outline: false }).meshCount).toBeLessThan(on);
  });
});

describe("body construction", () => {
  /** Signed volume of an indexed mesh: negative means the faces point inward (it renders inside-out, black under an outline hull). */
  const volume = (g: import("three").BufferGeometry): number => {
    const p = g.attributes.position!;
    const ix = g.index!;
    let v = 0;
    for (let i = 0; i < ix.count; i += 3) {
      const a = ix.getX(i);
      const b = ix.getX(i + 1);
      const c = ix.getX(i + 2);
      v += (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) - p.getY(a) * (p.getX(b) * p.getZ(c) - p.getZ(b) * p.getX(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) / 6;
    }
    return v;
  };

  it("every bone mesh, main and outline hull, faces outward (regression: top-down limb lofts were inside-out)", () => {
    for (let seed = 0; seed < 30; seed++) {
      const rig = buildCharacter(generateCharacter(seed));
      rig.root.traverse((o) => {
        if (!(o instanceof Mesh) || !/^(mesh|outline)_(pelvis|torso|upperArm|foreArm|upperLeg|lowerLeg)/.test(o.name)) return;
        expect(volume(o.geometry), `${o.name} seed ${seed}`).toBeGreaterThan(0);
      });
      rig.dispose();
    }
  });

  it("vertex colours stay in range and geometry is finite for every jacket, trouser and boot combination", () => {
    for (let jacket = 0; jacket <= 5; jacket++) {
      for (let trousers = 0; trousers <= 3; trousers++) {
        for (let boots = 0; boots <= 3; boots++) {
          const spec = { ...generateCharacter(jacket * 16 + trousers * 4 + boots), jacket, trousers, boots };
          const rig = buildCharacter(spec, { outline: false });
          rig.root.traverse((o) => {
            if (!(o instanceof Mesh)) return;
            for (const name of ["position", "normal", "color"] as const) {
              const attr = o.geometry.attributes[name];
              if (!attr) continue;
              for (let i = 0; i < attr.array.length; i++) if (!Number.isFinite(attr.array[i])) throw new Error(`${o.name}.${name}[${i}] not finite`);
            }
          });
          rig.dispose();
        }
      }
    }
  });
});

describe("wounds", () => {
  const allZones = (sev: number): number => {
    let m = 0;
    for (let z = 0; z < ZONE_COUNT; z++) m = setWound(m, z, sev);
    return m;
  };
  const woundMeshes = (rig: CharacterRig): Mesh[] => {
    const out: Mesh[] = [];
    rig.root.traverse((o) => o instanceof Mesh && o.name.startsWith("wound_") && out.push(o));
    return out;
  };

  it("a clean body has no wound meshes; each wounded zone gets exactly one, on the right bone", () => {
    const rig = buildCharacter(generateCharacter(3), { outline: false });
    expect(woundMeshes(rig)).toHaveLength(0);
    const before = rig.meshCount;
    rig.setWounds(setWound(setWound(0, ZONE.HEAD, 2), ZONE.LEG_R, 1));
    const visible = woundMeshes(rig).filter((m) => m.visible);
    expect(visible).toHaveLength(2);
    expect(rig.meshCount).toBe(before + 2);
    const parents = visible.map((m) => m.parent!.name).sort();
    expect(parents).toEqual(["head", "hipR"]);
    rig.setWounds(0);
    expect(woundMeshes(rig).every((m) => !m.visible)).toBe(true);
    expect(rig.meshCount).toBe(before);
    rig.dispose();
  });

  it("higher severity means a bigger, more elaborate dressing", () => {
    const rig = buildCharacter(generateCharacter(4), { outline: false });
    const tris: number[] = [];
    for (const sev of [1, 2, 3]) {
      rig.setWounds(setWound(0, ZONE.TORSO, sev));
      const m = woundMeshes(rig).find((x) => x.visible)!;
      tris.push(m.geometry.index!.count / 3);
    }
    expect(tris[1]!).toBeGreaterThan(tris[0]!);
    expect(tris[2]!).toBeGreaterThan(tris[1]!);
    rig.dispose();
  });

  it("gore 'off' shows dressings but not a single red vertex; 'full' does", () => {
    const redVerts = (gore: "full" | "reduced" | "off"): number => {
      let red = 0;
      for (let seed = 0; seed < 12; seed++) {
        const rig = buildCharacter(generateCharacter(seed), { outline: false });
        rig.setWounds(allZones(3), gore);
        for (const m of woundMeshes(rig)) {
          const c = m.geometry.attributes.color!;
          for (let i = 0; i < c.count; i++) if (c.getX(i) > 0.25 && c.getY(i) < 0.35 * c.getX(i) && c.getZ(i) < 0.35 * c.getX(i)) red++;
        }
        expect(woundMeshes(rig).filter((m) => m.visible)).toHaveLength(ZONE_COUNT); // still readable: the dressings remain
        rig.dispose();
      }
      return red;
    };
    expect(redVerts("full")).toBeGreaterThan(100);
    expect(redVerts("off")).toBe(0);
  });

  it("wounds stay cheap: all six zones at severity 3 add < 2500 triangles, and never change the body's extents", () => {
    let worst = 0;
    for (let seed = 0; seed < 60; seed++) {
      const rig = buildCharacter(generateCharacter(seed), { outline: false });
      const base = triangles(rig);
      const box = bounds(rig);
      rig.setWounds(allZones(3));
      worst = Math.max(worst, triangles(rig) - base);
      const after = bounds(rig);
      // Dressings sit on the body (a few cm proud), so the envelope grows by well under 10 cm.
      expect(after.max.x - box.max.x).toBeLessThan(0.1);
      expect(after.max.y - box.max.y).toBeLessThan(0.1);
      rig.dispose();
    }
    expect(worst).toBeLessThan(2500); // measured 2026-09-29: ~2.0k for the (unrealistic) all-grievous case
  });

  it("the same wounds on a rebuilt rig reuse the cached geometry", () => {
    const spec = generateCharacter(8);
    const a = buildCharacter(spec, { outline: false });
    const b = buildCharacter(spec, { outline: false });
    a.setWounds(allZones(2));
    b.setWounds(allZones(2));
    const ga = woundMeshes(a).map((m) => m.geometry);
    const gb = woundMeshes(b).map((m) => m.geometry);
    expect(ga.length).toBe(ZONE_COUNT);
    ga.forEach((g, i) => expect(gb[i]).toBe(g));
    a.dispose();
    b.dispose();
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

  it("a badly wounded leg limps: that leg swings less than the healthy one, and the pelvis dips; healthy characters are symmetric", () => {
    const peaks = (wounds: number) => {
      const rig = buildCharacter(generateCharacter(2), { outline: false });
      const anim = new CharacterAnimator(rig);
      let l = 0;
      let r = 0;
      let dip = Infinity;
      let top = -Infinity;
      for (let i = 0; i < 150; i++) {
        anim.update(1 / 30, { speed: 2.2, flags: FLAG.GROUNDED, vy: 0, wounds });
        if (i > 60) {
          l = Math.max(l, Math.abs(rig.joints.hipL.rotation.x));
          r = Math.max(r, Math.abs(rig.joints.hipR.rotation.x));
          dip = Math.min(dip, rig.joints.pelvis.position.y);
          top = Math.max(top, rig.joints.pelvis.position.y);
        }
      }
      return { l, r, range: top - dip };
    };
    const healthy = peaks(0);
    expect(Math.abs(healthy.l - healthy.r)).toBeLessThan(0.02);
    const limping = peaks(setWound(0, ZONE.LEG_L, 3));
    expect(limping.l).toBeLessThan(limping.r * 0.8);
    expect(limping.range).toBeGreaterThan(healthy.range + 0.01);
    const arm = peaks(setWound(0, ZONE.ARM_L, 3)); // arm wounds do not affect the gait
    expect(Math.abs(arm.l - arm.r)).toBeLessThan(0.02);
    const scratch = peaks(setWound(0, ZONE.LEG_R, 1)); // a scratch is not a limp
    expect(Math.abs(scratch.l - scratch.r)).toBeLessThan(0.02);
  });

  it("idle life sways a standing character a little, and stops when they move", () => {
    const rig = buildCharacter(generateCharacter(2), { outline: false });
    const anim = new CharacterAnimator(rig);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 300; i++) {
      anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      lo = Math.min(lo, rig.joints.torso.rotation.z);
      hi = Math.max(hi, rig.joints.torso.rotation.z);
    }
    expect(hi - lo).toBeGreaterThan(0.01);
    expect(hi - lo).toBeLessThan(0.15);
    for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 4.4, flags: FLAG.GROUNDED, vy: 0 });
    expect(Math.abs(rig.joints.pelvis.position.x)).toBeLessThan(0.05); // the stride sways the hips a little, but the idle shift is gone
  });

  it("a flinch pushes the torso away from the blow and settles back to rest", () => {
    const rig = buildCharacter(generateCharacter(2), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false; // no ambient idle sway: this test measures the flinch spring alone
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    const rest = { x: rig.joints.torso.rotation.x, z: rig.joints.torso.rotation.z };
    anim.flinch(0, 1, 1); // shoved backwards (+z is behind the character)
    let maxBack = 0;
    for (let i = 0; i < 8; i++) {
      anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      maxBack = Math.max(maxBack, rig.joints.torso.rotation.x - rest.x);
    }
    expect(maxBack).toBeGreaterThan(0.1); // tilts back (the same sign the downed pose uses to fall onto its back)
    anim.flinch(1, 0, 1); // shoved to the character's +x side
    let maxSide = 0;
    for (let i = 0; i < 8; i++) {
      anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      maxSide = Math.max(maxSide, Math.abs(rig.joints.torso.rotation.z - rest.z));
    }
    expect(maxSide).toBeGreaterThan(0.1);
    for (let i = 0; i < 90; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    expect(Math.abs(rig.joints.torso.rotation.x - rest.x)).toBeLessThan(0.01);
    expect(Math.abs(rig.joints.torso.rotation.z - rest.z)).toBeLessThan(0.01);
    anim.flinch(NaN, 0, 5); // a bad network value never poisons the pose
    anim.flinch(0, Infinity, NaN);
    anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    expect(Number.isFinite(rig.joints.torso.rotation.x)).toBe(true);
    expect(Number.isFinite(rig.joints.head.rotation.x)).toBe(true);
  });

  it("the flinch spring stays stable on slow frames (a 10 fps machine must not blow the torso up)", () => {
    const rig = buildCharacter(generateCharacter(2), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    anim.flinch(0, 1, 1);
    for (let i = 0; i < 60; i++) anim.update(0.1, { speed: 0, flags: FLAG.GROUNDED, vy: 0 }); // the game caps dt at 0.1
    expect(Math.abs(rig.joints.torso.rotation.x)).toBeLessThan(1);
    expect(Math.abs(rig.joints.torso.rotation.z)).toBeLessThan(1);
  });

  it("downed lays the figure on its back, carrying raises the arms", () => {
    const rig = buildCharacter(generateCharacter(2));
    const anim = new CharacterAnimator(rig);
    for (let i = 0; i < 90; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED | FLAG.DOWNED, vy: 0 });
    // Lying on the BACK means the head tips backward (+X). (An earlier version asserted the opposite sign and
    // shipped characters falling face-down; only looking at a render caught it.)
    expect(rig.root.rotation.x).toBeGreaterThan(1.2);
    rig.root.updateMatrixWorld(true);
    const headUp = new Vector3(0, 1, 0).applyQuaternion(rig.root.quaternion); // character's local up in world space
    expect(headUp.z).toBeGreaterThan(0.9); // up now points backward (+Z, opposite the facing direction)
    const rig2 = buildCharacter(generateCharacter(2));
    const anim2 = new CharacterAnimator(rig2);
    for (let i = 0; i < 90; i++) anim2.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED | FLAG.CARRYING, vy: 0 });
    // carrying raises both hands IN FRONT of the body (-Z is forward): the elbow ends up ahead of the shoulder, the hand ahead of the elbow
    rig2.root.updateMatrixWorld(true);
    const shoulder = rig2.joints.shoulderL.getWorldPosition(new Vector3());
    const hand = new Vector3(0, -rig2.proportions.armLower, 0);
    rig2.joints.elbowL.localToWorld(hand);
    expect(hand.z).toBeLessThan(shoulder.z - 0.1);
  });

  it("expressions move the face: fear raises brows, pain closes eyes, triumph smiles", () => {
    const rig = buildCharacter(generateCharacter(2));
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false; // sample expressions, not blinks
    const run = (e: ExpressionId) => {
      anim.setExpression(e);
      for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      return { brow: rig.face.browL.position.y, lid: rig.face.lidL.rotation.x, smile: rig.face.pose.mouthCurve };
    };
    const neutral = run("neutral");
    const fear = run("fear");
    const pain = run("pain");
    const triumph = run("triumph");
    expect(fear.brow).toBeGreaterThan(neutral.brow);
    expect(pain.lid).toBeLessThan(fear.lid - 0.5); // lid rotated toward closed (a sleepy head's neutral face is already nearly shut: compare with the wide-eyed one)
    expect(triumph.smile).toBeGreaterThan(0.9); // a grin
    expect(pain.smile).toBeLessThan(-0.5); // a grimace
  });

});
