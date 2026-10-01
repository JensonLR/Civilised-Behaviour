import { REGION_IDS, type CampaignMapData, type PowerId, type RegionId } from "@cb/shared";
import { Modal, h } from "./modal.ts";
import { CHART_AT, CampaignMap, chartRoute, drawCampaignOverlay, regionPair } from "./CampaignMap.ts";
import { sheetHints } from "./sheetHints.ts";
import "./mapRoom.css";

export interface MapRoomRegion {
  id: RegionId;
  name: string;
  blurb: string;
  /** What the campaign remembers about it ("Crossing: the bridge stands; the toll is 40 pounds"). */
  note: string;
  /** The region the expedition is in now. */
  here: boolean;
}
export interface MapRoomCrew {
  slot: number;
  name: string;
  ready: boolean;
}
export interface MapRoomView {
  regions: MapRoomRegion[];
  ready: MapRoomCrew[];
  /** 0 idle, 1 a sailing is proposed, 2-3 under way (the room closes: the Sailing card takes over). */
  phase: number;
  /** The proposed destination while phase >= 1. */
  to?: RegionId;
  /** This player's slot, so the "ready" switch shows the server's truth. */
  you?: number;
  /** D-035: what the campaign has built and who is asking for the party (shared `campaignMapOf`). Absent: the plain chart. */
  campaign?: CampaignMapData;
}
export interface MapRoomCallbacks {
  propose(to: RegionId): void;
  ready(on: boolean): void;
  cancel(): void;
  close(): void;
  /** D-035: the player asked for an audience with a power (the server decides). */
  audience?(power: PowerId): void;
}

/** The names written under the marks (a region the chart does not know is written as its id). */
const CHART_LABEL: Record<string, string> = { hollowmere: "Hollowmere", kessar: "Kessar", highmark: "Highmark", vesper: "Vesper", saltmarket: "Saltmarket" };
/** Every pair of regions has a lane (every ordered pair sails); a lane and a mark are SHOWN only while the regions are on the chart (reachable), so a region that is not built yet is not on it. */
const LANES: readonly [RegionId, RegionId][] = REGION_IDS.flatMap((a, i) => REGION_IDS.slice(i + 1).map((b): [RegionId, RegionId] => [a, b]));
const NUMBER_WORD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five" };
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/**
 * The map room: the survey table under the HQ marquee, or the quay's chart board. A painted chart of the three shores, a destination for each region the
 * Society has charted (what the campaign remembers about it written beside), the crew and who is ready, and the three acts of a sailing: propose,
 * agree, cancel. The server owns the vote (Travel); this only shows it and sends intentions. Every string from the wire goes in as text, never markup.
 * A sheet like the others: focus trapped, Escape and pad B close it, the game's controls held off while it is open.
 */
export class MapRoom {
  private readonly modal = new Modal("maproom", "maproom", "maproom-title");
  private readonly chart = svg("svg", { viewBox: "0 0 320 200", role: "img", "aria-label": "Chart of the Society's three shores" });
  private readonly list = h("div", { class: "dests", role: "radiogroup", "aria-label": "Destination" });
  private readonly crew = h("ul", { class: "crew", "aria-label": "Crew" });
  private readonly status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  private readonly propose = h("button", { type: "button", class: "primary" }, "Propose sailing");
  private readonly ready = h("button", { type: "button", "aria-pressed": "false" }, "Ready to sail");
  private readonly cancel = h("button", { type: "button", class: "danger" }, "Call it off");
  private readonly close = h("button", { type: "button" }, "Close");
  private cb: MapRoomCallbacks | undefined;
  private view: MapRoomView | undefined;
  private selected: RegionId | undefined;
  private myReady = false;
  private quiet = false;
  private readonly routes = new Map<string, SVGElement>();
  private readonly campaign = new CampaignMap();
  private readonly overlay = svg("g", { class: "campaign-layer" });

