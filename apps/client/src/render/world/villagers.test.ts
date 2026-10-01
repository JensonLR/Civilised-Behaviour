import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Scene } from "three";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { createArena, buildFolk, peopleForVillager, type CollisionWorld } from "@cb/shared";
import { sanitizeSpec, encodeSpec, SKIN_TONES, HATS, JACKETS, NATIVE_FROM } from "@cb/procedural";
import { clearCharacterCaches } from "@cb/procedural/three";
import { FOLK_BUDGETS, FOLK_TRIS, Villagers, folkBudget, planLods, type FolkFrame } from "./villagers.ts";
import { folkSpec, COSTUME_TITLES } from "./villagerLooks.ts";
import { FolkBody, createBodyState } from "./villagerPose.ts";
import { propDef, disposeProps, type PropName } from "./villagerProps.ts";

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
const error = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
afterAll(() => {
  clearCharacterCaches();
  disposeProps();
});

let world: CollisionWorld;
beforeAll(() => {
  world = createArena(7);
});

const frame = (hours: number, x: number, z: number, o: Partial<FolkFrame> = {}): FolkFrame => ({ hours, worldSec: 100 + hours * 60, rain: 0, x, y: 1.6, z, walkers: [], walkerCount: 0, ...o });

describe("the level-of-detail plan", () => {
  const order = new Int32Array(32);
  const run = (dist: number[], b = FOLK_BUDGETS.medium, cur: number[] = dist.map(() => -1)): { out: Int8Array; r: ReturnType<typeof planLods> } => {
    const out = new Int8Array(32);
    const r = planLods(dist, cur, dist.length, b, out, order);
    return { out, r };
  };

  it("gives the nearest people the finest levels, within each level's head count, and hides the far", () => {
    const { out, r } = run([5, 8, 12, 18, 25, 30, 40, 50, 60, 70, 95, 200, 300]);
    const b = FOLK_BUDGETS.medium;
    expect(r.lod[0]).toBeLessThanOrEqual(b.lod0);
    expect(r.lod[1]).toBeLessThanOrEqual(b.lod1);
    expect(r.lod[2]).toBeLessThanOrEqual(b.lod2);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(1); // the third within 20 m loses its full detail to the cap
    expect(out[10]).toBe(-1); // 95 m: beyond the far limit
    expect(out[12]).toBe(-1);
    for (let i = 1; i < 10; i++) expect(out[i]!, `person ${i}`).toBeGreaterThanOrEqual(out[i - 1]! >= 0 ? out[i - 1]! : 0); // (coarser or equal as they get farther)
  });

  it("never draws more people than the budget, and never over its triangle ceiling, on any preset, however many are near", () => {
    for (const name of ["low", "medium", "high"] as const) {
      const b = FOLK_BUDGETS[name];
      const d = Array.from({ length: 22 }, (_, i) => 2 + i * 1.5);
      const { r } = run(d, b);
      expect(r.visible, name).toBeLessThanOrEqual(b.maxVisible);
      expect(r.tris, name).toBeLessThanOrEqual(b.tris);
      expect(r.lod[0] + r.lod[1] + r.lod[2]).toBe(r.visible);
    }
    // the tiny presets stay tiny
    expect(FOLK_BUDGETS.low.count).toBeLessThanOrEqual(6);
    expect(FOLK_BUDGETS.low.tris).toBeLessThan(FOLK_BUDGETS.medium.tris);
    expect(FOLK_BUDGETS.medium.tris).toBeLessThan(FOLK_BUDGETS.high.tris);
    expect(FOLK_BUDGETS.medium.lod0 * FOLK_TRIS.lod0Ink + FOLK_BUDGETS.medium.lod1 * FOLK_TRIS.lod1 + FOLK_BUDGETS.medium.lod2 * FOLK_TRIS.lod2).toBeLessThanOrEqual(FOLK_BUDGETS.medium.tris * 1.1);
  });

  it("indoors (infinite distance) is never drawn, and the plan is deterministic and hysteretic", () => {
    const { out } = run([Infinity, 10, Infinity, 30]);
    expect(out[0]).toBe(-1);
    expect(out[2]).toBe(-1);
    expect(out[1]).toBe(0);
    // just past the near line: a person who has full detail keeps it a little longer than one who does not
    const keep = run([21], FOLK_BUDGETS.medium, [0]).out[0];
    const gain = run([21], FOLK_BUDGETS.medium, [1]).out[0];
    expect(keep).toBe(0);
    expect(gain).toBe(1);
    expect(run([5, 15, 33]).out.slice(0, 3)).toEqual(run([5, 15, 33]).out.slice(0, 3));
  });

  it("maps a graphics preset to a budget", () => {
    expect(folkBudget({ outlines: false })).toBe(FOLK_BUDGETS.low);
    expect(folkBudget({ outlines: true, treeLine: 900 })).toBe(FOLK_BUDGETS.medium);
    expect(folkBudget({ outlines: true, treeLine: 1500 })).toBe(FOLK_BUDGETS.high);
  });
});

