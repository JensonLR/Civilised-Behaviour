import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh } from "three";
import { PALETTE } from "@cb/shared";
import { holdUpright } from "./torch.ts";
import { toonMaterial } from "./world/toon.ts";

/**
 * A little pennant on a stick, held upright in a hand (D-095: the Ward's picket boys on the Siege of the Counting-House, a penny an hour, holding the Society's colours on each
 * picket mark). It is how a planted picket reads from across the field: the boy runs when a sally strikes his mark, and the flag goes with him. One shared stick and one
 * shared cloth for every pennant in the scene; the cloth stirs by a pure function of time and a per-pennant phase. Allocation-free per frame.
 */

const C = PALETTE.camp;
let shared: { stick: BufferGeometry; cloth: BufferGeometry; mat: ReturnType<typeof toonMaterial> } | undefined;
/** Paints a geometry's vertices one colour (the toon material reads vertex colours: without them it draws black). */
function paint(g: BufferGeometry, c: Color): BufferGeometry {
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) c.toArray(col, i * 3);
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}
function parts(): NonNullable<typeof shared> {
  if (!shared) {
    // a stick a little taller than a boy's reach, held a third of the way up; the cloth at its head, flying to one side
    const stick = new CylinderGeometry(0.018, 0.024, 1.5, 6);
    stick.translate(0, 0.45, 0);
    paint(stick, new Color(C.pole));
    // the Society's colours: the cloth, with a cream band across its middle third (the camp flag's own mark), coloured face by face so the band's edges are crisp (a vertex
    // test found no vertex inside a thin band, and the first look showed a plain red cloth)
    const cloth = new BoxGeometry(0.46, 0.3, 0.012, 3, 3, 1).toNonIndexed();
    cloth.translate(0.25, 0, 0);
    const red = new Color(C.flagCloth), cream = new Color(C.flagMark);
    const pos = cloth.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const mid = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      for (let j = 0; j < 3; j++) (Math.abs(mid) < 0.05 ? cream : red).toArray(col, (i + j) * 3);
    }
    cloth.setAttribute("color", new BufferAttribute(col, 3));
    shared = { stick, cloth, mat: toonMaterial({}) };
  }
  return shared;
}

/** One character's pennant: built on first use, hung on the hand bone, shown or hidden each frame. */
export class PennantHold {
  readonly group = new Group();
  private readonly cloth: Mesh;
  private readonly phase: number;

  constructor(seed: number) {
    const p = parts();
    const stick = new Mesh(p.stick, p.mat);
    stick.castShadow = true;
    this.cloth = new Mesh(p.cloth, p.mat);
    this.cloth.position.set(0.02, 1.05, 0);
    this.cloth.castShadow = true;
    this.group.add(stick, this.cloth);
    this.group.name = "pennant";
    this.group.visible = false;
    this.phase = (seed % 89) * 0.41;
  }

  /** Hangs the pennant on `hand` (the wrist bone). Call again after the rig is rebuilt. */
  attach(hand: Group): void {
    hand.add(this.group);
  }

  /** Shows it (or not), keeps it upright against the hand's world turn, and stirs the cloth. `t` is seconds. */
  update(on: boolean, t: number): void {
    this.group.visible = on;
    if (!on) return;
    holdUpright(this.group);
    this.cloth.rotation.y = 0.25 * Math.sin(t * 2.3 + this.phase) + 0.1 * Math.sin(t * 5.1 + this.phase * 1.7);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
