// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePaper, newCampaign, type ParleyView } from "@cb/shared";
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
  it("lists both regions, marks where we are, carries the campaign's memory and the vote", () => {
    const players = [
      { name: "Ada", slot: 0, connected: true, npc: 0 },
      { name: "Sentry", slot: 16, connected: true, npc: 1 },
      { name: "Bo", slot: 1, connected: true, npc: 0 },
      { name: "Gone", slot: 2, connected: false, npc: 0 },
    ];
    const st = { region: "hollowmere", travelPhase: 1, travelTo: "kessar", travelReady: 0b10, players: { forEach: (cb: (p: (typeof players)[number]) => void) => players.forEach(cb) } };
    const v = mapRoomView(st, newCampaign(1), 0);
    expect(v.regions.map((r) => [r.id, r.here])).toEqual([["hollowmere", true], ["kessar", false]]);
    expect(v.ready).toEqual([{ slot: 0, name: "Ada", ready: false }, { slot: 1, name: "Bo", ready: true }]); // no NPCs, no dropped connections
    expect(v.to).toBe("kessar");
    expect(v.you).toBe(0);
    expect(regionNote("kessar", newCampaign(1))).toMatch(/Not yet visited/);
    const c = newCampaign(1);
    c.history.push({ seq: 1, region: "kessar", resolution: "paid", day: 1 });
    c.crossing.toll = 55;
    expect(regionNote("kessar", c)).toContain("£55");
  });
});