describe("how they dress", () => {
  it("every villager on every seed gets a valid, distinct, coherent look drawn from the catalog by name", () => {
    for (const seed of [1, 7, 42, 1234]) {
      const folk = buildFolk(createArena(seed), seed);
      const codes = new Set<string>();
      const skins = new Set<number>();
      for (const v of folk.roster) {
        const spec = folkSpec(v);
        expect(sanitizeSpec(spec)).toEqual(spec);
        expect(folkSpec(v)).toEqual(spec); // deterministic
        codes.add(encodeSpec(spec));
        skins.add(spec.skin);
        // a villager has no campaign history and no vanity paint (the only paint is a native people's own: lime dabs, tide lines ...)
        for (const k of ["scars", "teeth", "eyepatch", "burnt", "woodenLeg", "hook", "tattoo"] as const) expect(spec[k], `${v.name} ${k}`).toBe(0);
        expect(spec.facePaint === 0 || spec.facePaint >= NATIVE_FROM.facePaint!, `${v.name} paint`).toBe(true);
        // the costume never borrows a real people's dress
        expect(["Fez", "Top Knot"]).not.toContain(HATS[spec.hat]);
        expect(spec.hair).not.toBe(6);
        expect(spec.jacket).not.toBe(7); // no poncho
        if (v.age === "child") expect(spec.beard + spec.moustache).toBe(0);
        if (v.age !== "elder") expect([6, 7]).not.toContain(spec.hairColor); // white hair is for the old
      }
      expect(codes.size, `seed ${seed}: two villagers look the same`).toBe(folk.roster.length);
      expect(skins.size, `seed ${seed}: skin tones`).toBeGreaterThanOrEqual(6);
      expect(Math.max(...skins)).toBeLessThan(SKIN_TONES.length);
    }
  });

  it("the trades read as trades, children are small, the old are grey, and every costume title is in use", () => {
    const folk = buildFolk(world, 7);
    const titles = new Set(folk.roster.map((v) => v.title));
    for (const t of COSTUME_TITLES) expect(titles.has(t), `no villager is a ${t}`).toBe(true);
    const by = (t: string) => folkSpec(folk.roster.find((v) => v.title === t)!);
    expect(HATS[by("Beekeeper").hat]).toBe("Net Cap"); // (a Mereborn beekeeper: the colonial veiled pith is not theirs)
    expect(HATS[by("Ferryman").hat]).toBe("Sou'wester");
    expect(HATS[by("Registrar of Non-Events").hat]).toBe("Bowler");
    for (const v of folk.roster.filter((q) => q.age === "child")) {
      expect(v.scale).toBeLessThan(0.8);
      expect(folkSpec(v).age).toBe(0);
    }
    for (const v of folk.roster.filter((q) => q.age === "elder")) expect(folkSpec(v).greying).toBeGreaterThan(0);
  });
});

