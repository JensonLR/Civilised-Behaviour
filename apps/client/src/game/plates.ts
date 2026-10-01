import { COMMAND_IDS, FLAG, moraleBand } from "@cb/shared";

/**
 * Name-plate bookkeeping for the frame loop (R: per-frame allocation). Two costs used to be paid for every NPC every frame: a string rebuilt from the name, the
 * hand's order and nerve, and a line-of-sight ray. Here the text is rebuilt only when (name, connected, down, order, band) changes, and the ray is cached per
 * NPC for `RAY_TTL_S`, with a per-frame budget of ceil(NPCs wanting a ray / RAY_SPREAD) so a crowd re-checks a slice of itself each frame rather than all at once.
 */

export const RAY_TTL_S = 0.15;
/** About how many frames a plate's cached ray lives at 60 fps; the budget divisor. */
export const RAY_SPREAD = 9;

/** The rows a plate reads. */
export interface PlateRow {
  name: string;
  connected: boolean;
  flags: number;
  npc: number;
  cmd: number;
  morale: number;
}

interface Entry {
  name: string;
  connected: boolean;
  down: boolean;
  cmd: number;
  band: string;
  hand: boolean;
  text: string;
  rayAt: number;
  sight: boolean;
  seen: number;
}

const FOLLOW = "follow";

export class PlateCache {
  private readonly entries = new Map<string, Entry>();
  private frame = 0;
  private budget = 1;
  private wanted = 0;
  private wantedLast = 0;
  private touched = 0;

  constructor(private readonly handRoles: ReadonlySet<number>) {}

  get size(): number {
    return this.entries.size;
  }

  /** Call once per frame before the `text`/`sight` calls. */
  beginFrame(): void {
    this.frame++;
    this.wantedLast = this.wanted;
    this.wanted = 0;
    this.touched = 0;
    this.budget = Math.max(1, Math.ceil(this.wantedLast / RAY_SPREAD));
  }

  /** Call once per frame after them: forgets the plates of actors that left. */
  endFrame(): void {
    if (this.entries.size <= this.touched + 32) return;
    for (const [id, e] of this.entries) if (e.seen !== this.frame) this.entries.delete(id);
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { name: "", connected: true, down: false, cmd: -1, band: "", hand: false, text: "", rayAt: -1e9, sight: false, seen: 0 };
      this.entries.set(id, e);
    }
    if (e.seen !== this.frame) {
      e.seen = this.frame;
      this.touched++;
    }
    return e;
  }

  /** The plate's text, rebuilt only on a change of (name, connected, down, order, nerve band). */
  text(id: string, p: PlateRow): string {
    const e = this.entry(id);
    const down = (p.flags & FLAG.DOWNED) !== 0;
    const hand = !down && this.handRoles.has(p.npc);
    const band = hand ? moraleBand(p.morale) : "";
    const cmd = hand ? p.cmd : -1;
    if (e.text === "" || e.name !== p.name || e.connected !== p.connected || e.down !== down || e.hand !== hand || e.cmd !== cmd || e.band !== band) {
      e.name = p.name;
      e.connected = p.connected;
      e.down = down;
      e.hand = hand;
      e.cmd = cmd;
      e.band = band;
      let t = (p.connected ? p.name : `${p.name} (reconnecting)`) + (down ? " ✚ DOWN" : "");
      if (hand) t += ` · ${cmd >= 0 && cmd < COMMAND_IDS.length ? COMMAND_IDS[cmd]! : FOLLOW} · ${band}`;
      e.text = t;
    }
    return e.text;
  }

  /**
   * Is a line-of-sight ray due for this NPC now (its cached answer is older than the TTL and this frame's budget allows)? A `true` spends one ray of the budget: the
   * caller casts it and `report`s the answer. Call only for NPCs inside the plate's range.
   */
  due(id: string, nowS: number): boolean {
    const e = this.entry(id);
    this.wanted++;
    if (nowS - e.rayAt < RAY_TTL_S || this.budget <= 0) return false;
    this.budget--;
    e.rayAt = nowS;
    return true;
  }

  report(id: string, sight: boolean): void {
    const e = this.entries.get(id);
    if (e) e.sight = sight;
  }

  /** The last answer (false for an NPC never checked). */
  sight(id: string): boolean {
    return this.entries.get(id)?.sight ?? false;
  }
}
