import type { RegionId, ResolutionId, ScenarioTemplateId } from "./campaignTypes.ts";
import { REGION_IDS } from "./campaignTypes.ts";
import { RESOLUTIONS } from "./factions.ts";
import { SALTMARKET_RESOLUTIONS, VESPER_RESOLUTIONS, NEW_TEMPLATE_RESOLUTIONS } from "./regionEndings.ts";
import { SALTMARKET_STATUS } from "./saltmarket.ts";
import { TEMPLATE_IDS } from "./scenarios/registry.ts";
import { VESPER_STATUS } from "./vesper.ts";
import { HIGHMARK_STATUS } from "./highmark.ts";

/**
 * Which regions' content is REAL, as opposed to a contract stub (D-037). A region lands in the contract with neutral bodies and a `<REGION>_STATUS.stub` flag; the package that builds it flips the flag as its
 * last act. The exhaustive tests that existed before a region (every ending has distinct headlines, every pair of endings of one template differs in two relations, every template's view has objectives) enumerate
 * `live*()` instead of everything, so they cover a region's content from the moment its flag flips and never before. Test support (and the stubs test); nothing in the game reads it.
 */
export const regionIsLive = (id: RegionId): boolean => (id === "vesper" ? !VESPER_STATUS.stub : id === "saltmarket" ? !SALTMARKET_STATUS.stub : id === "highmark" ? !HIGHMARK_STATUS.stub : true);
export const liveRegions = (): RegionId[] => REGION_IDS.filter(regionIsLive);
export const liveResolutions = (): ResolutionId[] =>
  RESOLUTIONS.filter((r) => !((VESPER_RESOLUTIONS as readonly string[]).includes(r) && VESPER_STATUS.stub) && !((SALTMARKET_RESOLUTIONS as readonly string[]).includes(r) && SALTMARKET_STATUS.stub));
const TEMPLATE_HOME: Partial<Record<ScenarioTemplateId, RegionId>> = { mine_rescue: "vesper", claim_race: "vesper", smuggling_run: "saltmarket", flooded_market: "saltmarket", reapers_strike: "highmark", winding_engine: "vesper", outpost_raid: "kessar", lost_survey: "saltmarket", great_grey: "highmark", counting_house: "kessar" };
export const liveTemplates = (): ScenarioTemplateId[] => TEMPLATE_IDS.filter((t) => { const h = TEMPLATE_HOME[t]; return h === undefined || regionIsLive(h); });
/** Compile-time anchor: the four newer templates are exactly the keys of NEW_TEMPLATE_RESOLUTIONS. */
export const NEW_TEMPLATES_LISTED: readonly ScenarioTemplateId[] = Object.keys(NEW_TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[];