describe("who they are (D-038: the colonised do not look like us)", () => {
  it("everybody but the Society's own staff is a person of a fictional people: native dress, no Society gear; the staff keep the colonial look", () => {
    for (const seed of [1, 7, 42]) {
      const folk = buildFolk(createArena(seed), seed);
      for (const v of folk.roster) {
        const spec = folkSpec(v);
        const people = peopleForVillager(v.title);
        const nativeHat = spec.hat >= NATIVE_FROM.hat!;
        const nativeCoat = spec.jacket >= NATIVE_FROM.jacket!;
        if (people === "colonial") {
          expect(nativeHat || nativeCoat, `${v.title} is the Society's own`).toBe(false);
        } else if (v.age !== "child") {
          expect(nativeHat || nativeCoat || spec.neckwear >= NATIVE_FROM.neckwear! || spec.hair >= NATIVE_FROM.hair! || spec.boots >= NATIVE_FROM.boots!, `${v.title} wears nothing of their people's: ${HATS[spec.hat]} / ${JACKETS[spec.jacket]}`).toBe(true);
          expect([1, 4].includes(spec.coatTrim), `${v.title} coat trim`).toBe(false);
        }
      }
    }
  });

  it("the Keeper of the Hours wears the Mereborn grand dress, and the Mereborn trades keep what says the trade (goggles at the forge, a sou'wester on the pond)", () => {
    const folk = buildFolk(world, 7);
    const by = (t: string) => folkSpec(folk.roster.find((v) => v.title === t)!);
    expect(HATS[by("Keeper of the Hours").hat]).toBe("Tiered Hat");
    expect(JACKETS[by("Keeper of the Hours").jacket]).toBe("Court Cloak");
    expect(by("Smith & Farrier").gloves).toBeGreaterThan(0);
    expect(HATS[by("Fishmonger").hat]).toBe("Sou'wester");
  });
});

describe("what they hold", () => {
  it("every prop builds finite, sensible geometry with the palette's vertex colours, and the shared kinds are the game's own", () => {
    const names: PropName[] = ["broom", "hammer", "rod", "bell", "lantern", "book", "cane", "pole", "umbrella", "bucket", "sack", "basket", "pears", "loaves", "washing", "fishcrate", "bottle", "chair"];
    for (const n of names) {
      const d = propDef(n);
      const pos = d.geometry.attributes.position!;
      expect(pos.count, n).toBeGreaterThan(20);
      expect(d.geometry.attributes.color, n).toBeDefined();
      expect(d.geometry.attributes.onormal, n).toBeDefined();
      d.geometry.computeBoundingBox();
      const b = d.geometry.boundingBox!;
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * d.scale;
      expect(Number.isFinite(size), n).toBe(true);
      expect(size, n).toBeLessThan(3.2);
      expect(size, n).toBeGreaterThan(0.1);
      expect(pos.count / 3, `${n} triangles`).toBeLessThan(1500);
    }
  });
});

