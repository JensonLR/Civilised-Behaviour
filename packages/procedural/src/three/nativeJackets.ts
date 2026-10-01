import { PALETTE } from "@cb/shared";
import { CREAM, PartBuilder, singe } from "./parts.ts";
import { bandAround, frameAt, hangingStrip } from "./fit/torsoKit.ts";
import { mantleRings } from "./fit/mantleShape.ts";
import { dyeAt, tone } from "./bodyKit.ts";
import { JACKET, buttons, collar, pocket, placket, stripPatch, type TorsoView } from "./garments.ts";

/**
 * The fictional peoples' garments (D-038, polish2 section 4): what a Stone Smock, a Lamp Robe, a Herd Cloak, a Crepe Shawl, a Wading Smock and a Court Cloak add to the torso over the cut
 * the catalogue gives them (`JACKET_CUT`, `skirtSpec`). They are described by what they DO for the people who wear them, and none echoes a real people's dress: a smock yoked with lime-white
 * and toggled with bone, a lamp-wearer's robe with a brass toggle column and a lamp medallion, a layered herd mantle fringed with brass herd-tags, a mourning crepe shawl with a loose fringe,
 * a waterproof smock with a bib and braces and a rope, a court cloak with gilt sun-discs. The mantles are `mantleRings` (the same loft hair must lie outside of, hairBlockers.ts).
 */

const lime = (v: TorsoView): number => singe(tone(CREAM, 0.96), v.c.burnt);
const bone = (v: TorsoView): number => singe(tone(CREAM, 0.82), v.c.burnt);
const dye = (v: TorsoView, i: number): number => singe(dyeAt(PALETTE.cloth, i), v.c.burnt);
/** The mantle's own cloth: the wearer's hat dye (the overlay draws it from the people's dyes), never the coat's. */
const mantleDye = (v: TorsoView): number => dye(v, v.c.spec.hatColor === v.c.spec.jacketColor ? v.c.spec.hatColor + 4 : v.c.spec.hatColor);

