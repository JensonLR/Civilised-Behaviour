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
/** The shore names written under each mark (MapRoom draws them; the campaign layer keeps its own words off them). */
export const CHART_LABEL: Readonly<Record<string, string>> = { hollowmere: "Hollowmere", kessar: "Kessar", highmark: "Highmark", vesper: "Vesper", saltmarket: "Saltmarket" };
const KESSAR_AT = CHART_AT.kessar;

/**
 * Where a label may go (D-081): a stamp's words were written at one fixed offset and ran over the shore names, the anchors and each other ("Saltmarket
 * Quay" across "Hollowmere", the trading post through "Kessar"). Each label now tries a few spots round its own icon and takes the first that is on the
 * sheet and clear of everything already placed (the marks and their names first). Sizes are estimated from the type sizes (no layout read), in chart units.
 */
interface Box { x0: number; y0: number; x1: number; y1: number }
const STAMP_CHAR = 4.9; // the 8 px typewriter face, per character
const NAME_CHAR = 8.6; // the 12 px display face with its letter-spacing
const hits = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const onSheet = (b: Box): boolean => b.x0 >= 1 && b.y0 >= 1 && b.x1 <= 319 && b.y1 <= 199;
type Spot = { dx: number; dy: number; anchor: "start" | "middle" | "end" };
/** Right, left, above, below the icon (a label reads best to the right of its mark). */
const SPOTS: readonly Spot[] = [
  { dx: 9, dy: 4, anchor: "start" }, { dx: -9, dy: 4, anchor: "end" }, { dx: 0, dy: -9, anchor: "middle" }, { dx: 0, dy: 15, anchor: "middle" },
  { dx: 9, dy: -6, anchor: "start" }, { dx: 9, dy: 14, anchor: "start" }, { dx: -9, dy: -6, anchor: "end" }, { dx: -9, dy: 14, anchor: "end" },
  { dx: 0, dy: -18, anchor: "middle" }, { dx: 0, dy: 24, anchor: "middle" }, { dx: 9, dy: -16, anchor: "start" }, { dx: -9, dy: -16, anchor: "end" }, { dx: 9, dy: 24, anchor: "start" }, { dx: -9, dy: 24, anchor: "end" },
];
/** How much of `b` the boxes already placed cover (the fallback when no spot is clear: the least crowded one). */
const crowding = (b: Box, taken: readonly Box[]): number => taken.reduce((sum, t) => sum + Math.max(0, Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0)) * Math.max(0, Math.min(b.y1, t.y1) - Math.max(b.y0, t.y0)), 0);
function textBox(x: number, y: number, chars: number, perChar: number, anchor: Spot["anchor"], h = 8): Box {
  const w = chars * perChar;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0: x0 - 1, y0: y - h + 1, x1: x0 + w + 1, y1: y + 2 };
}
/** Places `text` beside an icon at (ax, ay) in a stamp group already translated there: the first free spot wins (the first spot if none is free). */
function placeLabel(group: SVGElement, ax: number, ay: number, text: string, taken: Box[], spots: readonly Spot[] = SPOTS): void {
  let pick = spots[0]!;
  let best = Infinity;
  for (const s of spots) {
    const b = textBox(ax + s.dx, ay + s.dy, text.length, STAMP_CHAR, s.anchor);
    if (!onSheet(b)) continue;
    const c = crowding(b, taken);
    if (c < best) {
      best = c;
      pick = s;
      if (c === 0) break;
    }
  }
  taken.push(textBox(ax + pick.dx, ay + pick.dy, text.length, STAMP_CHAR, pick.anchor));
  const t = svg("text", { x: pick.dx, y: pick.dy, ...(pick.anchor === "start" ? {} : { "text-anchor": pick.anchor }) });
  t.textContent = text;
  group.append(t);
}
/** The boxes (chart units) of every label the campaign layer wrote into `g`, by the same estimate the placement used (for tests). */
export function overlayLabelBoxes(g: SVGElement): Box[] {
  const out: Box[] = [];
  for (const t of Array.from(g.querySelectorAll("text"))) {
    if (t.classList.contains("q")) continue; // (the S inside the Syndicate's ring)
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t.parentElement?.getAttribute("transform") ?? "");
    const ox = m ? Number(m[1]) : 0, oy = m ? Number(m[2]) : 0;
    const anchor = (t.getAttribute("text-anchor") ?? "start") as Spot["anchor"];
    out.push(textBox(ox + Number(t.getAttribute("x")), oy + Number(t.getAttribute("y")), (t.textContent ?? "").length, STAMP_CHAR, anchor));
  }
  return out;
}
export { markBoxes as chartMarkBoxes };

