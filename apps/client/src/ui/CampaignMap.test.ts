// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newCampaign, newPowers, newSettlements, campaignMapOf, mapPins, rivalSighting, deliverTo, PropKind, type CampaignMapData } from "@cb/shared";
import { CampaignMap, drawCampaignOverlay } from "./CampaignMap.ts";
import { MapRoom, type MapRoomView } from "./MapRoom.ts";

const c = { ...newCampaign(2), day: 6, expeditions: 2 };
const p = newPowers(2);
const data = (o: { intel?: number; post?: boolean; asking?: ("brine" | "choir")[]; seen?: boolean } = {}): CampaignMapData => {
  let s = newSettlements();
  if (o.post) for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, c, 1).s;
  const pw = o.seen === false ? p : { ...p, rival: { ...p.rival, seenDay: 4, day: 6, where: { region: "kessar" as const, spot: "ford" as const } } };
  return campaignMapOf(c, s, rivalSighting(c, pw, o.intel ?? 0), mapPins(c, pw, o.asking ?? []), { title: "Secure the River Crossing", brief: "x" }, s.tech, "hollowmere", pw.rival.posts);
};

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("CampaignMap on three shores (D-036)", () => {
  it("the shores list says what each region offers, and Highmark's Granges are on the chart once the Reapers are known", () => {
    const offers = { kessar: { title: "Secure the River Crossing", brief: "x" }, highmark: { title: "The Vacant Chair", brief: "y" } };
    const known = { ...c, expeditions: 3 };
    const m = campaignMapOf(known, newSettlements(), undefined, mapPins(known, p, []), offers, newSettlements().tech, "hollowmere");
    const panel = new CampaignMap();
    panel.render(m);
    expect(panel.root.textContent).toContain("Highmark: on offer: The Vacant Chair");
    expect(panel.root.textContent).toContain("Sailing to Highmark: 6 seconds");
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    drawCampaignOverlay(g, m);
    expect([...g.querySelectorAll("text")].map((t) => t.textContent)).toContain("Thornfield Granges");
    // one sailing time per lane, written on that lane, from where the party stands
    const lanes = [...g.querySelectorAll("text.lane")];
    expect(lanes).toHaveLength(2);
    expect(new Set(lanes.map((t) => `${t.getAttribute("x")},${t.getAttribute("y")}`)).size).toBe(2);
    // an unmet Reapers' Compact is not on the chart
    const early = campaignMapOf(c, newSettlements(), undefined, mapPins({ ...c, expeditions: 0 }, p, []), offers, newSettlements().tech, "hollowmere");
    const g2 = document.createElementNS("http://www.w3.org/2000/svg", "g");
    drawCampaignOverlay(g2, early);
    expect([...g2.querySelectorAll("text")].map((t) => t.textContent)).not.toContain("Thornfield Granges");
    // lanes from Highmark point at the other two
    const from = campaignMapOf(c, newSettlements(), undefined, mapPins(c, p, []), offers, newSettlements().tech, "highmark");
    const g3 = document.createElementNS("http://www.w3.org/2000/svg", "g");
    drawCampaignOverlay(g3, from);
    expect(g3.querySelectorAll("text.lane")).toHaveLength(2);
  });
});

