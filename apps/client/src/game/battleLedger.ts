import { FLAG, NPC_SIDE } from "@cb/shared";
import type { AftermathCentre, AftermathTally } from "../render/world/aftermath.ts";

/**
 * WHAT THE FIELD REMEMBERS (D-038, docs/_notes/polish2.md section 7). The battlefield's aftermath (`render/world/aftermath.ts`) is a pure function of a tally and a list of sites; this is the
 * client's running record of them, kept from the rows it already holds (nothing travels the wire): the first time a body is seen DOWNED its place becomes a casualty site and counts once
 * (a hostile or a bystander as "dead", one of the party as "downed"), and a blast adds a blast site. A body being revived or carried off does not take its mark back: the field stays as the
 * fight left it until the party sails (`reset`). Sites are capped so the plan stays a picture (the newest win). Allocation only when a NEW casualty or blast is first seen.
 */

/** The row fields the ledger reads (a replicated player row fits as it is). */
export interface LedgerRow {
  npc: number;
  x: number;
  z: number;
  flags: number;
}

export const LEDGER_MAX = { casualties: 8, blasts: 6 } as const;

export class BattleLedger {
  private readonly seen = new Set<string>();
  private readonly sites: AftermathCentre[] = [];
  private blastSites: AftermathCentre[] = [];
  private dead = 0;
  private downed = 0;
  private blasts = 0;
  private rev = 0;

  /** Changes whenever the tally or the sites do (cheap to compare every frame). */
  get revision(): number {
    return this.rev;
  }

  /** Reads the rows once a frame; `selfId` is the local player (a downed self is a casualty like any other). */
  note(rows: { forEach(cb: (row: LedgerRow, id: string) => void): void }): void {
    rows.forEach(this.onRow);
  }

  private readonly onRow = (row: LedgerRow, id: string): void => {
    if ((row.flags & FLAG.DOWNED) === 0 || this.seen.has(id)) return;
    this.seen.add(id);
    const side = NPC_SIDE[row.npc];
    const ally = row.npc === 0 || side === "party";
    if (ally) this.downed++;
    else this.dead++;
    this.sites.push({ x: row.x, z: row.z, kind: "casualty", w: ally ? 1 : 1.2 });
    if (this.sites.length > LEDGER_MAX.casualties) this.sites.shift();
    this.rev++;
  };

  /** A shell or a barrel went off at (x, z). */
  noteBlast(x: number, z: number): void {
    this.blasts++;
    this.blastSites.push({ x, z, kind: "blast", w: 1 });
    if (this.blastSites.length > LEDGER_MAX.blasts) this.blastSites = this.blastSites.slice(-LEDGER_MAX.blasts);
    this.rev++;
  }

  /** What the battle cost so far. */
  get tally(): AftermathTally {
    return { dead: this.dead, downed: this.downed, blasts: this.blasts };
  }

  /** The sites, casualties then blasts (the plan picks by kind). */
  get centres(): readonly AftermathCentre[] {
    return [...this.sites, ...this.blastSites];
  }

  reset(): void {
    this.seen.clear();
    this.sites.length = 0;
    this.blastSites = [];
    this.dead = 0;
    this.downed = 0;
    this.blasts = 0;
    this.rev++;
  }
}
