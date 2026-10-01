import { BoxGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, SphereGeometry, type BufferGeometry, type Object3D } from "three";
import { PALETTE, VESPER_STOCK, vesperPlan, type CollisionWorld, type ResolutionId, type ScenarioView } from "./shared.ts";
import { Kit, blend, type ColourFn } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { makeSolid, toonMaterial } from "../toon.ts";
import { box, planks } from "./structures.ts";

/**
 * How the scenery SHOWS the contract being played (`RegionView.applyScenario`; never decides it, never touches collision): the Lower Gallery's fall is shored with timber as the party carries it, cut
 * into as it digs, and finally an opening (`dug_out`: timber sets and lamps), a breach (`blasted_through`: a black crater and flung rock), a seal (`sealed`: planks, iron and the Company's red plate) or a
 * Guild service (`consecrated`: plum drapes, candles and a bell). The Claim Race's four pegs fly a gilt flag when the party holds them and a green one when the Syndicate does. Every state is one small
 * merged mesh, hidden until the contract asks for it. The state is read from the view's objectives: `timber` ("(n of 3)"), `dig` ("(NN%)"), `peg-0..3` (done = the party's; a text naming the Syndicate = theirs).
 */

const P = PALETTE.vesper;

export interface DressState {
  timber: number;
  dig: number;
  resolution: ResolutionId | undefined;
  pegs: ("none" | "party" | "rival")[];
}

export const NO_DRESS: DressState = { timber: 0, dig: 0, resolution: undefined, pegs: ["none", "none", "none", "none"] };

/** Reads the dress off a published view (pure). `undefined` (no contract) dresses nothing. */
export function dressOf(v: ScenarioView | undefined): DressState {
  if (!v || (v.template !== "mine_rescue" && v.template !== "claim_race")) return NO_DRESS;
  const out: DressState = { timber: 0, dig: 0, resolution: v.resolution, pegs: ["none", "none", "none", "none"] };
  for (const o of v.objectives) {
    if (o.id === "timber") {
      const m = /\((\d+) of \d+\)/.exec(o.text);
      out.timber = m ? Math.min(3, Number(m[1])) : o.done ? 3 : 0;
    } else if (o.id === "dig") {
      const m = /\((\d+)%\)/.exec(o.text);
      out.dig = m ? Math.min(100, Number(m[1])) : o.done ? 100 : 0;
    } else {
      const m = /^peg-([0-3])$/.exec(o.id);
      if (m) out.pegs[Number(m[1])] = o.done ? "party" : /syndicate/i.test(o.text) ? "rival" : "none";
    }
  }
  return out;
}

const FALL = (): { x: number; z: number; y: number } => {
  const f = vesperPlan().fall;
  return { x: f.x, z: f.z, y: 0 };
};

/** A set of timber: two uprights, a cap beam and a cross-brace, against the heap's face (local x across, y up; the face is at z = 0, the party stands at +z). */
function timberSet(k: Kit, x: number, y: number, z: number, w: number, h: number, seed: number): void {
  for (const s of [-1, 1]) k.limb([x + s * w / 2, y, z], [x + s * w / 2, y + h, z], 0.17, 0.15, planks(seed), 6);
  box(k, [w + 0.7, 0.3, 0.38], [x, y + h + 0.1, z], planks(seed + 1));
  k.limb([x - w / 2, y + h * 0.25, z + 0.1], [x + w / 2, y + h * 0.8, z + 0.1], 0.06, 0.06, P.timberLight, 4);
}

function buildWork(world: CollisionWorld, i: number): BufferGeometry {
  const f = FALL();
  const gy = world.terrainHeight(f.x, f.z + 2.4);
  const k = new Kit();
  const x = (i - 1) * 4.6;
  timberSet(k, f.x + x, gy - 0.1, f.z + 2.5, 2.8, 3.1, 370 + i * 3);
  return k.build()!;
}

