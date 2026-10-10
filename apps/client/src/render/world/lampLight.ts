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

/** D-103: at most this many burning places light their surroundings, competing with the lanterns for the slots. */
export const FIRE_LAMPS = 4;
const fireXyz = new Float32Array(FIRE_LAMPS * 3);
const fireLit = new Float32Array(FIRE_LAMPS);
let fireCount = 0;

/** D-103: where the grass is burning (up to FIRE_LAMPS places, each with how brightly 0..1); `n` 0 puts them all out. Allocation-free. */
export function setFireLamps(xyzIn: Float32Array, lit: Float32Array, n: number): void {
  fireCount = Math.min(FIRE_LAMPS, Math.max(0, n));
  for (let i = 0; i < fireCount * 3; i++) fireXyz[i] = xyzIn[i]!;
  for (let i = 0; i < fireCount; i++) fireLit[i] = lit[i]!;
}

const at = (i: number, k: number): number => (i < count ? xyz[i * 3 + k]! : fireXyz[(i - count) * 3 + k]!);

/** Puts the `LAMP_SLOTS` lanterns (and burning places) nearest the camera in the shader's slots, in the camera's view space; an unused slot burns at 0. */
export function updateLamps(camera: Camera): void {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements; // (the camera's world position: it may hang from a rig)
  const cx = e[12]!, cy = e[13]!, cz = e[14]!;
  const night = level ? level.value : 0;
  let n = 0;
  const total = count + fireCount;
  for (let i = 0; i < total; i++) {
    const dx = at(i, 0) - cx, dy = at(i, 1) - cy, dz = at(i, 2) - cz;
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
      v.set(at(i, 0), at(i, 1), at(i, 2)).applyMatrix4(camera.matrixWorldInverse);
      s.set(v.x, v.y, v.z, i < count ? Math.max(base[i]!, night) : fireLit[i - count]! * Math.max(0.45, night));
    } else s.set(0, -1000, 0, 0);
  }
}
