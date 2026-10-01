import type { RegionId } from "./campaignTypes.ts";
import type { RegionCopy } from "./regionEndings.ts";
import { SALTMARKET_REGION } from "./saltmarketText.ts";
import { VESPER_REGION } from "./vesperText.ts";

/**
 * Where the client and the platform seam find what a region says outside its endings (D-037): the chart note, the presence lines, the parley sheet's heading. Hollowmere, Kessar and Highmark keep their older,
 * hard-wired voices (campaignView.ts, platformText.ts, Parley.ts) and are absent here.
 */
export const REGION_COPY: Readonly<Partial<Record<RegionId, RegionCopy>>> = { vesper: VESPER_REGION, saltmarket: SALTMARKET_REGION };