/** A dark trench cut into the heap's face, 3 m wide and 1 m tall in the mesh's own frame (its foot at y = 0): the view stands it on the floor and scales its height by the dig. */
function buildCut(): BufferGeometry {
  const k = new Kit();
  k.add(new BoxGeometry(3.0, 1, 1.0), { at: [0, 0.5, 0], colour: (_p, n, out) => blend(out, P.shale, P.crepe, n.y > 0.5 ? 0.6 : 0.2), flat: true });
  return k.build()!;
}

function buildDug(world: CollisionWorld, lod: Lod): BufferGeometry {
  const f = FALL();
  const gy = world.terrainHeight(f.x, f.z + 2.4);
  const k = new Kit();
  // a mouth framed in three timber sets, a black interior, lamp-bulbs along the roof, a heap of spoil to either side
  box(k, [3.2, 3.2, 1.2], [f.x, gy + 1.6, f.z + 2.2], P.crepe);
  for (let i = 0; i < 3; i++) timberSet(k, f.x, gy - 0.1, f.z + 3.0 - i * 0.55, 3.4, 3.2, 380 + i * 3);
  for (let i = 0; i < 3; i++) k.add(new SphereGeometry(0.12, 6, 4), { at: [f.x + (i - 1) * 1.0, gy + 3.1, f.z + 3.3], colour: P.glowLamp });
  for (const s of [-1, 1]) k.add(new IcosahedronGeometry(1, lod ? 1 : 0), { at: [f.x + s * 4.6, gy + 0.4, f.z + 3.4], scale: [1.8, 0.9, 1.5], colour: P.spoil, flat: true, jitter: 0.15, seed: 390 + s });
  return k.build()!;
}

function buildBlasted(world: CollisionWorld, lod: Lod): BufferGeometry {
  const f = FALL();
  const gy = world.terrainHeight(f.x, f.z + 2.4);
  const k = new Kit();
  // a ragged black breach, rock flung across the floor, a splintered prop or two, scorch on the heap
  const crater: ColourFn = (p, n, out) => blend(out, P.shale, P.crepe, Math.min(1, Math.max(0, (p.y + 1) * 0.3)) + (n.y > 0.5 ? 0.2 : 0));
  // (the breach is a flat black mouth pressed against the face, ringed with broken rock, so it reads as a hole and not as one more boulder)
  k.add(new IcosahedronGeometry(2.4, lod ? 2 : 1), { at: [f.x, gy + 1.9, f.z + 2.15], scale: [1.25, 0.95, 0.2], colour: crater, flat: true, jitter: 0.3, seed: 400 });
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + i / 8 * 0.9);
    k.add(new IcosahedronGeometry(0.5 + (i % 3) * 0.18, 0), { at: [f.x + Math.cos(a) * 3.3, gy + 1.0 + Math.sin(a) * 2.7, f.z + 2.4], colour: (_p, n, out) => blend(out, P.strataRustDark, P.spoil, Math.max(0, n.y) * 0.5), flat: true, jitter: 0.2, seed: 440 + i });
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 2.6 + (i % 4) * 1.5;
    const s = 0.28 + (i % 3) * 0.2;
    k.add(new IcosahedronGeometry(s, 0), { at: [f.x + Math.cos(a) * r * 1.5, gy + s * 0.5, f.z + 3.6 + Math.abs(Math.sin(a)) * r], colour: (_p, n, out) => blend(out, i % 2 ? P.shale : P.strataRustDark, P.spoil, Math.max(0, n.y) * 0.4), flat: true, jitter: 0.15, seed: 410 + i });
  }
  for (let i = 0; i < 4; i++) k.limb([f.x - 3 + i * 2, gy + 0.2, f.z + 4.4], [f.x - 3.6 + i * 2.2, gy + 1.8, f.z + 5.6], 0.1, 0.06, P.crepe, 5);
  return k.build()!;
}

