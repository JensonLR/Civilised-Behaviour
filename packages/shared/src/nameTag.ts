import { NPC } from "./campaignTypes.ts";

/**
 * Name plates are CULLED, never clamped (D-034 rule 3): a plate is shown only when it can sit where it points. Pure; the client's `NameTags` calls it
 * once per actor per frame with the projected anchor (NDC x/y/z of the point above the head) and the anchor's screen y in CSS pixels.
 *
 * show: in front of the camera (ndc z < 1), inside the frame (|ndc| <= 0.96, so a plate never has to be pushed back on screen), BELOW the compass
 * band (screen y >= COMPASS_BAND_PX) and inside the range of its role: the party and its hired hands 40 m, the Warden, hostages and drivers 30 m,
 * soldiers and enemies 12 m (26 m while the camera's owner has a line of sight to them). alpha fades from 1 to 0 over the last quarter of the range.
 */

export const COMPASS_BAND_PX = 72;
export const TAG_FRAME = 0.96;
export const TAG_RANGE = { party: 40, notable: 30, soldier: 12, soldierInSight: 26 } as const;

export interface TagState { show: boolean; alpha: number }

/** Range (metres) at which a plate of this role (`PlayerState.npc`: 0 = a human player) may show. */
export function tagRange(role: number, inSight: boolean): number {
  switch (role) {
    case NPC.NONE:
    case NPC.PORTER:
    case NPC.HIRED_RIFLE:
    case NPC.SURGEON:
      return TAG_RANGE.party;
    case NPC.WARDEN:
    case NPC.CHAMBERLAIN:
    case NPC.CLAIMANT:
    case NPC.HOSTAGE:
    case NPC.DRIVER:
      return TAG_RANGE.notable;
    default:
      return inSight ? TAG_RANGE.soldierInSight : TAG_RANGE.soldier;
  }
}

/** Whether a downed body of this role keeps its plate (your party's do: someone has to be found and revived; the Ward's soldiers lying about do not). */
const keepsPlateWhenDown = (role: number): boolean => role === NPC.NONE || role === NPC.PORTER || role === NPC.HIRED_RIFLE || role === NPC.SURGEON || role === NPC.HOSTAGE || role === NPC.DRIVER;

export function tagState(distM: number, ndcX: number, ndcY: number, ndcZ: number, role: number, down: boolean, topPx: number, inSight = false, out: TagState = { show: false, alpha: 0 }): TagState {
  out.show = false;
  out.alpha = 0;
  if (!Number.isFinite(distM + ndcX + ndcY + ndcZ + topPx)) return out;
  if (ndcZ >= 1 || ndcZ < -1) return out; // behind the camera (or the far plane)
  if (Math.abs(ndcX) > TAG_FRAME || Math.abs(ndcY) > TAG_FRAME) return out;
  if (topPx < COMPASS_BAND_PX) return out;
  if (down && !keepsPlateWhenDown(role)) return out;
  const range = tagRange(role, inSight);
  if (distM > range || distM < 0) return out;
  const fadeFrom = range * 0.75;
  out.alpha = distM <= fadeFrom ? 1 : (range - distM) / (range - fadeFrom);
  out.show = out.alpha > 0.02;
  if (!out.show) out.alpha = 0;
  return out;
}
