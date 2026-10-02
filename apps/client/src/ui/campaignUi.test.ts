// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePaper, newCampaign, pickTemplate, templateNote, type ParleyView } from "@cb/shared";
import { Parley } from "./Parley.ts";
import { NewspaperView } from "./Newspaper.ts";
import { mapRoomView, regionNote } from "../game/campaignView.ts";

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const parleyView = (o: Partial<ParleyView> = {}): ParleyView => ({
  round: 1,
  speaker: "Lamp-Warden Ysolde Hask",
  line: "The toll is forty pounds. <b>Payable now.</b>",
  toll: 40,
  mood: "neutral",
  options: [
    { id: "pay", label: "Pay the toll", cost: 40, hint: "Quick. Dull." },
    { id: "haggle_flatter", label: "Flatter her", cost: 0, hint: "She likes lamps." },
    { id: "walk_away", label: "Walk away", cost: 0, hint: "She notes the time." },
  ],
  ...o,
});

describe("the parley sheet", () => {
  it("shows the Warden's line as text (never markup), one button per option, and picks by click and by number key", () => {
    const p = new Parley(host);
    const pick = vi.fn();
    const close = vi.fn();
    p.open(parleyView(), pick, close);
    expect(p.isOpen).toBe(true);
    const sheet = document.querySelector(".parley")!;
    expect(sheet.querySelector("b")).toBeNull(); // the wire string carried a tag: it is text
    expect(sheet.querySelector(".line")!.textContent).toContain("<b>Payable now.</b>");
    const buttons = [...sheet.querySelectorAll<HTMLButtonElement>("button.opt")];
    expect(buttons.map((b) => b.querySelector(".label")!.textContent)).toEqual(["Pay the toll", "Flatter her", "Walk away"]);
    expect(buttons[0]!.textContent).toContain("£40");
    buttons[1]!.click();
    expect(pick).toHaveBeenLastCalledWith(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }));
    expect(pick).toHaveBeenLastCalledWith(2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "9" })); // no such option
    expect(pick).toHaveBeenCalledTimes(2);
    p.dispose();
  });

  it("Escape walks away (tells the server); a close from the server does not echo back", () => {
    const p = new Parley(host);
    const close = vi.fn();
    p.open(parleyView(), vi.fn(), close);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(p.isOpen).toBe(false);
    p.open(parleyView(), vi.fn(), close);
    p.closeUi();
    expect(close).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it("a new round replaces the options in place", () => {
    const p = new Parley(host);
    p.open(parleyView(), vi.fn(), vi.fn());
    p.update(parleyView({ round: 2, options: [{ id: "walk_away", label: "Leave", cost: 0, hint: "" }] }));
    expect(document.querySelectorAll(".parley button.opt").length).toBe(1);
    expect(document.querySelector(".parley .meta")!.textContent).toContain("Round 2");
    p.dispose();
  });
});

describe("the newspaper sheet", () => {
  it("sets the generated paper in type, all as text, and reports the close once", () => {
    const n = new NewspaperView(host);
    const paper = generatePaper(newCampaign(9), 9);
    const closed = vi.fn();
    n.show(paper, closed);
    expect(n.isOpen).toBe(true);
    expect(document.querySelector(".paper .masthead")!.textContent).toBe(paper.masthead);
    expect(document.querySelector(".paper .headline")!.textContent).toBe(paper.headline);
    expect(document.querySelectorAll(".paper article").length).toBe(paper.stories.length);
    n.hide();
    expect(n.isOpen).toBe(false);
    expect(closed).not.toHaveBeenCalled(); // a programmatic hide (the boat sailing) is not the reader closing it
    n.show(paper, closed);
    (document.querySelector(".paper button") as HTMLButtonElement).click();
    expect(closed).toHaveBeenCalledTimes(1);
    n.dispose();
  });

  it("forged paper data cannot inject markup", () => {
    const n = new NewspaperView(host);
    n.show({ masthead: "<img src=x onerror=alert(1)>", edition: 3, dateline: "d", headline: "<script>1</script>", standfirst: "s", stories: [{ slug: "x", head: "<i>h</i>", body: "b" }], notices: ["<b>n</b>"] }, () => {});
    expect(document.querySelector(".paper img, .paper script, .paper i, .paper b")).toBeNull();
    n.dispose();
  });
});

