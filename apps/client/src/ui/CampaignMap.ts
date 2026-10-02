import { OUTPOST_STAGES, PRIORITY_LABEL, REGION_IDS, STAGE_LABEL, type CampaignMapData, type OutpostStage, type PowerId, type RegionId } from "@cb/shared";
import { h } from "./modal.ts";
import "./campaignMap.css";

/**
 * The campaign on the chart (D-035): what the Society has built, where the Syndicate was last seen, who the powers are and which of them are asking for you. A painter over the pure
 * `campaignMapOf` description (shared/mapData.ts): every string is set as TEXT, never markup; every fact is in WORDS (stage names, "?" for the unmet, "no word of the Syndicate"), never
 * in colour alone; nothing moves, so reduced motion needs no special case; focus order is the page's own (the audience buttons are real buttons, in reading order). The Syndicate's goal
 * appears only when the map data carries it (intel), and this file never guesses one.
 */

export interface CampaignMapCallbacks {
  /** The player asked for an audience with a power (the server checks who, where and whether it is pending). */
  audience?(power: PowerId): void;
}

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export const stageWord = (s: OutpostStage): string => STAGE_LABEL[s];
const rank = (s: OutpostStage): number => OUTPOST_STAGES.indexOf(s);
const roadWord = (n: number): string => (n >= 2 ? "a made road" : n === 1 ? "a track worn into a road" : "no road");
const ageWord = (n: number): string => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`);

/** Where each region's mark sits on the chart (a 320 x 200 sheet): home on the near shore, the colony across the water to the north-east, the highlands to the south-east (D-036). */
export const CHART_AT: Readonly<Record<RegionId, { x: number; y: number }>> = {
  hollowmere: { x: 84, y: 138 }, kessar: { x: 232, y: 62 }, highmark: { x: 252, y: 156 },
  // D-037: the gorge on the north-west shore (inland, up its river), the delta on the south shore between home and the highlands
  vesper: { x: 88, y: 42 }, saltmarket: { x: 160, y: 170 },
};
const KESSAR_AT = CHART_AT.kessar;
/** Where each home power sits on the chart (the class keeps the older "granges" stamp name for the CSS and tests). */
const SEATS: readonly { power: PowerId; region: RegionId; label: string; cls: string }[] = [
  { power: "reapers", region: "highmark", label: "Thornfield Granges", cls: "granges" },
  { power: "choir", region: "vesper", label: "The Long Cloister", cls: "cloister" },
  { power: "brine", region: "saltmarket", label: "Saltmarket Quay", cls: "quay" },
];

/** The sea lane between two regions as a quadratic curve: its path, and the point half way along it (where its sailing time is written). Pure; the same curve for either direction. */
const BEND: Record<string, { x: number; y: number }> = { "hollowmere|kessar": { x: 150, y: 60 }, "hollowmere|highmark": { x: 160, y: 176 }, "kessar|highmark": { x: 286, y: 112 } };
/** The control point of a lane: the older three are hand-set; every other pair bows a quarter of its length toward the middle of the sheet (where the sea is). Pure. */
function bendOf(p: RegionId, q: RegionId): { x: number; y: number } {
  const set = BEND[`${p}|${q}`];
  if (set) return set;
  const A = CHART_AT[p], B = CHART_AT[q];
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dz = B.y - A.y;
  const nx = -dz * 0.25, ny = dx * 0.25;
  const plus = Math.hypot(160 - (mx + nx), 100 - (my + ny)), minus = Math.hypot(160 - (mx - nx), 100 - (my - ny));
  return plus <= minus ? { x: mx + nx, y: my + ny } : { x: mx - nx, y: my - ny };
}
function lane(a: RegionId, b: RegionId): { d: string; mid: { x: number; y: number } } {
  const [p, q] = REGION_IDS.indexOf(a) <= REGION_IDS.indexOf(b) ? [a, b] : [b, a];
  const A = CHART_AT[p], B = CHART_AT[q], C = bendOf(p, q);
  return { d: `M${A.x} ${A.y} Q ${C.x} ${C.y} ${B.x} ${B.y}`, mid: { x: 0.25 * A.x + 0.5 * C.x + 0.25 * B.x, y: 0.25 * A.y + 0.5 * C.y + 0.25 * B.y } };
}
export const chartRoute = (a: RegionId, b: RegionId): string => lane(a, b).d;
export const chartRouteMid = (a: RegionId, b: RegionId): { x: number; y: number } => lane(a, b).mid;
export const regionPair = (a: RegionId, b: RegionId): string => (REGION_IDS.indexOf(a) <= REGION_IDS.indexOf(b) ? `${a}|${b}` : `${b}|${a}`);

/** The chart's campaign layer: an outpost stamp by Kessar, the Syndicate's marker with its age, the sailing time on the lane. Drawn into `g` (cleared first). */
export function drawCampaignOverlay(g: SVGElement, data: CampaignMapData | undefined): void {
  g.replaceChildren();
  if (!data) return;
  const kessar = data.regions.find((r) => r.id === "kessar");
  if (kessar?.outpost) {
    const s = svg("g", { class: "stamp outpost", transform: `translate(${KESSAR_AT.x - 24} ${KESSAR_AT.y + 28})` });
    s.append(svg("rect", { x: -5, y: -5, width: 10, height: 10 }), svg("path", { d: `M-5 -5 L0 -${6 + rank(kessar.outpost.stage)} L5 -5` }));
    const t = svg("text", { x: 9, y: 4 });
    t.textContent = `${kessar.outpost.name}: ${stageWord(kessar.outpost.stage).replace(/^an? /, "")}`;
    s.append(t);
    g.append(s);
  }
  if (kessar && kessar.rivalPost > 0) {
    const s = svg("g", { class: "stamp rivalpost", transform: `translate(${KESSAR_AT.x + 30} ${KESSAR_AT.y + 38})` });
    s.append(svg("path", { d: "M-5 0 L0 -6 L5 0 L0 6 Z" }));
    const t = svg("text", { x: 9, y: 4 });
    t.textContent = kessar.rivalPost >= 2 ? "Syndicate trading post" : "Syndicate post";
    s.append(t);
    g.append(s);
  }
  if (data.rival) {
    const s = svg("g", { class: "stamp rival", transform: `translate(${KESSAR_AT.x - 8} ${KESSAR_AT.y - 16})` });
    s.append(svg("circle", { r: 6 }));
    const q = svg("text", { x: 0, y: 3, "text-anchor": "middle", class: "q" });
    q.textContent = "S";
    s.append(q);
    const t = svg("text", { x: 10, y: 4 });
    t.textContent = `Syndicate, ${ageWord(data.rival.age)}`;
    s.append(t);
    g.append(s);
  }
  // a home power has a SEAT in a region (the Reapers' Granges climb Highmark's lower terraces; D-037: the Guild's Cloister is cut into Vesper's cliff, the Houses keep Saltmarket Quay): once the Society has heard of the power, the chart says so
  for (const seat of SEATS) {
    const known = data.pins.find((p) => p.id === seat.power && p.known);
    if (!known || !data.regions.some((r) => r.id === seat.region)) continue;
    const at = CHART_AT[seat.region];
    const s = svg("g", { class: `stamp ${seat.cls}`, transform: `translate(${at.x - 18} ${at.y - 18})` });
    s.append(svg("path", { d: "M-4 4 L-4 -3 M0 4 L0 -5 M4 4 L4 -3 M-6 4 L6 4" }));
    const t = svg("text", { x: -10, y: 4, "text-anchor": "end" });
    t.textContent = seat.label;
    s.append(t);
    g.append(s);
  }
  // each sailing time is written on its own lane, from where the party stands
  const here = data.regions.find((r) => r.here)?.id;
  for (const l of data.lanes) {
    if (!here) continue;
    const m = chartRouteMid(here, l.to);
    const t = svg("text", { x: m.x, y: m.y - 5, "text-anchor": "middle", class: "lane" });
    t.textContent = sailShort(l.seconds);
    g.append(t);
  }
}

/**
 * A sailing in the fiction's terms (D-040: the playtest's chart said "6 s by sail"). The voyage is a card of a few seconds, and an expedition is a day; the steam
 * launch halves the crossing. Chart lanes carry the short form, the text panel the long one.
 */
export const sailShort = (seconds: number): string => (seconds >= 5 ? "a day" : "half a day");
export const sailLong = (seconds: number): string => (seconds >= 5 ? "a day's sail" : "half a day by steam launch");

/** The text panel under the chart. `render` replaces its contents; call it whenever the map data changes. */
export class CampaignMap {
  readonly root = h("section", { class: "campaign", "aria-labelledby": "campaign-title" });

  render(data: CampaignMapData | undefined, cb: CampaignMapCallbacks = {}): void {
    this.root.replaceChildren();
    this.root.hidden = !data;
    if (!data) return;
    this.root.append(h("h3", { id: "campaign-title" }, "The Campaign"));

    // the shores: where you stand, what is on offer, what has been built
    const shores = h("ul", { class: "shores", "aria-label": "The shores" });
    for (const r of data.regions) {
      const bits: string[] = [];
      if (r.here) bits.push("you are here");
      if (r.outpost) bits.push(`the Society holds ${stageWord(r.outpost.stage)}, ${r.outpost.name} (${PRIORITY_LABEL[r.outpost.priority]}; stores ${r.outpost.supply} of 100)`);
      else if (r.id === "kessar") bits.push("no outpost of the Society yet: carry four crates to the foundation south of the bridge");
      if (r.rivalPost > 0) bits.push(r.rivalPost >= 2 ? "the Syndicate has a trading post here" : "the Syndicate has a post here");
      if (r.offered) bits.push(`on offer: ${r.offered.title}`);
      shores.append(h("li", {}, h("strong", {}, r.name), `: ${bits.length ? bits.join("; ") : "nothing of note"}.`));
    }
    this.root.append(shores);

    // what has been latched: words, not colour
    const t = data.tech;
    this.root.append(h("p", { class: "tech" }, `Infrastructure: ${roadWord(t.road)}; ${t.telegraph ? "a telegraph line (news travels, wrongly, faster)" : "no telegraph"}; ${t.launch ? "a steam launch at the landing" : "no steam launch"}.`));
    for (const l of data.lanes) this.root.append(h("p", { class: "lane-note" }, `${data.regions.find((r) => r.id === l.to)?.name ?? l.to}: ${sailLong(l.seconds)}.`));

    // the Syndicate
    this.root.append(
      h(
        "p",
        { class: "rival" },
        data.rival
          ? `The Syndicate was last seen ${data.rival.where}, ${ageWord(data.rival.age)}.${data.rival.goal ? ` Your intelligence suggests: ${data.rival.goal}.` : " Without intelligence nobody can say what it is up to."}`
          : "There is no word of the Syndicate. This is not the same as good news.",
      ),
    );

    // the powers
    this.root.append(h("h4", {}, "Powers"));
    const pins = h("ul", { class: "pins", "aria-label": "The powers" });
    for (const p of data.pins) {
      const li = h("li", { class: p.known ? "known" : "unmet" });
      li.append(h("span", { class: "mark", "aria-hidden": "true" }, p.known ? p.name.charAt(0) : "?"));
      const body = h("span", { class: "who" }, h("strong", {}, p.known ? p.name : "A power you have not met"), p.known ? ` (${p.seat}). Stance: ${p.stance}. ${p.note}` : ` ${p.note}`);
      li.append(body);
      if (p.audience) {
        const b = h("button", { type: "button", class: "audience", "data-power": p.id }, "Request an audience") as HTMLButtonElement;
        b.setAttribute("aria-label", `Request an audience with ${p.known ? p.name : "the power asking for you"}`);
        b.addEventListener("click", () => cb.audience?.(p.id));
        li.append(b);
      }
      pins.append(li);
    }
    this.root.append(pins);
  }
}
