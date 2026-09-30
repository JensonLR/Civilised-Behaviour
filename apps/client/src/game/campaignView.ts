import { REGIONS, REGION_IDS, isRegionId, type CampaignState, type RegionId } from "@cb/shared";
import type { MapRoomView } from "../ui/MapRoom.ts";

/** What the campaign remembers about a region, written beside it on the chart. Plain text; no markup. */
export function regionNote(id: RegionId, c: CampaignState | undefined): string {
  if (!c) return "";
  if (id === "hollowmere") return `Day ${c.day}. Purse: £${c.purse}. Expeditions out: ${c.expeditions}.`;
  const cr = c.crossing;
  if (!c.history.some((h) => h.region === id)) return "Not yet visited. A bridge, a toll bar and a fort with opinions.";
  const bridge = cr.bridge === "collapsed" ? "The bridge is down" : cr.bridge === "rigged" ? "The bridge is rigged" : "The bridge stands";
  const control = cr.control === "ward" ? "the Ward holds it" : cr.control === "society" ? "the Society holds it" : cr.control === "rival" ? "the Syndicate holds it" : "it is contested";
  const toll = cr.toll > 0 ? `toll £${cr.toll}` : "no toll";
  return `${bridge}; ${control}; ${toll}.`;
}

/** The slice of the room state the map room needs (structural, so tests need no Colyseus). */
export interface MapState {
  region: string;
  travelPhase: number;
  travelTo: string;
  travelReady: number;
  players: { forEach(cb: (p: { name: string; slot: number; connected: boolean; npc: number }) => void): void };
}

/** The map room's view of the room: regions with the campaign's notes, the crew with their votes, and the sailing's phase. */
export function mapRoomView(st: MapState, campaign: CampaignState | undefined, you: number | undefined): MapRoomView {
  const here = isRegionId(st.region) ? st.region : "hollowmere";
  const phase = st.travelPhase ?? 0;
  const ready: MapRoomView["ready"] = [];
  st.players.forEach((p) => {
    if (p.npc || !p.connected) return;
    ready.push({ slot: p.slot, name: p.name, ready: phase === 1 && ((st.travelReady >> p.slot) & 1) === 1 });
  });
  ready.sort((a, b) => a.slot - b.slot);
  return {
    regions: REGION_IDS.map((id) => ({ id, name: REGIONS[id].name, blurb: REGIONS[id].blurb, note: regionNote(id, campaign), here: id === here })),
    ready,
    phase,
    ...(phase >= 1 && isRegionId(st.travelTo) ? { to: st.travelTo } : {}),
    ...(you !== undefined ? { you } : {}),
  };
}
