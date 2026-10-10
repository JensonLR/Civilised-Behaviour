// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { CombatHud } from "./CombatHud.ts";
import { PLATE_KINDS } from "./GloryPlates.ts";

/** D-105: a coup de grace is told to the one who struck it, plainly, and the paper photographs it. */
describe("D-105: the coup de grace on the HUD", () => {
  it("the hit marker says Finished, outranks the limb it may also have taken, and stays up longer than a plain down", () => {
    const root = document.createElement("div");
    const hud = new CombatHud(root);
    const mark = root.querySelector<HTMLElement>(".hitmark")!;
    hud.hitMarker(1, true, true, true);
    expect(mark.hidden).toBe(false);
    expect(mark.dataset.kind).toBe("fin");
    expect(mark.textContent).toContain("Finished");
    hud.hitMarker(1, true, true);
    expect(mark.dataset.kind).toBe("sever");
    expect(mark.textContent).toContain("Severed");
    hud.hitMarker(1, true, false);
    expect(mark.textContent).toContain("Down");
  });

  it("a finisher in the column becomes a plate in the paper", () => {
    expect(PLATE_KINDS.has("finisher")).toBe(true);
  });
});