function buildSealed(world: CollisionWorld): BufferGeometry {
  const f = FALL();
  const gy = world.terrainHeight(f.x, f.z + 2.4);
  const k = new Kit();
  // a barricade of planks across the whole face, nailed to two beams, iron straps, the Company's red plate and its notice
  const w = 12;
  for (let r = 0; r < 6; r++) box(k, [w, 0.34, 0.22], [f.x, gy + 0.5 + r * 0.55, f.z + 2.5], planks(420 + r), [0, 0, (r % 2 ? 0.015 : -0.015)]);
  for (const s of [-1, 1]) k.limb([f.x + s * (w / 2 - 0.4), gy - 0.2, f.z + 2.7], [f.x + s * (w / 2 - 0.4), gy + 4.1, f.z + 2.7], 0.2, 0.18, P.timber, 6);
  for (let r = 0; r < 3; r++) box(k, [w + 0.2, 0.12, 0.28], [f.x, gy + 0.9 + r * 1.2, f.z + 2.66], P.iron);
  box(k, [2.0, 1.4, 0.1], [f.x, gy + 2.9, f.z + 2.7], P.companyRed);
  box(k, [1.5, 0.12, 0.12], [f.x, gy + 2.9, f.z + 2.78], P.companyCream);
  box(k, [0.12, 0.8, 0.12], [f.x, gy + 2.9, f.z + 2.78], P.companyCream);
  box(k, [1.3, 1.0, 0.06], [f.x + 4.0, gy + 2.4, f.z + 2.7], P.companyCream);
  return k.build()!;
}

function buildConsecrated(world: CollisionWorld): BufferGeometry {
  const f = FALL();
  const gy = world.terrainHeight(f.x, f.z + 2.4);
  const k = new Kit();
  // the Guild's service: plum drapes hung from a rail, black crepe below them, a silver bell on a frame, a row of candles
  const w = 13;
  k.limb([f.x - w / 2, gy + 4.6, f.z + 2.6], [f.x + w / 2, gy + 4.6, f.z + 2.6], 0.08, 0.08, P.iron, 5);
  for (let i = 0; i < 6; i++) {
    const x = f.x - w / 2 + 1.1 + i * ((w - 2.2) / 5);
    box(k, [1.9, 4.0, 0.08], [x, gy + 2.5, f.z + 2.7 + (i % 2) * 0.06], i % 2 ? P.guildPlum : P.crepe, [0, 0, (i % 2 ? 0.02 : -0.02)]);
  }
  for (const s of [-1, 1]) k.limb([f.x + s * 1.0, gy - 0.1, f.z + 5.2], [f.x + s * 1.0, gy + 3.4, f.z + 5.2], 0.1, 0.09, P.iron, 6);
  k.limb([f.x - 1.0, gy + 3.35, f.z + 5.2], [f.x + 1.0, gy + 3.35, f.z + 5.2], 0.09, 0.09, P.iron, 5);
  k.add(new SphereGeometry(0.6, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.75), { at: [f.x, gy + 2.7, f.z + 5.2], scale: [1, 1.15, 1], colour: P.guildSilver, flat: true });
  for (let i = 0; i < 7; i++) {
    const x = f.x - 3.6 + i * 1.2;
    k.limb([x, gy, f.z + 4.4], [x, gy + 0.45, f.z + 4.4], 0.07, 0.07, P.companyCream, 5);
    k.add(new SphereGeometry(0.07, 5, 4), { at: [x, gy + 0.55, f.z + 4.4], colour: P.glowLamp });
  }
  return k.build()!;
}

/** The four peg flags: a small gilt or green pennant on each stake, scaled to nothing until the pegs are held. */
const FLAG_AT = (world: CollisionWorld, i: number): { x: number; y: number; z: number } => {
  const p = vesperPlan().pegs[i]!;
  return { x: p.x, y: world.terrainHeight(p.x, p.z) + 1.18, z: p.z };
};

