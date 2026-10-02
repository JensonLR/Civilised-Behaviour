// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParleyView, RegionId, ScenarioTemplateId } from "@cb/shared";

vi.mock("../audio/index.ts", () => ({ playSfx: () => undefined, attachUiSounds: () => undefined }));
const { Parley } = await import("./Parley.ts");

/**
 * D-041: every Kessar parley used to be headed "An audience at the toll bar" with "She seems ...", including the colour-sergeant's ransom at the Orchard and the surveyor at
 * the Stone; and the asked line's parts were separated by runs of spaces, which HTML draws as one ("Toll asked: £53 Round 1 She seems neutral.").
 */
afterEach(() => {
  document.body.innerHTML = "";
});
const view = (toll: number): ParleyView => ({ round: 1, speaker: "Somebody", line: "Well?", toll, mood: "neutral", options: [{ id: "walk_away", label: "Walk away", cost: 0, hint: "" }] });
function framed(region: RegionId, template: ScenarioTemplateId | undefined, toll: number): { heading: string; meta: string } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const p = new Parley(host);
  p.open(view(toll), () => undefined, () => undefined, region, template);
  const out = { heading: host.querySelector(".society")!.textContent!, meta: host.querySelector(".meta")!.textContent! };
  p.dispose();
  return out;
}

describe("the parley sheet says where the talks are and what is asked (D-041)", () => {
  it("each Kessar contract has its own heading; only the Lamp-Warden is 'she'; nothing asked, no price", () => {
    expect(framed("kessar", "secure_crossing", 53)).toEqual({ heading: "An audience at the toll bar", meta: "Toll asked: £53 · Round 1 · She seems neutral." });
    const ransom = framed("kessar", "hostage_rescue", 40);
    expect(ransom.heading).toMatch(/Orchard/);
    expect(ransom.meta).toBe("Price asked: £40 · Round 1 · The camp seems neutral.");
    const border = framed("kessar", "border_incident", 0);
    expect(border.heading).toMatch(/Marker Stone/);
    expect(border.meta).not.toMatch(/£|She /);
    expect(framed("kessar", "convoy_ambush", 0).heading).toMatch(/picket/);
    expect(framed("kessar", undefined, 53).heading).toBe("An audience at the toll bar"); // (no contract known yet: the toll bar)
  });
  it("every region's asked line separates its parts with a visible mark, never with runs of spaces", () => {
    for (const [r, t] of [["kessar", "secure_crossing"], ["kessar", "hostage_rescue"], ["highmark", "succession_dispute"], ["vesper", undefined], ["saltmarket", undefined]] as const) {
      const { meta } = framed(r, t, 30);
      expect(meta, r).not.toMatch(/ {2,}/);
      expect(meta, r).toMatch(/ · Round 1 · /);
    }
  });
});