  constructor(root: HTMLElement) {
    root.appendChild(this.modal.root);
    this.buildChart();
    this.modal.panel.append(
      h("p", { class: "society" }, "The Imperial Cartographic & Improvement Society"),
      h("h2", { id: "maproom-title" }, "The Map Room"),
      h("p", { class: "tag" }, "Pick a shore. The Society will do the rest, and invoice you for it."),
      h("div", { class: "chartwrap" }, this.chart as unknown as Node),
      this.list,
      this.campaign.root,
      h("h3", {}, "Crew"),
      this.crew,
      this.status,
      h("div", { class: "actions" }, this.close, h("div", { class: "acts" }, this.cancel, this.ready, this.propose)),
      sheetHints().el,
    );
    this.propose.addEventListener("click", () => {
      if (this.selected && this.canPropose()) this.cb?.propose(this.selected);
    });
    this.ready.addEventListener("click", () => {
      this.myReady = !this.myReady;
      this.ready.setAttribute("aria-pressed", String(this.myReady));
      this.cb?.ready(this.myReady);
    });
    this.cancel.addEventListener("click", () => this.cb?.cancel());
    this.close.addEventListener("click", () => this.modal.close());
    this.modal.onClose = () => {
      if (!this.quiet) this.cb?.close();
      this.quiet = false;
    };
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(v: MapRoomView, cb: MapRoomCallbacks): void {
    this.cb = cb;
    this.selected = undefined;
    this.myReady = false;
    this.render(v);
    this.modal.open();
  }

  /** Re-renders from the latest state (keeps the chosen destination and the focus). A sailing under way closes the room. */
  update(v: MapRoomView): void {
    if (!this.modal.isOpen) return;
    this.render(v);
  }

  closeRoom(): void {
    this.modal.close();
  }

  dispose(): void {
    this.quiet = true;
    this.modal.close();
    this.modal.root.remove();
    this.cb = undefined;
  }

  // ---- drawing ------------------------------------------------------------------------------------------------------------------------

  private canPropose(): boolean {
    const v = this.view;
    if (!v || v.phase !== 0 || !this.selected) return false;
    return v.regions.some((r) => r.id === this.selected && !r.here);
  }

  /** The regions the chart is drawn for (D-037: only the ones the party can sail to are on it; a region that is not built yet has no mark, no shore and no lane). */
  private charted = "";
  private buildChart(ids: readonly RegionId[] = ["hollowmere", "kessar", "highmark"]): void {
    const c = this.chart;
    c.replaceChildren();
    this.routes.clear();
    const on = new Set<string>(ids);
    c.setAttribute("aria-label", `Chart of the Society's ${NUMBER_WORD[on.size] ?? on.size} shores`);
    c.append(
      svg("rect", { class: "sea", x: 0, y: 0, width: 320, height: 200 }),
      svg("path", { class: "land", d: "M0 120 C30 104 52 112 74 108 C102 103 118 128 112 152 C108 172 70 186 34 184 L0 200 Z" }),
      svg("path", { class: "land", d: "M190 0 L320 0 L320 96 C300 92 286 104 262 100 C236 96 232 76 214 72 C196 68 178 40 190 0 Z" }),
      svg("path", { class: "land", d: "M204 200 L320 200 L320 132 C302 126 290 138 268 134 C246 130 238 146 222 152 C208 158 198 180 204 200 Z" }),
      svg("path", { class: "wave", d: "M130 40 q8 -6 16 0 t16 0 M120 130 q8 -6 16 0 t16 0 M150 190 q8 -6 16 0 t16 0 M236 108 q8 -6 16 0 t16 0 M20 40 q8 -6 16 0 t16 0" }),
    );
    // D-037: the gorge's shore (north-west) and the delta's (south) are drawn only once those regions can be sailed to
    if (on.has("vesper")) c.append(svg("path", { class: "land", "data-region": "vesper", d: "M0 0 L150 0 C162 24 142 58 112 72 C86 84 52 74 30 80 C14 84 4 72 0 62 Z" }));
    if (on.has("saltmarket")) c.append(svg("path", { class: "land", "data-region": "saltmarket", d: "M122 200 C124 172 142 150 164 150 C186 150 198 176 196 200 Z" }));
    for (const [a, b] of LANES) {
      if (!on.has(a) || !on.has(b)) continue;
      const route = svg("path", { class: "route", d: chartRoute(a, b), "data-lane": regionPair(a, b) });
      c.appendChild(route);
      this.routes.set(regionPair(a, b), route);
    }
    for (const id of REGION_IDS) {
      if (!on.has(id)) continue;
      const p = CHART_AT[id];
      const g = svg("g", { class: "mark", "data-region": id, transform: `translate(${p.x} ${p.y})` });
      g.append(svg("circle", { r: 9 }), svg("path", { d: "M0 -5 L0 6 M-4 2 Q0 9 4 2 M-3 -2 L3 -2" }));
      const label = svg("text", { x: 0, y: 24, "text-anchor": "middle" });
      label.textContent = CHART_LABEL[id] ?? id;
      g.appendChild(label);
      c.appendChild(g);
    }
    c.appendChild(this.overlay);
    this.chart.setAttribute("focusable", "false");
  }

  private render(v: MapRoomView): void {
    this.view = v;
    if (v.phase >= 2) {
      // under way: the Sailing card takes over, nobody needs the chart
      this.quiet = true;
      this.modal.close();
      return;
    }
    const pending = v.phase === 1 ? v.to : undefined;
    if (pending) this.selected = pending;
    if (!this.selected || !v.regions.some((r) => r.id === this.selected)) this.selected = (v.regions.find((r) => !r.here) ?? v.regions[0])?.id;
    const focused = document.activeElement as HTMLElement | null;
    const focusedId = focused?.closest?.(".dest")?.getAttribute("data-region");
    this.list.replaceChildren();
    for (const r of v.regions) {
      const input = h("input", { type: "radio", name: "maproom-dest", value: r.id, id: `maproom-${r.id}` }) as HTMLInputElement;
      input.checked = r.id === this.selected;
      input.disabled = v.phase === 1 && r.id !== pending;
      input.addEventListener("change", () => {
        this.selected = r.id;
        this.render(this.view!);
      });
      const label = h(
        "label",
        { class: `dest${r.here ? " here" : ""}`, for: input.id, "data-region": r.id },
        input,
        h("span", { class: "name" }, r.name, r.here ? h("em", { class: "badge" }, "you are here") : null),
        h("span", { class: "blurb" }, r.blurb),
        r.note ? h("span", { class: "note" }, r.note) : null,
      );
      this.list.appendChild(label);
    }
    if (focusedId) this.list.querySelector<HTMLInputElement>(`input[value="${focusedId}"]`)?.focus();
    // the chart follows the selection (and is redrawn when the set of charted regions changes)
    const key = v.regions.map((r) => r.id).join(",");
    if (key !== this.charted) {
      this.charted = key;
      this.buildChart(v.regions.map((r) => r.id));
    }
    const here = v.regions.find((r) => r.here);
    for (const g of this.chart.querySelectorAll("g.mark")) g.classList.toggle("sel", g.getAttribute("data-region") === this.selected);
    for (const g of this.chart.querySelectorAll("g.mark")) g.classList.toggle("here", v.regions.some((r) => r.here && r.id === g.getAttribute("data-region")));
    // the lane between where the party stands and where it is bound lights up
    const lit = here && this.selected && here.id !== this.selected && (v.phase === 1 || this.canPropose()) ? regionPair(here.id, this.selected) : "";
    for (const [pair, route] of this.routes) route.classList.toggle("active", pair === lit);
    // the campaign layer: outposts, the Syndicate's marker, the powers and their audiences (D-035)
    drawCampaignOverlay(this.overlay, v.campaign);
    const focusedAudience = (document.activeElement as HTMLElement | null)?.getAttribute?.("data-power");
    this.campaign.render(v.campaign, { audience: (p) => this.cb?.audience?.(p) });
    if (focusedAudience) this.campaign.root.querySelector<HTMLElement>(`button[data-power="${focusedAudience}"]`)?.focus();
    // the crew
    this.crew.replaceChildren();
    for (const c of v.ready) this.crew.appendChild(h("li", { class: c.ready ? "yes" : "no" }, h("span", { class: "who" }, c.name), h("span", { class: "state" }, v.phase === 1 ? (c.ready ? "ready" : "waiting") : "aboard")));
    const you = v.you !== undefined ? v.ready.find((c) => c.slot === v.you) : undefined;
    if (you) this.myReady = you.ready;
    if (v.phase === 0) this.myReady = false;
    this.ready.setAttribute("aria-pressed", String(this.myReady));
    // the acts
    this.propose.hidden = v.phase !== 0;
    this.propose.disabled = !this.canPropose();
    this.ready.hidden = v.phase !== 1;
    this.cancel.hidden = v.phase !== 1;
    const dest = v.regions.find((r) => r.id === this.selected);
    if (v.phase === 1) {
      const yes = v.ready.filter((c) => c.ready).length;
      this.status.textContent = `A sailing to ${dest?.name ?? "the far shore"} is proposed: ${yes} of ${v.ready.length} ready. Everyone aboard must agree, or the kettle goes cold.`;
    } else if (dest?.here) {
      this.status.textContent = `You are already at ${here?.name ?? "this shore"}. Choose another.`;
    } else {
      this.status.textContent = dest ? `Bound for ${dest.name}? Propose it and the crew will be asked.` : "Choose a shore.";
    }
  }
}