/** What the chart already shows before the campaign layer: each mark's anchor and its name underneath. */
function markBoxes(regions: readonly { id: RegionId }[]): Box[] {
  const out: Box[] = [];
  for (const r of regions) {
    const p = CHART_AT[r.id];
    out.push({ x0: p.x - 11, y0: p.y - 11, x1: p.x + 11, y1: p.y + 11 });
    out.push(textBox(p.x, p.y + 24, (CHART_LABEL[r.id] ?? r.id).length, NAME_CHAR, "middle", 11));
  }
  return out;
}
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
/** The point a fraction `u` of the way along the lane from `a` to `b` (0 at a, 1 at b). Pure. */
export function chartRouteAt(a: RegionId, b: RegionId, u: number): { x: number; y: number } {
  const [p, q] = REGION_IDS.indexOf(a) <= REGION_IDS.indexOf(b) ? [a, b] : [b, a];
  const t = p === a ? u : 1 - u;
  const A = CHART_AT[p], B = CHART_AT[q], C = bendOf(p, q), k = 1 - t;
  return { x: k * k * A.x + 2 * k * t * C.x + t * t * B.x, y: k * k * A.y + 2 * k * t * C.y + t * t * B.y };
}
export const regionPair = (a: RegionId, b: RegionId): string => (REGION_IDS.indexOf(a) <= REGION_IDS.indexOf(b) ? `${a}|${b}` : `${b}|${a}`);

