import { BoxGeometry, type BufferGeometry } from "three";
import { HIGHMARK, HIGHMARK_SITES, PALETTE, hash3, type CollisionWorld } from "./shared.ts";
import { Kit } from "../kit.ts";

/**
 * The Reapers' Strike's two props, as scenery (D-046; never collision, never decides anything): the granary's SCALE, a timber gallows with an iron balance whose near pan hangs
 * over the royal bushel's spot (HIGHMARK_SITES.strike.scale), so "the bushel on the granary scale" is a thing you can see; and the Compact's SCYTHES, laid down in the grass at
 * the picket line (the brief: "the Compact has laid down its scythes"), shown only while the strike is on. Palette colours only; one merged geometry each.
 */

const P = PALETTE.highmark;
const box = (): BoxGeometry => new BoxGeometry(1, 1, 1);

/** The scale. Its frame stands along the terrace (tangent to the hill), the bushel's spot under the near pan, the open side toward the edge so the bushel is reached from there. */
export function buildGranaryScale(world: CollisionWorld): BufferGeometry | undefined {
  const S = HIGHMARK_SITES.strike.scale;
  const C = HIGHMARK.centre;
  // local +x runs along the terrace (the tangent), so the frame never stands between the bushel and the terrace's open ground
  const yaw = Math.atan2(S.x - C.x, -(S.z - C.z));
  const k = new Kit().setBase(S.x, world.terrainHeight(S.x, S.z), S.z, yaw);
  const timber = P.timber, iron = P.iron;
  // the gallows: two posts and a crossbeam, the near post well clear of the bushel
  for (const x of [-0.75, 2.25]) k.add(box(), { at: [x, 1.25, 0], scale: [0.14, 2.5, 0.14], colour: timber });
  k.add(box(), { at: [0.75, 2.52, 0], scale: [3.3, 0.16, 0.16], colour: timber });
  k.add(box(), { at: [-0.75, 0.04, 0], scale: [0.5, 0.08, 0.5], colour: P.timberLight });
  k.add(box(), { at: [2.25, 0.04, 0], scale: [0.5, 0.08, 0.5], colour: P.timberLight });
  // the balance: a hook from the crossbeam, an iron beam tipped toward the bushel's side, a chain and a pan at each end (the far pan carries the Crown's weights)
  k.add(box(), { at: [0.75, 2.33, 0], scale: [0.04, 0.22, 0.04], colour: iron });
  k.add(box(), { at: [0.75, 2.2, 0], rot: [0, 0, -0.08], scale: [1.6, 0.06, 0.06], colour: iron });
  for (const [x, y] of [[0, 2.26], [1.5, 2.14]] as const) {
    k.add(box(), { at: [x, (y + 1.35) / 2, 0], scale: [0.025, y - 1.35, 0.025], colour: iron });
    k.add(box(), { at: [x, 1.33, 0], scale: [0.5, 0.04, 0.5], colour: iron });
  }
  k.add(box(), { at: [1.42, 1.41, 0.05], scale: [0.16, 0.12, 0.16], colour: iron });
  k.add(box(), { at: [1.6, 1.39, -0.06], scale: [0.12, 0.08, 0.12], colour: iron });
  return k.build();
}

/** Where the scythes lie: beside each picket and in a heap by the Foreperson (pure; the client view and the test read the same list). */
export function scytheSpots(): { x: number; z: number; yaw: number }[] {
  const T = HIGHMARK_SITES.strike;
  const out: { x: number; z: number; yaw: number }[] = [];
  // dropped at the picket's feet, the blade (at the snath's +x end) away from the picket so their own legs never hide it
  T.pickets.forEach((p, i) => {
    const a = 0.3 + (hash3(41, i, 1) / 4294967296) * 0.8;
    out.push({ x: p.x + Math.cos(a) * 1.1, z: p.z + Math.sin(a) * 1.1, yaw: a });
  });
  for (let i = 0; i < 3; i++) out.push({ x: T.foreperson.x - 1.4 + i * 0.25, z: T.foreperson.z + 1.1 - i * 0.2, yaw: 0.6 + i * 0.9 });
  return out;
}

/** The scythes, lying flat: an ash snath with its two grips, and a long curved iron blade at its head. */
export function buildScythes(world: CollisionWorld): BufferGeometry | undefined {
  const k = new Kit();
  for (const [i, s] of scytheSpots().entries()) {
    k.setBase(s.x, world.terrainHeight(s.x, s.z) + 0.03 + i * 0.005, s.z, s.yaw);
    k.add(box(), { at: [0, 0, 0], rot: [0, 0, 0], scale: [1.7, 0.05, 0.05], colour: P.timberLight });
    for (const x of [-0.35, 0.2]) k.add(box(), { at: [x, 0.02, 0.1], scale: [0.04, 0.04, 0.2], colour: P.timber });
    // the blade: three flat segments curving back from the head of the snath, iron with a bright honed edge (so it reads on the grass at a few metres)
    let bx = 0.85, bz = 0, a = Math.PI / 2;
    for (let j = 0; j < 3; j++) {
      const len = 0.34, wid = 0.12 - j * 0.03;
      const cx = bx + (Math.cos(a) * len) / 2, cz = bz + (Math.sin(a) * len) / 2;
      k.add(box(), { at: [cx, 0.01, cz], rot: [0, -a, 0], scale: [len, 0.014, wid], colour: P.iron });
      // the edge, on the blade's inner (concave) side
      const ox = -Math.sin(a) * (wid / 2 + 0.012), oz = Math.cos(a) * (wid / 2 + 0.012);
      k.add(box(), { at: [cx + ox, 0.012, cz + oz], rot: [0, -a, 0], scale: [len, 0.012, 0.025], colour: P.chalkShade });
      bx += Math.cos(a) * len;
      bz += Math.sin(a) * len;
      a += 0.38;
    }
  }
  k.clearBase();
  return k.build();
}