/** A closed capelet over the shoulders and chest (`mantleRings`), with a rolled hem band and an optional fringe of hanging pieces. */
function mantle(v: TorsoView, lowFrac: number, m: number, cloth: number, hemC: number): Array<{ y: number; rx: number; rz: number; cx?: number; cz?: number }> {
  const { b, h } = v;
  const rings = mantleRings(v.c.P, v.rings, lowFrac, m, cloth, 1.04).map((r, i, a) => ({ ...r, color: i === a.length - 1 ? hemC : tone(cloth, 1.04 - 0.05 * (i / a.length)) }));
  b.loft(rings, cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
  void h;
  return rings;
}

export function dressNativeJacket(v: TorsoView, id: number): void {
  const { b, c, h, W } = v;
  const gold = c.accent;
  const coat = v.coat;
  switch (id) {
    case JACKET.STONE_SMOCK: {
      // the Mereborn work smock: a stand collar, a lime-white yoke across the shoulders, a bone-toggled placket and two big patch pockets
      collar(v, "stand", coat);
      bandAround(b, v.s, h * 0.74, h * 0.84, lime(v), { lift: 0.007, steps: 1, crease: true });
      placket(v, h * 0.4, h * 0.9, tone(lime(v), 0.92));
      buttons(v, [0.46, 0.58, 0.7, 0.82].map((f) => h * f), 0, bone(v), 0.017);
      for (const sx of [-1, 1]) pocket(v, sx * W * 0.6, h * 0.3, 0.11, 0.1, tone(coat, 0.88), false);
      break;
    }
    case JACKET.LAMP_ROBE: {
      // the Kessarine robe: a tall stand collar, a column of brass toggles, a sash at the waist and a lamp medallion on the chest
      collar(v, "high", coat);
      buttons(v, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((f) => h * f), 0, gold, 0.016);
      bandAround(b, v.s, h * 0.14, h * 0.24, v.trim, { lift: 0.008, steps: 1, crease: true });
      const fr = frameAt(v.s.atX(0, h * 0.62, 0));
      b.sphere(0.032, gold, fr.at(0, 0, 0.026), [1, 1, 0.45], fr.rot);
      b.sphere(0.017, singe(PALETTE.trim.sashGold, v.c.burnt), fr.at(0, 0, 0.04), [1, 1, 0.5], fr.rot);
      break;
    }
    case JACKET.HERD_CLOAK: {
      // the Marchers' cloak: a layered mantle to mid-chest over a broad coat, a hem band in the second dye, and a fringe of brass herd-tags
      const cloth = mantleDye(v);
      const hemC = tone(cloth, 0.7);
      const rings = mantle(v, 0.52, 0.045, cloth, hemC);
      const last = rings[rings.length - 1]!;
      if (PartBuilder_lod0()) for (let i = 0; i < 9; i++) {
        const phi = (i / 9) * Math.PI * 2 + 0.2;
        const x = Math.sin(phi) * last.rx * 0.97;
        const z = (last.cz ?? 0) - Math.cos(phi) * last.rz * 0.97;
        b.box(0.018, 0.034, 0.006, gold, [x, last.y - 0.012, z], [0, -phi, 0]);
      }
      break;
    }
    case JACKET.CREPE_SHAWL: {
      // the Vesperine mourning shawl: a close bodice under a crepe mantle that hangs to the waist, a loose fringe at its edge, and a bead-pin at the throat
      const cloth = mantleDye(v);
      const rings = mantle(v, 0.36, 0.04, cloth, tone(cloth, 0.6));
      const last = rings[rings.length - 1]!;
      if (PartBuilder_lod0()) for (let i = 0; i < 14; i++) {
        const phi = (i / 14) * Math.PI * 2 + 0.1;
        const x = Math.sin(phi) * last.rx;
        const z = (last.cz ?? 0) - Math.cos(phi) * last.rz;
        b.cylinder(0.006, 0.003, 0.09 + 0.018 * (i % 3), tone(cloth, 0.6), [x * 1.02, last.y - 0.045 - 0.009 * (i % 3), z * 1.02]);
      }
      b.sphere(0.017, gold, [0, h * 0.945, v.surf(h * 0.945) - 0.03], [1, 1, 0.6]);
      break;
    }
    case JACKET.WADING_SMOCK: {
      // the Brinefolk wading smock: a bib of oilcloth, two braces over the shoulders, a big kangaroo pocket and a rope belt with its knot
      collar(v, "stand", coat);
      const oil = tone(dye(v, 7), 0.96);
      stripPatch(v, h * 0.28, h * 0.84, () => -0.001, (y) => 0.62 - 0.25 * ((y - h * 0.28) / (h * 0.56)), oil, 0.009, 0, 8, 10);
      for (const sx of [-1, 1]) hangingStrip(b, v.s, sx * W * 0.4, h * 0.9, h * 0.58, 0.019, 0.0075, tone(oil, 0.8), { base: 0.011 });
      pocket(v, 0, h * 0.4, 0.17, 0.1, tone(coat, 0.84), false);
      const rope = singe(PALETTE.material.rope, v.c.burnt);
      bandAround(b, v.s, h * 0.16, h * 0.22, rope, { lift: 0.012, steps: 1, crease: true });
      b.sphere(0.026, rope, v.s.atX(W * 0.3, h * 0.19, 0.02).p);
      break;
    }
    case JACKET.COURT_CLOAK: {
      // the Marchers' court cloak: a long mantle to the waist in the main dye, a gilt hem band, a gilt sun-disc clasp at the throat and three more down the chest
      const hemC = singe(PALETTE.trim.sashGold, v.c.burnt);
      const rings = mantle(v, 0.3, 0.045, mantleDye(v), hemC);
      void rings;
      const fr = frameAt(v.s.atX(0, h * 0.93, 0));
      b.cylinder(0.03, 0.03, 0.01, gold, fr.at(0, 0, 0.05), [fr.rot[0] + Math.PI / 2, fr.rot[1], fr.rot[2]]);
      for (const f of [0.78, 0.64, 0.5]) {
        const q = frameAt(v.s.atX(0, h * f, 0));
        b.cylinder(0.02, 0.02, 0.008, gold, q.at(0, 0, 0.05), [q.rot[0] + Math.PI / 2, q.rot[1], q.rot[2]]);
      }
      break;
    }
    default:
      break;
  }
}

const PartBuilder_lod0 = (): boolean => PartBuilder.lod === 0;