export class VesperDress {
  private readonly work: Mesh[] = [];
  private cut!: Mesh;
  private readonly states = new Map<string, Mesh>();
  private flags!: InstancedMesh;
  private readonly m4 = new Matrix4();
  private readonly colour = new Color();
  private last = "";

  constructor(private readonly root: Object3D, private readonly world: CollisionWorld, detail: { outlines: boolean }, private readonly track: <T extends { dispose(): void }>(x: T) => T) {
    const lod: Lod = detail.outlines ? 1 : 0;
    const add = (name: string, geo: BufferGeometry): Mesh => {
      const meshes = makeSolid(root, track(geo), track(toonMaterial({ wetDark: 0.8 })), { name, outline: false, castShadow: false });
      meshes[0]!.visible = false;
      return meshes[0]!;
    };
    for (let i = 0; i < 3; i++) this.work.push(add(`fall_work_${i}`, buildWork(world, i)));
    this.cut = add("fall_cut", buildCut());
    this.cut.position.set(FALL().x, world.terrainHeight(FALL().x, FALL().z + 2.4), FALL().z + 2.6);
    this.states.set("dug_out", add("fall_dug", buildDug(world, lod)));
    this.states.set("blasted_through", add("fall_blasted", buildBlasted(world, lod)));
    this.states.set("sealed", add("fall_sealed", buildSealed(world)));
    this.states.set("consecrated", add("fall_consecrated", buildConsecrated(world)));
    // the peg flags: one instanced pennant mesh, four slots
    const geo = track(new BoxGeometry(1.0, 0.6, 0.04));
    geo.translate(0.5, 0, 0);
    geo.setAttribute("color", new Float32BufferAttribute(new Float32Array(geo.attributes.position!.count * 3).fill(1), 3));   // (the toon material multiplies vertex colour; the instance colour then picks the flag)
    this.flags = new InstancedMesh(geo, track(toonMaterial({ doubleSided: true, wetDark: 0.4 })), 4);
    this.flags.name = "peg_flags";
    for (let i = 0; i < 4; i++) {
      this.flags.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      this.flags.setColorAt(i, this.colour.set(P.glowLamp));
    }
    this.flags.frustumCulled = false;
    root.add(this.flags);
    void this.world;
  }

  /** Dresses the scenery for the contract being played (idempotent: repeated identical views do nothing). */
  apply(v: ScenarioView | undefined): void {
    const d = dressOf(v);
    const sig = JSON.stringify(d);
    if (sig === this.last) return;
    this.last = sig;
    const mine = v?.template === "mine_rescue";
    const done = d.resolution !== undefined && d.resolution !== "abandoned";
    // the shoring frames and the cut show while the party is working the fall; any ending replaces them with its own picture
    for (let i = 0; i < 3; i++) this.work[i]!.visible = mine && !done && d.timber > i;
    const cutH = mine && !done ? Math.max(0, Math.min(1, d.dig / 100)) * 3.4 : 0;
    this.cut.visible = cutH > 0.05;
    this.cut.scale.set(1, Math.max(0.01, cutH), 1);
    for (const [res, m] of this.states) m.visible = mine && d.resolution === res;
    for (let i = 0; i < 4; i++) {
      const at = FLAG_AT(this.world, i);
      const who = v?.template === "claim_race" ? d.pegs[i]! : "none";
      this.m4.makeScale(who === "none" ? 0 : 1, who === "none" ? 0 : 1, who === "none" ? 0 : 1).setPosition(at.x, at.y, at.z);
      this.flags.setMatrixAt(i, this.m4);
      this.flags.setColorAt(i, this.colour.set(who === "rival" ? P.synGreen : P.glowLamp));
    }
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
  }

  /** What is visible now (for the tests): the names of the shown meshes. */
  shown(): string[] {
    const out: string[] = [];
    for (const m of [...this.work, this.cut, ...this.states.values()]) if (m.visible) out.push(m.name);
    return out;
  }
}

void VESPER_STOCK;
