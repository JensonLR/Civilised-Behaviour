import { FLAG, NPC } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { BattleLedger, LEDGER_MAX, type LedgerRow } from "./battleLedger.ts";

const rows = (list: Record<string, LedgerRow>) => ({ forEach: (cb: (r: LedgerRow, id: string) => void) => Object.entries(list).forEach(([id, r]) => cb(r, id)) });

describe("BattleLedger", () => {
  it("counts a body once, when it is first seen down, and keeps the mark after it is revived", () => {
    const l = new BattleLedger();
    const list: Record<string, LedgerRow> = { a: { npc: NPC.SENTRY, x: 1, z: 2, flags: FLAG.DOWNED }, p: { npc: 0, x: 5, z: 5, flags: 0 } };
    l.note(rows(list));
    l.note(rows(list));
    expect(l.tally).toEqual({ dead: 1, downed: 0, blasts: 0 });
    list.a!.flags = 0; // got up (a drunk sentry): the field keeps its mark, and he does not count twice
    l.note(rows(list));
    expect(l.tally.dead).toBe(1);
    expect(l.centres).toHaveLength(1);
  });

  it("counts the party's own as downed and the hostile as dead", () => {
    const l = new BattleLedger();
    l.note(rows({ me: { npc: 0, x: 0, z: 0, flags: FLAG.DOWNED }, h: { npc: NPC.DESERTER, x: 3, z: 3, flags: FLAG.DOWNED }, r: { npc: NPC.HIRED_RIFLE, x: 4, z: 4, flags: FLAG.DOWNED } }));
    expect(l.tally).toEqual({ dead: 1, downed: 2, blasts: 0 });
  });

  it("changes its revision only when something new happens, and caps the sites", () => {
    const l = new BattleLedger();
    const r0 = l.revision;
    l.note(rows({ a: { npc: 0, x: 0, z: 0, flags: 0 } }));
    expect(l.revision).toBe(r0);
    for (let i = 0; i < 20; i++) l.noteBlast(i, i);
    for (let i = 0; i < 20; i++) l.note(rows({ [`n${i}`]: { npc: NPC.SENTRY, x: i, z: 0, flags: FLAG.DOWNED } }));
    expect(l.centres.filter((c) => c.kind === "blast")).toHaveLength(LEDGER_MAX.blasts);
    expect(l.centres.filter((c) => c.kind === "casualty")).toHaveLength(LEDGER_MAX.casualties);
    expect(l.tally.blasts).toBe(20);
    l.reset();
    expect(l.tally).toEqual({ dead: 0, downed: 0, blasts: 0 });
    expect(l.centres).toHaveLength(0);
  });
});
