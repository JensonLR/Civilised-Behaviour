import { describe, expect, it } from "vitest";
import { FLAG, REACT, packReact } from "@cb/shared";
import { Vector3 } from "three";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator, type ExpressionId, type PoseInput } from "./animator.ts";
import { buildCharacter, type CharacterRig } from "./rig.ts";
import { WRIST_MAX, newWeaponPoseInput } from "./weaponPose.ts";
import { WEAPON } from "@cb/shared";

const make = (seed = 3): { rig: CharacterRig; anim: CharacterAnimator } => {
  const rig = buildCharacter({ ...generateCharacter(seed), woodenLeg: 0 }, { outline: false });
  const anim = new CharacterAnimator(rig);
  return { rig, anim };
};
const G = FLAG.GROUNDED;
const run = (anim: CharacterAnimator, seconds: number, pose: PoseInput, onFrame?: (t: number) => void): void => {
  for (let i = 0; i < seconds * 30; i++) {
    anim.update(1 / 30, pose);
    onFrame?.(i / 30);
  }
};

describe("animator polish", () => {
  it("running counter-rotates: the torso twists against the pelvis, and the arms swing opposite the legs", () => {
    const { rig, anim } = make();
    anim.autoBlink = false;
    const twist: number[] = [];
    const pelvis: number[] = [];
    run(anim, 3, { speed: 6, flags: G, vy: 0 }, () => {
      twist.push(rig.joints.torso.rotation.y);
      pelvis.push(rig.joints.pelvis.rotation.y);
    });
    const tail = (a: number[]) => a.slice(-30);
    const range = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(range(tail(twist))).toBeGreaterThan(0.05);
    expect(range(tail(pelvis))).toBeGreaterThan(0.03);
    // opposite phase: when the pelvis yaws one way the torso yaws the other
    let opposed = 0;
    let same = 0;
    for (let i = 0; i < 30; i++) {
      const p = tail(pelvis)[i]!;
      const t = tail(twist)[i]!;
      if (Math.abs(p) > 0.01 && Math.abs(t) > 0.01) (Math.sign(p) !== Math.sign(t) ? opposed++ : same++);
    }
    expect(opposed).toBeGreaterThan(same);
    // arms opposite legs
    const armsAndLegs: [number, number][] = [];
    run(anim, 1, { speed: 6, flags: G, vy: 0 }, () => armsAndLegs.push([rig.joints.shoulderL.rotation.x, rig.joints.hipL.rotation.x]));
    let anti = 0;
    for (const [a, l] of armsAndLegs) if (Math.abs(a) > 0.05 && Math.abs(l) > 0.05 && Math.sign(a) !== Math.sign(l)) anti++;
    expect(anti).toBeGreaterThan(armsAndLegs.length * 0.3);
    rig.dispose();
  });

  it("a sprint leans further forward than a walk, and a crouch sinks the pelvis", () => {
    const walk = make();
    const sprint = make();
    const crouch = make();
    const idle = make();
    for (const m of [walk, sprint, crouch, idle]) m.anim.autoBlink = false;
    run(walk.anim, 2, { speed: 2, flags: G, vy: 0 });
    run(sprint.anim, 2, { speed: 6.5, flags: G | FLAG.SPRINTING, vy: 0 });
    run(crouch.anim, 2, { speed: 0, flags: G | FLAG.CROUCHING, vy: 0 });
    run(idle.anim, 2, { speed: 0, flags: G, vy: 0 });
    expect(-sprint.rig.joints.torso.rotation.x).toBeGreaterThan(-walk.rig.joints.torso.rotation.x + 0.05);
    expect(crouch.rig.joints.pelvis.position.y).toBeLessThan(idle.rig.joints.pelvis.position.y - 0.05);
    // the knees bend in a crouch
    expect(crouch.rig.joints.kneeL.rotation.x).toBeLessThan(idle.rig.joints.kneeL.rotation.x - 0.4);
  });

  it("take-off and landing have anticipation and follow-through: a wind-up dip before the jump, a spring on touchdown", () => {
    const { rig, anim } = make();
    anim.autoBlink = false;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const rest = rig.joints.pelvis.position.y;
    anim.windUp();
    let dip = 0;
    run(anim, 0.3, { speed: 0, flags: G, vy: 0 }, () => (dip = Math.max(dip, rest - rig.joints.pelvis.position.y)));
    expect(dip).toBeGreaterThan(0.015);
    // airborne, then land hard
    run(anim, 0.6, { speed: 0, flags: 0, vy: -6 });
    let lowY = Infinity;
    let deepestKnee = 0;
    run(anim, 0.5, { speed: 0, flags: G, vy: 0 }, () => {
      lowY = Math.min(lowY, rig.joints.pelvis.position.y);
      deepestKnee = Math.min(deepestKnee, rig.joints.kneeL.rotation.x);
    });
    run(anim, 2, { speed: 0, flags: G, vy: 0 });
    const settled = rig.joints.pelvis.position.y;
    expect(deepestKnee).toBeLessThan(rig.joints.kneeL.rotation.x - 0.2); // the knees give on touchdown ...
    expect(lowY).toBeLessThan(settled - 0.004); // ... the body dips below where it settles ...
    expect(Math.abs(settled - rest)).toBeLessThan(0.05); // ... and comes back to rest
    rig.dispose();
  });

  it("turning while moving banks the body into the turn, either way", () => {
    const left = make();
    const right = make();
    for (const m of [left, right]) m.anim.autoBlink = false;
    run(left.anim, 2, { speed: 5, flags: G, vy: 0, yawRate: 3 });
    run(right.anim, 2, { speed: 5, flags: G, vy: 0, yawRate: -3 });
    const lz = left.rig.joints.torso.rotation.z;
    const rz = right.rig.joints.torso.rotation.z;
    expect(Math.sign(lz)).not.toBe(Math.sign(rz));
    expect(Math.abs(lz - rz)).toBeGreaterThan(0.1);
  });

  it("idle life has variety: over a minute the standing pose is not one repeated loop, yet is deterministic per character", () => {
    const sample = (seed: number): string => {
      const { rig, anim } = make(seed);
      const seen = new Set<string>();
      let trace = "";
      run(anim, 60, { speed: 0, flags: G, vy: 0 }, (t) => {
        if (Math.round(t * 30) % 15 === 0) {
          const r = rig.joints;
          const key = [r.shoulderL.rotation.x, r.shoulderR.rotation.x, r.head.rotation.y, r.torso.rotation.y].map((v) => v.toFixed(1)).join(",");
          seen.add(key);
          trace += key + ";";
        }
      });
      rig.dispose();
      return trace.length + ":" + seen.size + ":" + trace;
    };
    const a = sample(3);
    expect(sample(3)).toBe(a);
    expect(Number(a.split(":")[1])).toBeGreaterThan(12);
    expect(sample(11)).not.toBe(a);
  });

  it("moods move the whole body, not just the face: pain hunches, fear cowers, triumph throws the arms up, drunk sways", () => {
    const pose = (mood: ExpressionId): { rig: CharacterRig; anim: CharacterAnimator } => {
      const m = make();
      m.anim.autoBlink = false;
      m.anim.setExpression(mood);
      return m;
    };
    const neutral = pose("neutral");
    const pain = pose("pain");
    const fear = pose("fear");
    const triumph = pose("triumph");
    const drunk = pose("drunk");
    const st = { speed: 0, flags: G, vy: 0 };
    for (const m of [neutral, pain, fear, triumph, drunk]) run(m.anim, 3, st);
    expect(-pain.rig.joints.torso.rotation.x).toBeGreaterThan(-neutral.rig.joints.torso.rotation.x + 0.1); // hunched forward
    expect(fear.rig.joints.kneeL.rotation.x).toBeLessThan(neutral.rig.joints.kneeL.rotation.x - 0.05); // knees give
    expect(triumph.rig.joints.shoulderL.rotation.x).toBeGreaterThan(neutral.rig.joints.shoulderL.rotation.x + 1); // arms up
    let lo = Infinity;
    let hi = -Infinity;
    run(drunk.anim, 4, st, () => {
      lo = Math.min(lo, drunk.rig.joints.torso.rotation.z);
      hi = Math.max(hi, drunk.rig.joints.torso.rotation.z);
    });
    expect(hi - lo).toBeGreaterThan(0.04); // swaying
    for (const m of [neutral, pain, fear, triumph, drunk]) m.rig.dispose();
  });

  it("a peg leg swings stiffly outward and hops the pelvis; no NaN across mixed moods, poses and LODs", () => {
    const rig = buildCharacter({ ...generateCharacter(5), woodenLeg: 2 }, { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    let swing = 0;
    run(anim, 2, { speed: 3, flags: G | FLAG.PEG_LEG, vy: 0 }, () => (swing = Math.max(swing, Math.abs(rig.joints.hipR.rotation.z))));
    expect(swing).toBeGreaterThan(0.08);
    const moods: ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry"];
    moods.forEach((mood, i) => {
      anim.setExpression(mood);
      rig.setLod((i % 3) as 0 | 1 | 2);
      run(anim, 1, { speed: i * 1.2, flags: i % 2 ? G | FLAG.CROUCHING : G | FLAG.SPRINTING, vy: 0, yawRate: i - 2 });
    });
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => o.matrix.elements.forEach((e) => expect(Number.isFinite(e)).toBe(true)));
    rig.dispose();
  });

  it("starting leans into the run and stopping leans back and gives at the knees; turning lags the shoulders and leads with the head", () => {
    const { rig, anim } = make(4);
    anim.autoBlink = false;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const still = rig.joints.torso.rotation.x;
    let startLean = 0;
    // a hard start: 0 -> 5 m/s in a third of a second
    for (let i = 0; i < 10; i++) {
      anim.update(1 / 30, { speed: (i + 1) * 0.5, flags: G, vy: 0 });
      startLean = Math.max(startLean, still - rig.joints.torso.rotation.x); // forward lean is more negative
    }
    run(anim, 1.5, { speed: 5, flags: G, vy: 0 });
    const cruise = rig.joints.torso.rotation.x;
    let stopLean = Infinity;
    let stopKnee = 0;
    for (let i = 0; i < 10; i++) {
      anim.update(1 / 30, { speed: 5 - (i + 1) * 0.5, flags: G, vy: 0 });
      stopLean = Math.min(stopLean, cruise - rig.joints.torso.rotation.x);
      stopKnee = Math.max(stopKnee, -rig.joints.kneeL.rotation.x, -rig.joints.kneeR.rotation.x);
    }
    expect(startLean).toBeGreaterThan(0.08);
    expect(stopLean).toBeLessThan(0.05); // the body comes back up (or further back) as the speed drops: it does not stay pitched forward
    expect(stopKnee).toBeGreaterThan(0.2);
    // turning: the head leads and the shoulders lag
    const a = make(4);
    a.anim.autoBlink = false;
    run(a.anim, 1, { speed: 0, flags: G, vy: 0, yawRate: 0 });
    const t0 = a.rig.joints.torso.rotation.y;
    run(a.anim, 1, { speed: 0, flags: G, vy: 0, yawRate: 4 });
    expect(a.rig.joints.torso.rotation.y).toBeLessThan(t0 - 0.05);
    rig.dispose();
    a.rig.dispose();
  });

  it("every state, every idle act and every weapon hold keeps every joint finite and inside its limits (elbow -0.1..2.5, knee -2.5..0.1, wrist inside its range), and switching between states never jumps a joint by more than a fraction of its range", () => {
    const wid = [-1, WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.SABRE, WEAPON.UMBRELLA];
    const states: PoseInput[] = [
      { speed: 0, flags: G, vy: 0 },
      { speed: 2, flags: G, vy: 0 },
      { speed: 6, flags: G | FLAG.SPRINTING, vy: 0 },
      { speed: 0, flags: G | FLAG.CROUCHING, vy: 0 },
      { speed: 0, flags: G | FLAG.CARRYING, vy: 0 },
      { speed: 0, flags: G | FLAG.REVIVING, vy: 0 },
      { speed: 3, flags: 0, vy: 5 },
      { speed: 3, flags: 0, vy: -7 },
      { speed: 0, flags: G, vy: 0 },
    ];
    const moods: ExpressionId[] = ["neutral", "pain", "fear", "triumph", "drunk", "angry"];
    for (const seed of [2, 9]) {
      const { rig, anim } = make(seed);
      const j = rig.joints;
      let prev: number[] | undefined;
      let worstStep = 0;
      const snap = (): number[] => [j.shoulderL.rotation.x, j.shoulderR.rotation.x, j.elbowL.rotation.x, j.elbowR.rotation.x, j.hipL.rotation.x, j.hipR.rotation.x, j.kneeL.rotation.x, j.kneeR.rotation.x, j.torso.rotation.x, j.pelvis.position.y * 3];
      let step = 0;
      for (const mood of moods) {
        anim.setExpression(mood);
        for (let si = 0; si < states.length; si++) {
          const st = states[si]!;
          // a weapon in the hand in some of them
          const weapon = { ...newWeaponPoseInput(), id: wid[(si + seed) % wid.length]!, aim: si % 2 };
          const frames = si === 0 ? 30 * 12 : 24;
          for (let i = 0; i < frames; i++) {
            anim.update(1 / 30, { ...st, weapon: st.flags & FLAG.CARRYING ? undefined : weapon });
            step++;
            for (const b of Object.values(j)) {
              expect(Number.isFinite(b.rotation.x + b.rotation.y + b.rotation.z + b.position.y + b.quaternion.w)).toBe(true);
            }
            for (const e of [j.elbowL, j.elbowR]) {
              expect(e.rotation.x).toBeGreaterThanOrEqual(-0.1 - 1e-6);
              expect(e.rotation.x).toBeLessThanOrEqual(2.5);
            }
            for (const k of [j.kneeL, j.kneeR]) {
              expect(k.rotation.x).toBeGreaterThanOrEqual(-2.5);
              expect(k.rotation.x).toBeLessThanOrEqual(0.1 + 1e-6);
            }
            for (const w of [j.wristL, j.wristR]) expect(2 * Math.acos(Math.min(1, Math.abs(w.quaternion.w)))).toBeLessThanOrEqual(WRIST_MAX + 0.01 + 0.6); // (a grip's turn, plus the loose swing on top)
            const now = snap();
            if (prev && i > 0 && si !== 2) for (let q = 0; q < now.length; q++) worstStep = Math.max(worstStep, Math.abs(now[q]! - prev[q]!)); // (a sprint's own stride swings a leg ~0.95 rad per 30 Hz frame: that is the gait, not a pop)
            prev = now;
          }
        }
      }
      expect(step).toBeGreaterThan(2000);
      // (a landing, a start of a sprint, a drawn weapon all move a joint fast, but never by a jump: under 1.3 rad in one 30 Hz frame, sprint strides aside)
      expect(worstStep).toBeLessThan(1.3);
      rig.dispose();
    }
  });
});

describe("D-104: hit reactions in the pose", () => {
  const knees = (rig: CharacterRig): { l: number; r: number } => {
    rig.joints.root.updateMatrixWorld(true);
    const v = new Vector3();
    return { l: rig.joints.kneeL.getWorldPosition(v).y, r: rig.joints.kneeR.getWorldPosition(v).y };
  };

  it("floored by a leg wound: down on THAT knee, the other foot planted, and up again when it ends", () => {
    for (const [seed, right] of [[5, false], [5, true], [2, false], [9, true]] as const) {
      const { rig, anim } = make(seed);
      anim.autoBlink = false;
      run(anim, 1, { speed: 0, flags: G, vy: 0 });
      const stand = knees(rig);
      const hips = rig.joints.pelvis.position.y;
      run(anim, 0.6, { speed: 0, flags: G, vy: 0, react: packReact(REACT.FLOORED, right, 1.5) });
      const k = knees(rig);
      const hurt = right ? k.r : k.l;
      const sound = right ? k.l : k.r;
      expect(hurt).toBeLessThan(0.06); // (the knee is ON the ground: a stout body's planted leg folds deeper rather than prop the hips and float the knee)
      expect(sound).toBeGreaterThan(hurt + 0.02); // (the other knee is up, its foot planted)
      expect(rig.joints.pelvis.position.y).toBeLessThan(hips * 0.8); // (relative: a short body has less far to sink)
      expect(Math.sign(rig.joints.torso.rotation.z)).toBe(right ? 1 : -1); // (he leans onto the hurt side)
      run(anim, 2, { speed: 0, flags: G, vy: 0 });
      expect(rig.joints.pelvis.position.y).toBeCloseTo(hips, 2);
      expect(knees(rig).l).toBeCloseTo(stand.l, 2);
    }
  });

  it("doubled over: the trunk folds forward, the hands go to the belly, the knees give; disarmed: the hurt arm is flung back", () => {
    const { rig, anim } = make(5);
    anim.autoBlink = false;
    const j = rig.joints;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const torso = j.torso.rotation.x;
    run(anim, 0.6, { speed: 0, flags: G, vy: 0, react: packReact(REACT.DOUBLED, false, 1.2) });
    expect(j.torso.rotation.x).toBeLessThan(torso - 0.6); // (forward is negative X in this rig)
    expect(j.elbowL.rotation.x).toBeGreaterThan(1.7);
    expect(j.elbowR.rotation.x).toBeGreaterThan(1.7);
    expect(-j.kneeL.rotation.x).toBeGreaterThan(0.4);
    run(anim, 2, { speed: 0, flags: G, vy: 0 });
    run(anim, 0.4, { speed: 0, flags: G, vy: 0, react: packReact(REACT.DISARMED, true, 0.9) });
    expect(j.shoulderR.rotation.x).toBeLessThan(0); // (swung back behind him)
    expect(j.shoulderR.rotation.z).toBeGreaterThan(0.35); // (and out to the right)
  });

  it("the downed pose wins over a stagger; a weapon in the hands is held on through it", () => {
    const { rig, anim } = make(5);
    anim.autoBlink = false;
    run(anim, 2, { speed: 0, flags: G | FLAG.DOWNED, vy: 0, react: packReact(REACT.FLOORED, false, 1.5) });
    expect(rig.joints.root.rotation.x).toBeGreaterThan(1.2);
    const { rig: r2, anim: a2 } = make(5);
    const weapon = newWeaponPoseInput();
    weapon.id = WEAPON.RIFLE;
    run(a2, 1, { speed: 0, flags: G, vy: 0, weapon, react: packReact(REACT.DOUBLED, false, 1.2) });
    expect(a2.hold.visible).toBe(true);
    expect(r2.joints.torso.rotation.x).toBeLessThan(-0.5);
  });
});

describe("D-106: on the end of a rope", () => {
  it("a man hauled on a rope (dragged, not down) lies on his back as the downed do", () => {
    const { rig, anim } = make(5);
    anim.autoBlink = false;
    run(anim, 2, { speed: 2, flags: G | FLAG.DRAGGED, vy: 0 });
    expect(rig.joints.root.rotation.x).toBeGreaterThan(1.2);
  });
});

describe("D-108: the boot", () => {
  it("a blow with a firearm in hand is a kick: the right knee comes up, then the leg drives out straight and high while the left stands; a sabre's blow moves no leg", () => {
    const { rig, anim } = make(5);
    anim.autoBlink = false;
    const weapon = { ...newWeaponPoseInput(), id: WEAPON.RIFLE };
    run(anim, 1, { speed: 0, flags: G, vy: 0, weapon });
    const restHip = rig.joints.hipR.rotation.x;
    const at = (s: number): { hipR: number; kneeR: number; hipL: number; kick: number } => {
      run(anim, 1 / 30, { speed: 0, flags: G, vy: 0, weapon: { ...weapon, swing: s } });
      return { hipR: rig.joints.hipR.rotation.x, kneeR: -rig.joints.kneeR.rotation.x, hipL: rig.joints.hipL.rotation.x, kick: anim.kickW };
    };
    const chamber = at(0.3);
    expect(chamber.hipR).toBeGreaterThan(restHip + 0.8); // (the knee up)
    expect(chamber.kneeR).toBeGreaterThan(0.8); // (folded, as far as this leg folds: a stout thigh stops the calf sooner)
    const strike = at(0.58);
    expect(strike.hipR).toBeGreaterThan(1.3); // (the leg out, high)
    expect(strike.kneeR).toBeLessThan(0.4); // (straight)
    expect(Math.abs(strike.hipL)).toBeLessThan(0.25); // (standing on the other)
    expect(strike.kick).toBeGreaterThan(0.9);
    const done = at(1);
    expect(done.kick).toBe(0);
    // a sabre: the arms swing, the legs do not kick
    const sabre = { ...newWeaponPoseInput(), id: WEAPON.SABRE, swing: 0.58 };
    run(anim, 1, { speed: 0, flags: G, vy: 0, weapon: sabre });
    expect(anim.kickW).toBe(0);
    expect(rig.joints.hipR.rotation.x).toBeLessThan(restHip + 0.3);
  });
});

describe("D-112: the human shield", () => {
  it("held up by the collar, both arms go behind the back and the head drops; the one holding him locks the off arm across, even with a rifle in hand", () => {
    const { rig, anim } = make(7);
    anim.autoBlink = false;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const restL = rig.joints.shoulderL.rotation.x;
    const restHead = rig.joints.head.rotation.x;
    run(anim, 1, { speed: 0, flags: G, vy: 0, held: true });
    expect(rig.joints.shoulderL.rotation.x).toBeLessThan(restL - 0.5); // (arms back)
    expect(rig.joints.shoulderR.rotation.x).toBeLessThan(-0.4);
    expect(rig.joints.elbowL.rotation.x).toBeGreaterThan(1);
    expect(rig.joints.head.rotation.x).toBeGreaterThan(restHead + 0.15); // (looking at his boots)
    // and back again when let go
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    expect(Math.abs(rig.joints.shoulderL.rotation.x - restL)).toBeLessThan(0.1);
    // the holder: a rifle wants both hands, the clutch takes the left anyway
    const h = make(8);
    h.anim.autoBlink = false;
    const weapon = { ...newWeaponPoseInput(), id: WEAPON.RIFLE };
    run(h.anim, 1, { speed: 0, flags: G, vy: 0, weapon });
    const gunL = h.rig.joints.shoulderL.rotation.x;
    run(h.anim, 1, { speed: 0, flags: G, vy: 0, weapon, clutch: true });
    expect(h.rig.joints.shoulderL.rotation.x).toBeCloseTo(1.45, 1); // (reaching forward at his shoulders' height)
    expect(h.rig.joints.shoulderL.rotation.y).toBeCloseTo(-1.3, 1); // (twisted so the bent forearm crosses, not rises to the face: the first look)
    expect(h.rig.joints.elbowL.rotation.x).toBeCloseTo(0.95, 1);
    expect(Math.abs(h.rig.joints.shoulderL.rotation.x - gunL)).toBeGreaterThan(0.05);
  });
});

describe("D-113: hands up", () => {
  it("both arms go up over the head, a little apart, and come down when it is over", () => {
    const { rig, anim } = make(9);
    anim.autoBlink = false;
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    const rest = rig.joints.shoulderR.rotation.x;
    run(anim, 1, { speed: 0, flags: G, vy: 0, surrender: true });
    expect(rig.joints.shoulderL.rotation.x).toBeGreaterThan(2.4);
    expect(rig.joints.shoulderR.rotation.x).toBeGreaterThan(2.4);
    expect(rig.joints.elbowR.rotation.x).toBeLessThan(0.8);
    run(anim, 1, { speed: 0, flags: G, vy: 0 });
    expect(Math.abs(rig.joints.shoulderR.rotation.x - rest)).toBeLessThan(0.15);
  });
});

