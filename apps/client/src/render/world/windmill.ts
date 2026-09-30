import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { Kit, blend, type ColourFn } from "./kit.ts";

/**
 * The windmill on the second summit: the map's second visual goal (the Observatory is the first, the gate-tower the third). A tall whitewashed tower on a
 * stone plinth, a shingled cap with a long tail-pole to the ground, a gallery, and four latticed sails hung with cream cloth. Local frame: origin at the foot,
 * y up, the sails face +x. Sail vertices carry `aSway = 1` (the hills' shader turns them about the hub). Drawn inside the hills mesh: no extra draw.
 */

const W = PALETTE.world;
const cStone = new Color(W.vlStone);

/** Height of the hub above the foot and how far in front of the tower it stands (the sails' pivot in the local frame). */
export const WINDMILL = { hubY: 13.4, hubX: 3.6, sail: 12.5 } as const;

export function windmillGeometry(): BufferGeometry {
  const k = new Kit({ sway: true });
  const wash: ColourFn = (p, n, out) => {
    blend(out, W.vlPlaster, W.vlPlasterShade, 0.1 + 0.3 * Math.abs(Math.sin(p.y * 1.7 + Math.atan2(p.z, p.x) * 3)));
    if (p.y < 2.4) out.lerp(cStone, (0.5 * (2.4 - p.y)) / 2.4);
    void n;
  };
  // plinth and tower
  k.add(new CylinderGeometry(3.9, 4.2, 1.6, 10), { at: [0, 0.8, 0], colour: (p, _n, out) => blend(out, W.vlStone, W.vlStoneDark, 0.3 + 0.4 * Math.abs(Math.sin(p.x * 3 + p.z * 5))), flat: true });
  k.add(new CylinderGeometry(2.45, 3.5, 12.4, 10, 3), { at: [0, 7.7, 0], colour: wash, flat: true, jitter: 0.03, seed: 41 });
  // gallery
  k.add(new CylinderGeometry(3.25, 3.25, 0.28, 10), { at: [0, 9.6, 0], colour: W.plankDark, flat: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.limb([Math.cos(a) * 3.15, 9.7, Math.sin(a) * 3.15], [Math.cos(a) * 3.15, 10.7, Math.sin(a) * 3.15], 0.07, 0.07, W.plankDark, 4);
  }
  k.add(new TorusGeometry(3.15, 0.07, 3, 12), { at: [0, 10.7, 0], rot: [Math.PI / 2, 0, 0], colour: W.plankDark, flat: true });
  // door and windows
  k.add(new BoxGeometry(0.2, 2.4, 1.3), { at: [3.3, 2.2, 0], colour: W.vlDoor, flat: true });
  for (const [y, a] of [[6.2, 0.9], [6.2, -0.9], [8.2, 2.3], [8.0, -2.4]] as const) k.add(new BoxGeometry(0.2, 0.8, 0.5), { at: [Math.cos(a) * 3.0, y, Math.sin(a) * 3.0], rot: [0, -a, 0], colour: W.vlSoot, flat: true });
  // cap: a shingled cone with a lip, a finial, and the tail-pole reaching down behind
  k.add(new CylinderGeometry(3.05, 3.15, 0.5, 10), { at: [0, 13.55, 0], colour: W.millCap, flat: true });
  k.add(new ConeGeometry(3.15, 3.6, 10, 3), { at: [0, 15.55, 0], colour: (p, _n, out) => blend(out, W.millCap, W.plankDark, 0.5 * (Math.floor((p.y + 2) * 2.2) & 1)), flat: true, jitter: 0.03, seed: 42 });
  k.add(new SphereGeometry(0.22, 6, 4), { at: [0, 17.5, 0], colour: W.vlHeraldGold, flat: true });
  k.limb([-2.6, 14.2, 0], [-10.5, 0.9, 0], 0.18, 0.13, W.plankDark, 5);
  k.add(new TorusGeometry(0.85, 0.09, 3, 8), { at: [-10.4, 1.0, 0], rot: [0, Math.PI / 2, 0], colour: W.plankDark, flat: true });
  // the hub and the four sails (latticed frames with cloth, turning together)
  const hub = [WINDMILL.hubX, WINDMILL.hubY, 0] as const;
  k.add(new CylinderGeometry(0.4, 0.5, 1.2, 8), { at: [hub[0] - 0.2, hub[1], 0], rot: [0, 0, Math.PI / 2], colour: W.plankDark, flat: true, sway: 1 });
  k.add(new SphereGeometry(0.5, 6, 5), { at: [hub[0] + 0.5, hub[1], 0], colour: W.vlHeraldGold, flat: true, sway: 1 });
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * Math.PI * 2 + 0.3;
    // local sail frame: along the arm (u), across it (v) in the y-z plane
    const at = (u: number, v: number, dx = 0): [number, number, number] => [hub[0] + dx, hub[1] + Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v];
    k.limb(at(0.4, 0), at(WINDMILL.sail, 0), 0.2, 0.12, W.plankDark, 5, false, 1);
    // the frame: two long rails and rungs, and cloth over the outer two thirds
    for (const side of [-0.9, 0.9]) k.limb(at(2.6, side, 0.05), at(WINDMILL.sail - 0.2, side, 0.05), 0.07, 0.07, W.plankDark, 4, false, 1);
    for (let r = 0; r < 9; r++) k.limb(at(2.6 + r * 1.1, -0.9, 0.05), at(2.6 + r * 1.1, 0.9, 0.05), 0.05, 0.05, W.plankDark, 3, false, 1);
    const cloth = new BoxGeometry(0.05, WINDMILL.sail - 5.3, 1.7);
    // the box's y axis runs along the arm: rotate it about x to lie along direction a
    k.add(cloth, { at: [hub[0] + 0.1, hub[1] + Math.cos(a) * (3.4 + (WINDMILL.sail - 5.3) / 2), Math.sin(a) * (3.4 + (WINDMILL.sail - 5.3) / 2)], rot: [a, 0, 0], colour: (p, n, out) => blend(out, W.sail, W.vlPlasterShade, 0.1 + 0.25 * Math.abs(Math.sin(p.y * 2.1)) + (n.x < 0 ? 0.15 : 0)), flat: true, sway: 1 });
  }
  return k.build()!;
}
