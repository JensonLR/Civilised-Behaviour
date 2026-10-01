import { REGIONS, REGION_COPY, isRegionId, reachableRegions, pickTemplate, templateNote, type CampaignMapData, type CampaignState, type RegionId, type RivalPresence } from "@cb/shared";
import type { MapRoomView } from "../ui/MapRoom.ts";

/** What the campaign remembers about a region, written beside it on the chart. Plain text; no markup. */
export function regionNote(id: RegionId, c: CampaignState | undefined, seed?: number, presence?: RivalPresence): string {
  if (!c) return "";
  if (id === "hollowmere") return `Day ${c.day}. Purse: £${c.purse}. Expeditions out: ${c.expeditions}.`;
  // The contract the ledger offers next (the same pure rule the server runs when the party lands; a dev-forced contract is the server's business).
  const offer = seed === undefined ? undefined : pickTemplate(c, id, seed, presence);
  const contract = offer ? ` On offer: ${templateNote(offer).title}. ${templateNote(offer).brief}` : "";
  if (id === "highmark") return highmarkNote(c, contract);
  const own = REGION_COPY[id];   // D-037: Vesper and Saltmarket write their own chart note (shared/vesperText.ts, saltmarketText.ts)
  if (own) return `${own.chartNote(c)}${contract}`;
  const cr = c.crossing;
  if (!c.history.some((h) => h.region === id)) return `Not yet visited. A bridge, a toll bar and a fort with opinions.${contract}`;
  const bridge = cr.bridge === "collapsed" ? "The bridge is down" : cr.bridge === "rigged" ? "The bridge is rigged" : "The bridge stands";
  const control = cr.control === "ward" ? "the Ward holds it" : cr.control === "society" ? "the Society holds it" : cr.control === "rival" ? "the Syndicate holds it" : "it is contested";
  const toll = cr.toll > 0 ? `toll £${cr.toll}` : "no toll";
  return `${bridge}; ${control}; ${toll}.${contract}`;
}

/** What the chair at Highmark looks like from the chart (D-036): the ledger's `succession`, in the Society's voice. */
const CHAIR_NOTE: Record<CampaignState["sites"]["succession"], string> = {
  open: "The chair is vacant in a procedural sense; the King is pending.",
  elder: "Princess Orla sits the chair, by Seniority; the Assembly voted, and was fed.",
  younger: "Prince Dunstan sits the chair, by Acclamation, to a band.",
  regency: "A regency of three signatures holds the chair, which nobody sits in.",
  usurped: "The chair has an occupant the court is calling an early succession.",
  sold: "The Crown's concession is the Syndicate's, and the Crown has kept the hat.",
};
function highmarkNote(c: CampaignState, contract: string): string {
  const visited = c.history.some((h) => h.region === "highmark");
  if (!visited) return `Not yet visited. Five terraces, one switchback road and a court that has been waiting six years for a signature.${contract}`;
  const last = [...c.history].reverse().find((h) => h.region === "highmark");
  return `${CHAIR_NOTE[c.sites.succession]}${last ? ` Last visit: day ${last.day}.` : ""}${contract}`;
}

/** The slice of the room state the map room needs (structural, so tests need no Colyseus). */
export interface MapState {
  region: string;
  travelPhase: number;
  travelTo: string;
  travelReady: number;
  seed?: number;
  players: { forEach(cb: (p: { name: string; slot: number; connected: boolean; npc: number }) => void): void };
}

/** The map room's view of the room: regions with the campaign's notes, the crew with their votes, and the sailing's phase. */
export function mapRoomView(st: MapState, campaign: CampaignState | undefined, you: number | undefined, campaignMap?: CampaignMapData, presence?: RivalPresence): MapRoomView {
  const here = isRegionId(st.region) ? st.region : "hollowmere";
  const phase = st.travelPhase ?? 0;
  const ready: MapRoomView["ready"] = [];
  st.players.forEach((p) => {
    if (p.npc || !p.connected) return;
    ready.push({ slot: p.slot, name: p.name, ready: phase === 1 && ((st.travelReady >> p.slot) & 1) === 1 });
  });
  ready.sort((a, b) => a.slot - b.slot);
  return {
    regions: reachableRegions().map((id) => ({ id, name: REGIONS[id].name, blurb: REGIONS[id].blurb, note: regionNote(id, campaign, st.seed, presence), here: id === here })),
    ready,
    phase,
    ...(phase >= 1 && isRegionId(st.travelTo) ? { to: st.travelTo } : {}),
    ...(you !== undefined ? { you } : {}),
    ...(campaignMap ? { campaign: campaignMap } : {}),
  };
}