describe("what the map room is told", () => {
  it("lists every live region, marks where we are, carries the campaign's memory and the vote", () => {
    const players = [
      { name: "Ada", slot: 0, connected: true, npc: 0 },
      { name: "Sentry", slot: 16, connected: true, npc: 1 },
      { name: "Bo", slot: 1, connected: true, npc: 0 },
      { name: "Gone", slot: 2, connected: false, npc: 0 },
    ];
    const st = { region: "hollowmere", travelPhase: 1, travelTo: "kessar", travelReady: 0b10, players: { forEach: (cb: (p: (typeof players)[number]) => void) => players.forEach(cb) } };
    const v = mapRoomView(st, newCampaign(1), 0);
    expect(v.regions.map((r) => [r.id, r.here])).toEqual([["hollowmere", true], ["kessar", false], ["highmark", false], ["vesper", false], ["saltmarket", false]]);
    expect(v.ready).toEqual([{ slot: 0, name: "Ada", ready: false }, { slot: 1, name: "Bo", ready: true }]); // no NPCs, no dropped connections
    expect(v.to).toBe("kessar");
    expect(v.you).toBe(0);
    expect(regionNote("kessar", newCampaign(1))).toMatch(/Not yet visited/);
    const c = newCampaign(1);
    c.history.push({ seq: 1, region: "kessar", resolution: "paid", day: 1, template: "secure_crossing" });
    c.crossing.toll = 55;
    expect(regionNote("kessar", c)).toContain("£55");
  });

  it("D-045: while the Syndicate's raid on the post is due, the chart offers the Raid on the Post at Kessar on most visits; never once it is spent", () => {
    const c = newCampaign(1);
    c.history.push({ seq: 1, region: "kessar", resolution: "paid", day: 1, template: "secure_crossing" });
    const presence = { goal: "sabotage_party" as const, arrivesInS: 200, escort: 1, wagon: false, surveyors: 1, postStage: 2 as const };
    const due = Array.from({ length: 20 }, (_, i) => regionNote("kessar", c, i + 1, { ...presence, raidDue: true }));
    expect(due.filter((n) => n.includes("On offer: The Raid on the Post.")).length).toBeGreaterThan(10);
    for (let i = 1; i <= 20; i++) expect(regionNote("kessar", c, i, presence)).not.toContain("Raid on the Post");
  });

  it("Highmark has its own voice on the chart: unvisited, then the chair as the ledger left it, and the contract on offer", () => {
    const fresh = newCampaign(1);
    expect(regionNote("highmark", fresh)).toMatch(/Not yet visited.*switchback road.*six years/);
    expect(regionNote("highmark", fresh)).not.toMatch(/bridge|toll|fort/);
    expect(regionNote("highmark", fresh, 1)).toContain("On offer: The Vacant Chair.");
    const want: Record<string, RegExp> = { open: /vacant in a procedural sense/, elder: /Princess Orla sits the chair/, younger: /Prince Dunstan sits/, regency: /regency of three signatures/, usurped: /early succession/, sold: /concession is the Syndicate's/ };
    for (const [state, re] of Object.entries(want)) {
      const c = newCampaign(1);
      c.history.push({ seq: 1, region: "highmark", resolution: "regency", day: 3, template: "succession_dispute" });
      c.sites.succession = state as typeof c.sites.succession;
      expect(regionNote("highmark", c), state).toMatch(re);
      expect(regionNote("highmark", c, 2), state).toContain("Last visit: day 3.");
    }
    // Kessar's note is untouched by a Highmark visit
    const c = newCampaign(1);
    c.history.push({ seq: 1, region: "highmark", resolution: "regency", day: 3, template: "succession_dispute" });
    expect(regionNote("kessar", c)).toMatch(/Not yet visited. A bridge/);
    // D-042: after the chair, the strike is on offer; and the chart remembers how the last harvest went, beside the chair
    expect(regionNote("highmark", c, 2)).toContain("On offer: The Reapers' Strike.");
    const harvest: Record<string, RegExp> = { honest_measure: /honest bushel/, bought_back: /Society's bonus/, strike_broken: /Syndicate's men cut/, barley_lost: /lay down in the rain/ };
    for (const [r, re] of Object.entries(harvest)) {
      const h = newCampaign(1);
      h.history.push({ seq: 1, region: "highmark", resolution: r as never, day: 4, template: "reapers_strike" });
      h.sites.ends = { reapers_strike: r as never };
      expect(regionNote("highmark", h), r).toMatch(re);
      expect(regionNote("highmark", h), r).toMatch(/vacant in a procedural sense/);
      expect(regionNote("highmark", h, 2), r).toContain("On offer: The Vacant Chair.");
    }
  });

  it("the map note names the contract the ledger offers next (the same pure rule the server runs at landfall), and nothing without a seed", () => {
    const fresh = newCampaign(1);
    expect(regionNote("kessar", fresh, 1)).toContain("On offer: Secure the River Crossing."); // the first visit is always the crossing
    expect(regionNote("kessar", fresh)).not.toContain("On offer");
    const c = newCampaign(7);
    c.history.push({ seq: 1, region: "kessar", resolution: "forced", day: 1, template: "secure_crossing" });
    c.day = 2;
    const offer = pickTemplate(c, "kessar", 7)!;
    expect(offer).not.toBe("secure_crossing"); // a bridge that was forced is on the books: another contract is offered
    expect(regionNote("kessar", c, 7)).toContain(templateNote(offer).title);
    expect(regionNote("hollowmere", c, 7)).not.toContain("On offer");
  });
});
