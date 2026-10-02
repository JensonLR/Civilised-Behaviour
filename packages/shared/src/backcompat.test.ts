import { describe, expect, it } from "vitest";
import { askingToll, applyOutcome, newCampaign, RESOLUTIONS, TEMPLATE_RESOLUTIONS } from "./factions.ts";
import { generatePaper } from "./newspaper.ts";
import { newScenario } from "./scenario.ts";
import { dealComplication } from "./chaos.ts";
import { garrisonRoster } from "./garrison.ts";
import { pickTemplate, REGION_TEMPLATES } from "./scenarios/registry.ts";
import { hash3 } from "./rng.ts";
import type { CampaignState, ScenarioTemplateId } from "./campaignTypes.ts";

/**
 * D-035 back-compat: every function that gained a TRAILING OPTIONAL parameter (a rival presence, paper extras) must produce byte-identical output when it is absent.
 * The golden hash below was recorded from the code BEFORE those edits, over 200 campaigns (each a different seed and a different scripted history).
 */
export function campaignFor(seed: number): CampaignState {
  let c = newCampaign(seed);
  const n = hash3(seed, 1, 0xbeef) % 7;
  for (let i = 0; i < n; i++) {
    // D-036: Kessar's four only (the golden digest was recorded before Highmark existed)
    const tpl = REGION_TEMPLATES.kessar[hash3(seed, i, 0xa1) % REGION_TEMPLATES.kessar.length] as ScenarioTemplateId;
    const list = TEMPLATE_RESOLUTIONS[tpl];
    const resolution = list[hash3(seed, i, 0xa2) % list.length]!;
    c = applyOutcome(c, {
      scenario: tpl, resolution, toll: 30 + (hash3(seed, i, 3) % 40), paid: hash3(seed, i, 4) % 40, bridge: resolution === "sabotaged" ? "collapsed" : "intact", brokePromise: hash3(seed, i, 5) % 5 === 0, seconds: 30,
      tally: { wounded: hash3(seed, i, 6) % 3, downed: 0, limbsLost: 0, garrisonKilled: hash3(seed, i, 7) % 3, garrisonRouted: 0, civiliansHarmed: hash3(seed, i, 8) % 2, rivalKilled: hash3(seed, i, 9) % 2 },
    });
  }
  return c;
}

export function goldenDigest(): string {
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  };
  for (let seed = 1; seed <= 200; seed++) {
    const c = campaignFor(seed);
    mix(JSON.stringify([askingToll(c), pickTemplate(c, "kessar", seed), newScenario(c, 40), generatePaper(c, seed), garrisonRoster(c, seed)]));
    for (const id of REGION_TEMPLATES.kessar) mix(dealComplication(c, id, seed));
  }
  return h.toString(16);
}

describe("D-035 back-compat", () => {
  it("absent extras / presence leave every old output byte-identical", () => {
    expect(RESOLUTIONS.length).toBe(45);   // 20 at Kessar + 5 at Highmark (D-036) + 16 at Vesper and Saltmarket (D-037) + the strike's 4 (D-042); the digest covers Kessar's only
    // re-recorded ONCE at D-040 for a deliberate copy fix in the paper's PROMISES lines ("1 undertakings are"); verified first that the old text still gave e36d8edd on the new code
    expect(goldenDigest()).toBe("82698a61");
  });
});