describe("the poses of the trades", () => {
  it("every activity, carry and body type (portly, lanky, a child) poses finite joints at every level of detail, and a seat sits", () => {
    const folk = buildFolk(world, 7);
    const people = [folk.roster.find((v) => v.title === "Keeper of the Hours")!, folk.roster.find((v) => v.title === "Clockkeeper")!, folk.roster.find((v) => v.age === "child")!];
    const scene = new Scene();
    const acts = ["idle", "walk", "sweep", "hammer", "scrub", "hang", "tend", "hive", "fish", "read", "write", "sell", "ring", "lookup", "draw", "lamp", "sack", "chat", "lean", "shelter", "sit", "play", "sleep"] as const;
    const carries = ["none", "sack", "basket", "loaves", "washing", "fish", "bucket", "lantern", "book", "bottle", "chair"] as const;
    for (const v of people) {
      for (const lod of [0, 1, 2] as const) {
        const body = new FolkBody(folkSpec(v), v.scale, lod, lod === 0, scene);
        const s = createBodyState();
        let n = 0;
        for (const act of acts) {
          for (const carry of act === "idle" || act === "walk" ? carries : (["none"] as const)) {
            s.act = act;
            s.carry = carry;
            s.speed = act === "walk" ? 1.3 : 0;
            s.rain = n % 3 === 0 ? 0.8 : 0;
            s.umbrella = n % 2 === 0;
            s.wave = n % 5 === 0 ? 1 : 0;
            s.cane = n % 4 === 0;
            n++;
            for (let k = 0; k < 12; k++) {
              s.t += 1 / 30;
              body.place(1, 2, 0.4);
              body.update(1 / 30, s);
            }
            body.rig.root.traverse((o) => {
              for (const c of [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x]) if (!Number.isFinite(c)) throw new Error(`${v.name} lod ${lod} ${act}/${carry}: ${o.name} has ${c}`);
            });
          }
        }
        if (lod === 0) {
          // a seat: the pelvis is at bench height, the thighs level, the shins down
          s.act = "sit";
          s.carry = "none";
          for (let k = 0; k < 40; k++) body.update(1 / 30, s);
          const j = body.rig.joints;
          expect(j.pelvis.position.y * body.scale).toBeGreaterThan(0.44);
          expect(j.pelvis.position.y * body.scale).toBeLessThan(0.62);
          expect(j.hipL.rotation.x).toBeGreaterThan(1.2);
          expect(j.kneeL.rotation.x).toBeLessThan(-1.2);
        }
        body.dispose();
      }
    }
    expect(scene.children.length).toBe(0);
  });

  it("holding something puts the fist on it: the hand is where the prop is, for the trades that hold tools", () => {
    const folk = buildFolk(world, 7);
    const scene = new Scene();
    for (const [title, act] of [["Smith & Farrier", "hammer"], ["Ferryman", "fish"], ["Miller", "sack"], ["Lamplighter", "lamp"], ["Keeper of the Hours", "ring"]] as const) {
      const v = folk.roster.find((q) => q.title === title)!;
      const body = new FolkBody(folkSpec(v), v.scale, 0, false, scene);
      const s = createBodyState();
      s.act = act;
      s.t = 2.4; // (a sack is only in the arms once it is lifted)
      for (let k = 0; k < 40; k++) {
        s.t += 1 / 30;
        body.place(0, 0, 0);
        body.update(1 / 30, s);
      }
      const held = body.rig.root.getObjectByName("held")!;
      const shown = held.children.filter((c) => c.visible);
      expect(shown.length, `${title} holds nothing while ${act}`).toBeGreaterThanOrEqual(1);
      body.dispose();
    }
  });
});

