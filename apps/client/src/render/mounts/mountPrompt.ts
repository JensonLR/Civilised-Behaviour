import { FLAG } from "@cb/shared";
import { MOUNT, MOUNT_FLAG, MOUNT_KIND, MOUNT_PHASE, WAGON, hitchPoint, mountReach } from "@cb/shared";
import type { MountRowLike } from "./MountView.ts";

type Row = readonly [string, MountRowLike];
const hp = { x: 0, z: 0 };

/**
 * The INTERACT prompt a mount adds to the HUD. The same rules, in the same order, as the server's `Mounts.onInteract` (a prompt that promised what the server then refused
 * would be a lie): mounted riders unhitch, hitch beside a free tongue, or dismount; people holding a prop load it (or learn the wagon is full); people dragging a body load it;
 * otherwise unload at a wagon that has cargo, or mount the nearest free horse. Pure: plain data in, a line (or nothing) out.
 * It runs every frame: no allocation (indexed loops, one module scratch point); `MountPrompter` owns the reusable inputs for the live game.
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

const nearWagon = (r: MountRowLike, me: PromptMe): boolean => r.kind === MOUNT_KIND.wagon && r.phase !== MOUNT_PHASE.wrecked && (r.x - me.x) ** 2 + (r.z - me.z) ** 2 <= WAGON.loadReach * WAGON.loadReach; // no Math.hypot: it allocates per call

/** `rows` may be longer than `n` (a pooled array): only the first `n` count. */
export function mountPrompt(me: PromptMe, rows: ReadonlyArray<Row>, cargo: PromptCargo, n: number = rows.length): string | undefined {
  if ((me.flags & MOUNT_FLAG.MOUNTED) !== 0) {
    let horse: MountRowLike | undefined;
    for (let i = 0; i < n; i++) {
      const r = rows[i]![1];
      if (r.kind === MOUNT_KIND.horse && r.rider === me.sessionId) {
        horse = r;
        break;
      }
    }
    if (!horse) return MOUNT_PROMPTS.dismount;
    if (horse.hitch) return MOUNT_PROMPTS.unhitch;
    hitchPoint(me.x, me.z, me.facing, hp);
    for (let i = 0; i < n; i++) {
      const w = rows[i]![1];
      if (w.kind !== MOUNT_KIND.wagon || w.hitch || w.phase === MOUNT_PHASE.wrecked) continue;
      if (mountReach(hp.x, hp.z, w.x - Math.sin(w.facing) * WAGON.len, w.z - Math.cos(w.facing) * WAGON.len, MOUNT.reach)) return MOUNT_PROMPTS.hitch;
    }
    return MOUNT_PROMPTS.dismount;
  }
  if ((me.flags & (FLAG.DOWNED | FLAG.DRAGGED)) !== 0) return undefined;
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (nearWagon(rows[i]![1], me)) {
      first = i;
      break;
    }
  }
  if (me.holding && first >= 0) {
    const [id, w] = rows[first]!;
    return w.cargo + cargo.props(id) >= WAGON.bays.length ? MOUNT_PROMPTS.full : MOUNT_PROMPTS.load;
  }
  if (me.holding) return undefined;
  if ((me.flags & FLAG.DRAGGING) !== 0 && first >= 0) return cargo.bodies(rows[first]![0]) >= WAGON.bodyBays.length ? MOUNT_PROMPTS.full : MOUNT_PROMPTS.loadBody;
  for (let i = first < 0 ? n : first; i < n; i++) {
    const [id, r] = rows[i]!;
    if (nearWagon(r, me) && cargo.props(id) + cargo.bodies(id) > 0) return MOUNT_PROMPTS.unload;
  }
  const busy = (me.flags & (FLAG.CARRYING | FLAG.REVIVING | FLAG.OPERATING | FLAG.DRAGGING)) !== 0 || (me.missing & 3) === 3;
  for (let i = 0; i < n; i++) {
    const r = rows[i]![1];
    if (r.kind === MOUNT_KIND.horse && !r.rider && r.phase !== MOUNT_PHASE.wrecked && mountReach(me.x, me.z, r.x, r.z)) return busy ? undefined : MOUNT_PROMPTS.mount;
  }
  return undefined;
}

/** The replicated state the prompt reads (the room's `mounts`, `props` and `players`; plain stand-ins in tests). */
export interface PromptState {
  mounts: { readonly size: number; forEach(cb: (row: MountRowLike, id: string) => void): void };
  props: { forEach(cb: (p: { holder: string }) => void): void };
  players: { forEach(cb: (p: { dragger: string }) => void): void };
}

/** Is `holder` the string `wagon:<wid>`, without building it. */
const heldBy = (holder: string, wid: string): boolean => holder.length === 6 + wid.length && holder.startsWith("wagon:") && holder.endsWith(wid);

/**
 * The live game's per-frame caller: ONE reusable `PromptMe`, a pooled rows array (its tuples are refilled in place, never recreated while the herd is no bigger than before) and two
 * bound counters, so a frame with horses in the room allocates nothing (heap-delta test in MountView.test.ts).
 */
export class MountPrompter {
  private readonly me: PromptMe = { x: 0, z: 0, facing: 0, flags: 0, missing: 0, sessionId: "", holding: false };
  private readonly rows: [string, MountRowLike][] = [];
  private n = 0;
  private wid = "";
  private count = 0;
  private readonly take = (row: MountRowLike, id: string): void => {
    let t = this.rows[this.n];
    if (!t) {
      t = [id, row];
      this.rows.push(t);
    } else {
      t[0] = id;
      t[1] = row;
    }
    this.n++;
  };
  private readonly countProp = (p: { holder: string }): void => {
    if (heldBy(p.holder, this.wid)) this.count++;
  };
  private readonly countBody = (p: { dragger: string }): void => {
    if (heldBy(p.dragger, this.wid)) this.count++;
  };
  private readonly cargo: PromptCargo = {
    props: (wid) => {
      this.wid = wid;
      this.count = 0;
      this.state.props.forEach(this.countProp);
      return this.count;
    },
    bodies: (wid) => {
      this.wid = wid;
      this.count = 0;
      this.state.players.forEach(this.countBody);
      return this.count;
    },
  };

  constructor(private readonly state: PromptState, private readonly sessionId: () => string) {}

  now(x: number, z: number, facing: number, flags: number, missing: number): string | undefined {
    if (this.state.mounts.size === 0) return undefined;
    this.n = 0;
    this.state.mounts.forEach(this.take);
    const me = this.me;
    me.x = x;
    me.z = z;
    me.facing = facing;
    me.flags = flags;
    me.missing = missing;
    me.sessionId = this.sessionId();
    me.holding = (flags & FLAG.CARRYING) !== 0;
    return mountPrompt(me, this.rows, this.cargo, this.n);
  }
}
