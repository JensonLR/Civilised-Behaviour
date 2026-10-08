// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { TERMS, TEMPLATE_IDS } from "@cb/shared";
import { FIGHTING_LABEL, termsDetails } from "./Pause.ts";

describe("D-086: the pause sheet prints a contract's terms in full", () => {
  it("how it is won, settled and lost, what fighting does there, and the how-to paragraph with the key named", () => {
    const d = termsDetails("border_incident", "Wade out to the Stone and Use to talk to either side.", false)!;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary")!.textContent).toBe("How this contract is won, and lost");
    expect(d.querySelector(".howto")!.textContent).toMatch(/Use \(.+\) to talk/);
    const labels = [...d.querySelectorAll("dt")].map((e) => e.textContent);
    expect(labels).toEqual(["Won by", "Lost if", FIGHTING_LABEL.forbidden]);
    expect(d.textContent).toContain(TERMS.border_incident.rule);
    for (const w of TERMS.border_incident.win) expect(d.textContent).toContain(w);
    // a contract with a "short of a win" ending lists it
    expect([...termsDetails("outpost_raid", "", true)!.querySelectorAll("dt")].map((e) => e.textContent)).toContain("Settled, short of a win");
    for (const id of TEMPLATE_IDS) expect(termsDetails(id, "", false), id).toBeDefined();
  });
});