/** The chart's campaign layer: an outpost stamp by Kessar, the Syndicate's marker with its age, the sailing time on the lane. Drawn into `g` (cleared first). */
export function drawCampaignOverlay(g: SVGElement, data: CampaignMapData | undefined): void {
  g.replaceChildren();
  if (!data) return;
  const kessar = data.regions.find((r) => r.id === "kessar");
  const taken = markBoxes(data.regions);
  // the Society's posts (D-056: one per region with a site), each stamped beside its shore
  for (const r of data.regions) {
    if (!r.outpost) continue;
    const at = CHART_AT[r.id];
    const ox = at.x - 24, oy = at.y + 28;
    const s = svg("g", { class: "stamp outpost", transform: `translate(${ox} ${oy})` });
    s.append(svg("rect", { x: -5, y: -5, width: 10, height: 10 }), svg("path", { d: `M-5 -5 L0 -${6 + rank(r.outpost.stage)} L5 -5` }));
    taken.push({ x0: ox - 6, y0: oy - 12, x1: ox + 6, y1: oy + 6 });
    placeLabel(s, ox, oy, `${r.outpost.name}: ${stageWord(r.outpost.stage).replace(/^an? /, "")}`, taken);
    g.append(s);
  }
  if (kessar && kessar.rivalPost > 0) {
    const px = KESSAR_AT.x + 30, py = KESSAR_AT.y + 38;
    const s = svg("g", { class: "stamp rivalpost", transform: `translate(${px} ${py})` });
    s.append(svg("path", { d: "M-5 0 L0 -6 L5 0 L0 6 Z" }));
    taken.push({ x0: px - 6, y0: py - 7, x1: px + 6, y1: py + 7 });
    placeLabel(s, px, py, kessar.rivalPost >= 2 ? "Syndicate trading post" : "Syndicate post", taken);
    g.append(s);
  }
  if (data.rival) {
    const rx = KESSAR_AT.x - 8, ry = KESSAR_AT.y - 16;
    const s = svg("g", { class: "stamp rival", transform: `translate(${rx} ${ry})` });
    s.append(svg("circle", { r: 6 }));
    const q = svg("text", { x: 0, y: 3, "text-anchor": "middle", class: "q" });
    q.textContent = "S";
    s.append(q);
    taken.push({ x0: rx - 7, y0: ry - 7, x1: rx + 7, y1: ry + 7 });
    placeLabel(s, rx, ry, `Syndicate, ${ageWord(data.rival.age)}`, taken, SPOTS.map((sp) => (sp.anchor === "start" ? { ...sp, dx: sp.dx + 1 } : sp)));
    g.append(s);
  }
  // a home power has a SEAT in a region (the Reapers' Granges climb Highmark's lower terraces; D-037: the Guild's Cloister is cut into Vesper's cliff, the Houses keep Saltmarket Quay): once the Society has heard of the power, the chart says so
  for (const seat of SEATS) {
    const known = data.pins.find((p) => p.id === seat.power && p.known);
    if (!known || !data.regions.some((r) => r.id === seat.region)) continue;
    const at = CHART_AT[seat.region];
    const sx = at.x - 18, sy = at.y - 18;
    const s = svg("g", { class: `stamp ${seat.cls}`, transform: `translate(${sx} ${sy})` });
    s.append(svg("path", { d: "M-4 4 L-4 -3 M0 4 L0 -5 M4 4 L4 -3 M-6 4 L6 4" }));
    taken.push({ x0: sx - 7, y0: sy - 6, x1: sx + 7, y1: sy + 5 });
    // a seat's name reads to the left of its little colonnade first (the mark is to its right)
    placeLabel(s, sx, sy, seat.label, taken, [SPOTS[1]!, SPOTS[0]!, ...SPOTS.slice(2)]);
    g.append(s);
  }
  // each sailing time is written on its own lane, from where the party stands
  const here = data.regions.find((r) => r.here)?.id;
  for (const l of data.lanes) {
    if (!here) continue;
    const m = chartRouteMid(here, l.to);
    const word = sailShort(l.seconds);
    // on its lane: above the line, below it, or a little along either way; then further along the lane itself (a busy middle, where three seats crowd a crossing, had no clear spot)
    let at = { x: m.x, y: m.y - 5 };
    let best = Infinity;
    const near = [{ x: m.x, y: m.y - 5 }, { x: m.x, y: m.y + 10 }, { x: m.x - 16, y: m.y - 3 }, { x: m.x + 16, y: m.y - 3 }, { x: m.x - 16, y: m.y + 10 }, { x: m.x + 16, y: m.y + 10 }, { x: m.x - 28, y: m.y + 3 }, { x: m.x + 28, y: m.y + 3 }];
    const along = [0.4, 0.6, 0.3, 0.7].flatMap((u) => {
      const q = chartRouteAt(here, l.to, u);
      return [{ x: q.x, y: q.y - 5 }, { x: q.x, y: q.y + 10 }];
    });
    for (const c of [...near, ...along]) {
      const b = textBox(c.x, c.y, word.length, STAMP_CHAR, "middle");
      if (!onSheet(b)) continue;
      const cr = crowding(b, taken);
      if (cr < best) {
        best = cr;
        at = c;
        if (cr === 0) break;
      }
    }
    taken.push(textBox(at.x, at.y, word.length, STAMP_CHAR, "middle"));
    const t = svg("text", { x: at.x, y: at.y, "text-anchor": "middle", class: "lane" });
    t.textContent = word;
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
/** Where each region's foundation lies, in the words of the shores list (D-056: the regions with a site). */
const FOUNDATION_WHERE: Partial<Record<RegionId, string>> = { kessar: "south of the bridge", highmark: "on the grass west of the Reed Landing" };

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
      else if (FOUNDATION_WHERE[r.id]) bits.push(`no outpost of the Society yet: carry four crates to the foundation ${FOUNDATION_WHERE[r.id]}`);
      if (r.rivalPost > 0) bits.push(r.rivalPost >= 2 ? "the Syndicate has a trading post here" : "the Syndicate has a post here");
      if (r.offered) bits.push(`on offer: ${r.offered.title}`);
      shores.append(h("li", {}, h("strong", {}, r.name), `: ${bits.length ? bits.join("; ") : "nothing of note"}.`));
    }
    this.root.append(shores);

    // what has been latched: words, not colour
    const t = data.tech;
    // (D-091: the industrial age, only once it has come: a map that lists what nobody has yet is a list of disappointments)
    const age = [t.railway ? "a railway (nine yards, the rest to follow)" : "", t.breech ? "breech-loading rifles for the garrison" : "", t.works ? `the works at ${data.regions.find((r) => r.id === t.works)?.name ?? t.works}` : "", t.crank ? "a crank gun inside every stockade's gate" : ""].filter((x) => x !== "");
    this.root.append(h("p", { class: "tech" }, `Infrastructure: ${roadWord(t.road)}; ${t.telegraph ? "a telegraph line (news travels, wrongly, faster)" : "no telegraph"}; ${t.launch ? "a steam launch at the landing" : "no steam launch"}${age.length ? `; ${age.join("; ")}` : ""}.`));
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