describe("CampaignMap", () => {
  it("states the shores, the infrastructure, the Syndicate's sighting with its age, and the powers, in words", () => {
    const m = new CampaignMap();
    host.append(m.root);
    m.render(data({ post: true }));
    const text = m.root.textContent ?? "";
    expect(text).toContain("Kessar Reach");
    expect(text).toContain("the Society holds a camp");
    expect(text).toContain("on offer: Secure the River Crossing");
    expect(text).toContain("no road");
    expect(text).toContain("no telegraph");
    expect(text).toContain("no steam launch");
    expect(text).toContain("last seen at the ford, 2 days ago");
    expect(text).toContain("Ward of the Nine Lamps");
    expect(text).toContain("A power you have not met"); // the Guild is unmet
  });

  it("shows no rival goal without intel and the goal with it; no word at all when it has not been seen", () => {
    const m = new CampaignMap();
    m.render(data());
    expect(m.root.textContent).toContain("Without intelligence nobody can say");
    expect(m.root.textContent).not.toContain("Your intelligence suggests");
    m.render(data({ intel: 2 }));
    expect(m.root.textContent).toContain("Your intelligence suggests");
    m.render(data({ seen: false }));
    expect(m.root.textContent).toContain("no word of the Syndicate");
    m.render(undefined);
    expect(m.root.hidden).toBe(true);
  });

  it("an audience is a real button in reading order, labelled with the power, and calls the callback with its id", () => {
    const m = new CampaignMap();
    host.append(m.root);
    const audience = vi.fn();
    m.render(data({ asking: ["brine"] }), { audience });
    const buttons = [...m.root.querySelectorAll("button")];
    expect(buttons.length).toBe(1);
    expect(buttons[0]!.tagName).toBe("BUTTON");
    expect(buttons[0]!.getAttribute("aria-label")).toMatch(/audience with/i);
    expect(buttons[0]!.getAttribute("data-power")).toBe("brine");
    buttons[0]!.click();
    expect(audience).toHaveBeenCalledWith("brine");
    // the unmet are marked with a question mark, in text (a dashed ring is decoration, the word is the message)
    expect(m.root.querySelector(".unmet .mark")?.textContent).toBe("?");
  });

  it("the chart overlay draws the stamps with text, and clears itself", () => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g") as unknown as SVGElement;
    drawCampaignOverlay(g, data({ post: true }));
    const text = g.textContent ?? "";
    expect(text).toContain("camp");
    expect(text).toContain("Syndicate, 2 days ago");
    expect(text).toContain("s by sail");
    drawCampaignOverlay(g, undefined);
    expect(g.childNodes.length).toBe(0);
  });

  it("set as text, never markup: a hostile name does not become an element", () => {
    const d = data({ post: true });
    d.regions[1]!.outpost!.name = "<img src=x onerror=alert(1)>";
    const m = new CampaignMap();
    m.render(d);
    expect(m.root.querySelector("img")).toBeNull();
    expect(m.root.textContent).toContain("<img");
  });

  it("lives inside the map room sheet: opening with campaign data shows it, an audience click reaches the room's callback", () => {
    const room = new MapRoom(host);
    const cb = { propose: vi.fn(), ready: vi.fn(), cancel: vi.fn(), close: vi.fn(), audience: vi.fn() };
    const v: MapRoomView = {
      regions: [{ id: "hollowmere", name: "Hollowmere Depot", blurb: "Home.", note: "", here: true }, { id: "kessar", name: "Kessar Reach", blurb: "x", note: "", here: false }],
      ready: [{ slot: 0, name: "Colonel", ready: false }], phase: 0, you: 0, campaign: data({ asking: ["choir"] }),
    };
    room.open(v, cb);
    const btn = document.querySelector<HTMLButtonElement>("button.audience")!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(cb.audience).toHaveBeenCalledWith("choir");
    room.update({ ...v, campaign: data({ asking: [] }) });
    expect(document.querySelector("button.audience")).toBeNull();
    room.dispose();
  });

  it("the stylesheet carries no colour literals (palette variables only) and nothing animates", () => {
    const path = ["src/ui/campaignMap.css", "apps/client/src/ui/campaignMap.css"].map((q) => join(process.cwd(), q)).find((q) => existsSync(q))!;
    const css = readFileSync(path, "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/i);
    expect(css).not.toMatch(/:\s*(white|black|red|green|blue|gold|silver|gray|grey|orange|yellow|purple|brown)\b/i);
    expect(css).toMatch(/var\(--/);
    expect(css).not.toMatch(/animation|transition|@keyframes/);
  });
});