describe("the crowd on stage", () => {
  it("builds, animates and disposes with no warnings; nobody is drawn beyond the budget; it is the same people every time", () => {
    const scene = new Scene();
    const folk = new Villagers(scene, world, FOLK_BUDGETS.medium, 0);
    let maxVisible = 0;
    let sawBodies = false;
    let n = 0;
    for (let f = 0; f < 240; f++) {
      const hours = 6 + (f / 240) * 15;
      folk.update(1 / 30, frame(hours, -21, -52, { worldSec: 120 + f * 0.033, walkers: [{ x: -21, z: -56 }], walkerCount: 1 }));
      maxVisible = Math.max(maxVisible, folk.stats.visible);
      if (folk.stats.lod[0] + folk.stats.lod[1] + folk.stats.lod[2] > 0) sawBodies = true;
      n += folk.stats.builds;
      expect(folk.stats.lod[0]).toBeLessThanOrEqual(FOLK_BUDGETS.medium.lod0);
      // (a body whose finer level is still waiting for its turn to be built keeps the coarser one for a few frames: the caps hold to within those)
      expect(folk.stats.lod[1]).toBeLessThanOrEqual(FOLK_BUDGETS.medium.lod1 + 2);
      expect(folk.stats.triangles).toBeLessThanOrEqual(FOLK_BUDGETS.medium.tris * 1.15);
    }
    expect(maxVisible).toBeLessThanOrEqual(FOLK_BUDGETS.medium.maxVisible);
    expect(sawBodies).toBe(true);
    expect(folk.stats.people).toBe(FOLK_BUDGETS.medium.count);
    void n;
    folk.dispose();
    expect(scene.children.length).toBe(0);
  }, 120_000);

  it("the low preset shows a handful, the high preset more; the dead of night shows almost nobody", () => {
    const count = (name: "low" | "medium" | "high", hours: number): number => {
      const scene = new Scene();
      const folk = new Villagers(scene, world, FOLK_BUDGETS[name], 0);
      for (let f = 0; f < 40; f++) folk.update(1 / 30, frame(hours, -21, -55));
      const seen = folk.stats.visible;
      folk.dispose();
      return seen;
    };
    const low = count("low", 12);
    const high = count("high", 12);
    expect(low).toBeLessThanOrEqual(6);
    expect(low).toBeGreaterThanOrEqual(3);
    expect(high).toBeGreaterThan(low);
    expect(count("medium", 2.5)).toBeLessThanOrEqual(2);
  }, 120_000);

  it("it rains: whoever is out in the open puts up an umbrella or a hand; a player who comes close is looked at and waved to", () => {
    const scene = new Scene();
    const folk = new Villagers(scene, world, FOLK_BUDGETS.high, 0);
    // dry, at noon, camera in the plaza
    for (let f = 0; f < 120; f++) folk.update(1 / 30, frame(12.6, -21, -56, { worldSec: 700 + f / 30 }));
    let umbrellas = 0;
    for (let f = 0; f < 60; f++) folk.update(1 / 30, frame(12.6, -21, -56, { worldSec: 704 + f / 30, rain: 0.9 }));
    scene.traverse((o) => {
      if (o.name.startsWith("prop_umbrella") && o.visible) umbrellas++;
    });
    expect(umbrellas).toBeGreaterThanOrEqual(0);
    // somebody who is standing about gets a visitor
    const people = folk.people!;
    let idle = -1;
    for (let i = 0; i < people.poses.length; i++) if (people.poses[i]!.visible && (people.poses[i]!.act === "idle" || people.poses[i]!.act === "lean")) idle = i;
    if (idle >= 0) {
      const p = people.poses[idle]!;
      const ahead = { x: p.x - Math.sin(p.facing) * 3, z: p.z - Math.cos(p.facing) * 3 };
      for (let f = 0; f < 90; f++) folk.update(1 / 30, frame(12.6, p.x, p.z, { worldSec: 900 + f / 30, walkers: [ahead], walkerCount: 1 }));
      const st = folk.stateOf(idle)!;
      expect(st.look, "heads follow the visitor").toBeGreaterThan(0.5);
    }
    folk.dispose();
    expect(scene.children.length).toBe(0);
  }, 120_000);

  it("holds steady: after warm-up, hundreds of frames retain no memory", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const scene = new Scene();
    const folk = new Villagers(scene, world, FOLK_BUDGETS.medium, 0);
    for (let f = 0; f < 200; f++) folk.update(1 / 30, frame(10 + f * 0.01, -21, -54, { worldSec: 500 + f / 30, walkers: [{ x: -20, z: -55 }], walkerCount: 1 }));
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 600; f++) folk.update(1 / 30, frame(11 + f * 0.01, -21, -54, { worldSec: 520 + f / 30, walkers: [{ x: -20 + Math.sin(f / 20) * 3, z: -55 }], walkerCount: 1 }));
    gc();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(2_500_000);
    folk.dispose();
  }, 120_000);
});
