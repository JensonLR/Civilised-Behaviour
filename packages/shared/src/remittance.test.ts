import { describe, expect, it } from "vitest";
import { TEMPLATE_RESOLUTIONS, applyOutcome, newCampaign } from "./factions.ts";
import { PRESS_GRADE, REMITTANCE, remit } from "./remittance.ts";
import type { ResolutionId, ScenarioOutcome, ScenarioTemplateId } from "./campaignTypes.ts";

const outcome = (scenario: ScenarioTemplateId, resolution: ResolutionId): ScenarioOutcome => ({
  scenario, resolution, toll: 0, paid: 0, bridge: "intact", brokePromise: false, seconds: 60,
  tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
});

describe("the Society's remittance (D-040)", () => {
  it("grades every ending of every contract, and pays loud triumphs best and abandonment least", () => {
    for (const [t, list] of Object.entries(TEMPLATE_RESOLUTIONS)) for (const r of list) expect(PRESS_GRADE[r], `${t}.${r}`).toBeDefined();
    expect(REMITTANCE.triumph).toBeGreaterThan(REMITTANCE.story);
    expect(REMITTANCE.story).toBeGreaterThan(REMITTANCE.embarrassment);
    expect(REMITTANCE.embarrassment).toBeGreaterThan(REMITTANCE.condolence);
    expect(REMITTANCE.condolence).toBeGreaterThan(0);
    expect(PRESS_GRADE.abandoned).toBe("condolence");
  });

  it("credits the purse after the ledger, never past the cap, and says so in one line", () => {
    const c = newCampaign(9);
    const after = applyOutcome(c, outcome("secure_crossing", "forced"));
    const r = remit(after, { resolution: "forced" });
    expect(r.c.purse).toBe(after.purse + REMITTANCE.triumph);
    expect(r.paid).toBe(REMITTANCE.triumph);
    expect(r.line).toContain(`£${REMITTANCE.triumph}`);
    expect(after.purse).toBe(c.purse); // (the input is untouched)
    const rich = remit({ ...after, purse: 99990 }, { resolution: "rescued" });
    expect(rich.c.purse).toBe(99999);
    expect(rich.paid).toBe(9);
  });

  it("the playtest's case: one modest expedition no longer leaves a campaign stranded on £4", () => {
    // £120, a crate of rounds (£10), a medical kit (£6), a horse (£28), a rifleman and a surgeon signed (£14 + £18), a £26 bribe: £4 left, as played
    const c = { ...newCampaign(3), purse: 120 - 10 - 6 - 28 - 14 - 18 };
    const after = applyOutcome(c, { ...outcome("secure_crossing", "bribed"), paid: 26 });
    expect(after.purse).toBe(18); // then the room settles the rifleman's £14 wage: £4, the purse the playtest came home to
    const paid = remit(after, { resolution: "bribed" });
    expect(paid.c.purse - 14).toBeGreaterThanOrEqual(30);
  });
});
