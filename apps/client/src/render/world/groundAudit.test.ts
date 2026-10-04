import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Box3, Group, Mesh, MeshBasicMaterial, Scene, Vector3, type Object3D } from "three";
import { createRegionWorld, PROP_DEFS, REGION_IDS, type OutpostStage, type RegionId } from "@cb/shared";
import { horseFromSeed } from "@cb/procedural";
import { buildHorse, buildWagon } from "@cb/procedural/three";
import { PRESETS } from "../Stage.ts";
import { CannonView } from "../weapons/CannonView.ts";
import { createRegionView } from "./regionView.ts";
import { floatingPieces, type Floater } from "./groundAudit.ts";
import { propGeometry } from "./objects.ts";

/**
 * D-076: NOTHING FLOATS. Every piece of every region's scenery (every preset, and with a founded outpost and the rest of the campaign's dress)
 * stands on the ground or on something that does; so does every prop, mount, wagon and the field cannon. (Characters have their own per-option
 * audit in packages/procedural: three/audit.test.ts.) A failure lists the floating pieces: centre, size, and the nearest piece that holds.
 *
 * `GROUND_OUT=<file>` appends a survey of every case to a file (with `GROUND_REGION`, `GROUND_PRESET`, `GROUND_STAGE`, `GROUND_MAX` to narrow it).
 */

const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })), set: (t, k, v) => ((t[k as string] = v), true) });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();
const env = process.env;

const describeFloaters = (fl: readonly Floater[]): string =>
  fl
    .slice(0, 8)
    .map((f) => `${f.label}#${f.instance} at ${f.centre.x.toFixed(1)},${f.centre.y.toFixed(1)},${f.centre.z.toFixed(1)} size ${f.size.x.toFixed(2)}x${f.size.y.toFixed(2)}x${f.size.z.toFixed(2)} (nearest hold ${f.near ? `${f.near.label} ${f.near.gap.toFixed(3)} m` : "none"})`)
    .join("\n");

function survey(name: string, fl: readonly Floater[]): void {
  if (!env.GROUND_OUT) return;
  const by = new Map<string, Floater[]>();
  for (const f of fl) by.set(f.label, [...(by.get(f.label) ?? []), f]);
  appendFileSync(env.GROUND_OUT, `== ${name}: ${fl.length} floating pieces\n`);
  for (const [k, list] of by) appendFileSync(env.GROUND_OUT, `  ${list.length} x ${k}\n${describeFloaters(list.slice(0, Number(env.GROUND_MAX ?? 3))).replace(/^/gm, "    ")}\n`);
}

function region(id: RegionId, preset: "low" | "medium" | "high", stage: OutpostStage): Floater[] {
  const world = createRegionWorld(id, 7, stage === "none" ? undefined : { outpost: stage, telegraph: true });
  const view = createRegionView(id, new Scene(), world, PRESETS[preset], sun, 7);
  if (stage !== "none") view.applyDress?.({ outpost: stage, rivalPost: 2, road: 2, telegraph: true, launch: true, name: "Fort Audit" });
  const fl = floatingPieces(view.root, world.terrain);
  view.dispose();
  return fl;
}

const CASES: { id: RegionId; preset: "low" | "medium" | "high"; stage: OutpostStage }[] = [];
for (const id of REGION_IDS) {
  for (const preset of ["low", "medium", "high"] as const) CASES.push({ id, preset, stage: "none" });
  for (const stage of ["camp", "fortified_outpost", "town"] as const) CASES.push({ id, preset: "medium", stage });
}

describe("D-076: nothing in a region floats", () => {
  const pick = CASES.filter((c) => (!env.GROUND_REGION || c.id === env.GROUND_REGION) && (!env.GROUND_PRESET || c.preset === env.GROUND_PRESET) && (!env.GROUND_STAGE || c.stage === env.GROUND_STAGE));
  for (const c of pick) {
    it(`${c.id} ${c.preset}${c.stage === "none" ? "" : ` with a ${c.stage}`}: every piece stands on the ground or on something that does`, () => {
      const fl = region(c.id, c.preset, c.stage);
      survey(`${c.id} ${c.preset} ${c.stage}`, fl);
      expect(fl.length, describeFloaters(fl)).toBe(0);
    }, 120_000);
  }
});

describe("D-076: nothing on a prop, a mount, a wagon or the cannon floats", () => {
  const audit = (root: Object3D): Floater[] => {
    root.updateMatrixWorld(true);
    const floor = new Box3().setFromObject(root).min.y;
    return floatingPieces(root, { height: () => floor });
  };
  it("every prop at both details", () => {
    for (const kind of Object.keys(PROP_DEFS)) {
      for (const lod of [0, 1] as const) {
        const geo = propGeometry(kind as never, lod);
        if (!geo) continue;
        const fl = audit(new Group().add(new Mesh(geo, new MeshBasicMaterial())));
        expect(fl.length, `prop ${kind} lod ${lod}\n${describeFloaters(fl)}`).toBe(0);
      }
    }
  });
  it("horses saddled and in harness, the wagon with every load, the field cannon", () => {
    for (let s = 0; s < 6; s++) for (const harness of [false, true]) {
      const fl = audit(buildHorse(horseFromSeed(s, { harness }), { outline: false }).root);
      expect(fl.length, `horse ${s} ${harness}\n${describeFloaters(fl)}`).toBe(0);
    }
    for (let c = 0; c < 3; c++) {
      const fl = audit(buildWagon({ coat: 1, cargo: c as never, outline: false }).root);
      expect(fl.length, `wagon ${c}\n${describeFloaters(fl)}`).toBe(0);
    }
    const fx = new Proxy({}, { get: () => (): undefined => undefined }) as never;
    const fl = audit(new CannonView(new Scene(), fx, false).root);
    expect(fl.length, describeFloaters(fl)).toBe(0);
  });
});
