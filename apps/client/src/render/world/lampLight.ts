import { Color, Vector3, Vector4, type Camera } from "three";
import { PALETTE } from "@cb/shared";

/**
 * Lamp pools: the lanterns light what is around them. A lantern was an additive glow sprite and nothing more, so at night (and in rain and mist)
 * it read as a speck with nothing lit under it. Every region's lanterns are registered here when its glow is built (`buildLanternGlow`); each frame
 * the `LAMP_SLOTS` nearest the camera go to the toon shader (`uLamps`: position IN VIEW SPACE, so a fragment needs no matrix per lamp, and how brightly it burns), which adds the lantern's warm colour in
 * four toon bands (the campfire's are three), falling off about as the square, only on surfaces that face the lamp (the far side of a wall stays dark).
 * Allocation-free per frame.
 */
export const LAMP_SLOTS = 8;
/** How far a lantern's pool reaches (m). */
export const LAMP_REACH = 6.5;

export const lampLight = {
  uLamps: { value: Array.from({ length: LAMP_SLOTS }, () => new Vector4(0, -1000, 0, 0)) },
  uLampCol: { value: new Color(PALETTE.camp.glowLantern) },
};

let xyz = new Float32Array(0);
let base = new Float32Array(0);
let count = 0;
/** The region's night level (its ambient `uLamp`), read each frame. */
let level: { value: number } | undefined;
const pick = new Int32Array(LAMP_SLOTS);
const pickD = new Float64Array(LAMP_SLOTS);

/** The region's lanterns (world positions of the flames) and each one's floor level (a lamp in a dark room burns at noon). Replaces the last region's. */
export function setLamps(positions: readonly { x: number; y: number; z: number }[], lit: readonly number[], night: { value: number }): void {
  count = positions.length;
  xyz = new Float32Array(count * 3);
  base = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = positions[i]!;
    xyz[i * 3] = p.x;
    xyz[i * 3 + 1] = p.y;
    xyz[i * 3 + 2] = p.z;
    base[i] = lit[i] ?? 0;
  }
  level = night;
}

const v = new Vector3();

/** Puts the `LAMP_SLOTS` lanterns nearest the camera in the shader's slots, in the camera's view space; an unused slot burns at 0. */
export function updateLamps(camera: Camera): void {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements; // (the camera's world position: it may hang from a rig)
  const cx = e[12]!, cy = e[13]!, cz = e[14]!;
  const night = level ? level.value : 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3]! - cx, dy = xyz[i * 3 + 1]! - cy, dz = xyz[i * 3 + 2]! - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (n < LAMP_SLOTS) {
      pick[n] = i;
      pickD[n] = d;
      n++;
      continue;
    }
    // replace the farthest kept, if this one is nearer
    let far = 0;
    for (let k = 1; k < LAMP_SLOTS; k++) if (pickD[k]! > pickD[far]!) far = k;
    if (d < pickD[far]!) {
      pick[far] = i;
      pickD[far] = d;
    }
  }
  const slots = lampLight.uLamps.value;
  for (let k = 0; k < LAMP_SLOTS; k++) {
    const s = slots[k]!;
    if (k < n) {
      const i = pick[k]!;
      v.set(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!).applyMatrix4(camera.matrixWorldInverse);
      s.set(v.x, v.y, v.z, Math.max(base[i]!, night));
    } else s.set(0, -1000, 0, 0);
  }
}
