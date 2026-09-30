import { describe, expect, it } from "vitest";
import { FIELDS, HISTORY_KEYS, PALETTES, type FieldDef } from "@cb/procedural";
import { SECTIONS } from "./CharacterCreator.ts";
import { fieldsOfTab, tabOfGroup } from "./creatorLogic.ts";

describe("character creator sections", () => {
  it("every option the catalog offers has a heading on its page (nothing lands in the wrong section by accident)", () => {
    for (const tab of ["body", "face", "clothes", "colour"] as const) {
      const listed = new Set(SECTIONS[tab].flatMap((s) => s.keys));
      for (const f of FIELDS as readonly FieldDef[]) {
        if (tabOfGroup(f.group) !== tab) continue;
        expect(listed.has(f.key), `${tab}: ${f.key} is not in any section`).toBe(true);
      }
      // ... and every listed key is a real field of that page (a renamed field would silently drop out)
      for (const k of listed) expect(tabOfGroup((FIELDS as readonly FieldDef[]).find((f) => f.key === k)?.group ?? "history"), `${k}`).toBe(tab);
    }
  });

  it("every editable field appears exactly once across the pages, in section order", () => {
    const seen: string[] = [];
    for (const tab of ["body", "face", "clothes", "colour"] as const) {
      const rows = fieldsOfTab(tab);
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.section).toBeGreaterThanOrEqual(rows[i - 1]!.section);
      seen.push(...rows.map((r) => r.field.key));
    }
    expect(new Set(seen).size).toBe(seen.length);
    const editable = (FIELDS as readonly FieldDef[]).filter((f) => f.group !== "history").map((f) => f.key);
    expect([...seen].sort()).toEqual([...editable].sort());
  });

  it("history stays out of the creator, colour fields have swatches, and every choice has a label per option", () => {
    for (const f of FIELDS as readonly FieldDef[]) {
      if (f.group === "history") expect(HISTORY_KEYS.includes(f.key as never) || f.key === "burnt" || f.key === "teeth" || f.key === "scars" || f.key === "eyepatch").toBe(true);
      if (f.group === "colour" && f.key !== "skin") expect(PALETTES[f.key], `${f.key} needs swatches`).toBeDefined();
      if (f.kind === "choice" && f.group !== "colour") {
        expect(f.options?.length, `${f.key} has labels`).toBe(f.max + 1);
        for (const o of f.options!) expect(o.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
