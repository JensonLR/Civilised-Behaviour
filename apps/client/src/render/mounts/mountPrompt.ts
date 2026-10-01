import { FLAG } from "@cb/shared";
import { MOUNT, MOUNT_FLAG, MOUNT_KIND, MOUNT_PHASE, WAGON, hitchPoint, mountReach } from "@cb/shared";
import type { MountRowLike } from "./MountView.ts";

/**
 * The INTERACT prompt a mount adds to the HUD. The same rules, in the same order, as the server's `Mounts.onInteract` (a prompt that promised what the server then refused
 * would be a lie): mounted riders unhitch, hitch beside a free tongue, or dismount; people holding a prop load it (or learn the wagon is full); people dragging a body load it;
 * otherwise unload at a wagon that has cargo, or mount the nearest free horse. Pure: plain data in, a line (or nothing) out.
 */

export interface PromptMe {
  x: number;
  z: number;
  facing: number;
  flags: number;
  missing: number;
  sessionId: string;
  /** Holding a prop. */
  holding: boolean;
}

export interface PromptCargo {
  /** Props whose holder is `wagon:<id>`, and downed bodies whose dragger is `wagon:<id>`, by wagon id. */
  props: (wagonId: string) => number;
  bodies: (wagonId: string) => number;
}

export const MOUNT_PROMPTS = {
  mount: "Mount the horse (it has not been consulted)",
  dismount: "Dismount",
  hitch: "Hitch the wagon",
  unhitch: "Unhitch the wagon",
  load: "Load onto the wagon",
  loadBody: "Strap the casualty to the wagon",
  full: "The wagon is full",
  unload: "Unload the wagon",
} as const;

export function mountPrompt(me: PromptMe, rows: Iterable<readonly [string, MountRowLike]>, cargo: PromptCargo): string | undefined {
  const list = [...rows];
  if ((me.flags & MOUNT_FLAG.MOUNTED) !== 0) {
    const horse = list.find(([, r]) => r.kind === MOUNT_KIND.horse && r.rider === me.sessionId);
    if (!horse) return MOUNT_PROMPTS.dismount;
    if (horse[1].hitch) return MOUNT_PROMPTS.unhitch;
    const hp = { x: 0, z: 0 };
    hitchPoint(me.x, me.z, me.facing, hp);
    for (const [, w] of list) {
      if (w.kind !== MOUNT_KIND.wagon || w.hitch || w.phase === MOUNT_PHASE.wrecked) continue;
      if (mountReach(hp.x, hp.z, w.x - Math.sin(w.facing) * WAGON.len, w.z - Math.cos(w.facing) * WAGON.len, MOUNT.reach)) return MOUNT_PROMPTS.hitch;
    }
    return MOUNT_PROMPTS.dismount;
  }
  if ((me.flags & (FLAG.DOWNED | FLAG.DRAGGED)) !== 0) return undefined;
  const wagons = list.filter(([, r]) => r.kind === MOUNT_KIND.wagon && r.phase !== MOUNT_PHASE.wrecked && Math.hypot(r.x - me.x, r.z - me.z) <= WAGON.loadReach);
  if (me.holding && wagons.length > 0) {
    const [id, w] = wagons[0]!;
    return w.cargo + cargo.props(id) >= WAGON.bays.length ? MOUNT_PROMPTS.full : MOUNT_PROMPTS.load;
  }
  if (me.holding) return undefined;
  if ((me.flags & FLAG.DRAGGING) !== 0 && wagons.length > 0) {
    const [id] = wagons[0]!;
    return cargo.bodies(id) >= WAGON.bodyBays.length ? MOUNT_PROMPTS.full : MOUNT_PROMPTS.loadBody;
  }
  for (const [id] of wagons) if (cargo.props(id) + cargo.bodies(id) > 0) return MOUNT_PROMPTS.unload;
  const busy = (me.flags & (FLAG.CARRYING | FLAG.REVIVING | FLAG.OPERATING | FLAG.DRAGGING)) !== 0 || (me.missing & 3) === 3;
  for (const [, r] of list) {
    if (r.kind === MOUNT_KIND.horse && !r.rider && r.phase !== MOUNT_PHASE.wrecked && mountReach(me.x, me.z, r.x, r.z)) return busy ? undefined : MOUNT_PROMPTS.mount;
  }
  return undefined;
}
