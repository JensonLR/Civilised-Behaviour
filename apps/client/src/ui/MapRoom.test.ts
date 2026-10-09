// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MapRoom, type MapRoomCallbacks, type MapRoomView } from "./MapRoom.ts";
import { Sailing } from "./Sailing.ts";

const view = (o: Partial<MapRoomView> = {}): MapRoomView => ({
  regions: [
    { id: "hollowmere", name: "Hollowmere Depot", blurb: "Home.", note: "", here: true },
    { id: "kessar", name: "Kessar Reach", blurb: "A bridge with opinions.", note: "Crossing: the bridge stands. Toll: 40 pounds.", here: false },
  ],
  ready: [
    { slot: 0, name: "Colonel", ready: false },
    { slot: 1, name: "Miss Pym", ready: false },
  ],
  phase: 0,
  you: 0,
  ...o,
});

const cbs = () => ({ propose: vi.fn(), ready: vi.fn(), cancel: vi.fn(), close: vi.fn() }) satisfies MapRoomCallbacks;

// (happy-dom's import.meta.url is not a file URL, so find the stylesheet from the package root, which is where vitest runs)
const css = readFileSync(["src/ui/mapRoom.css", "apps/client/src/ui/mapRoom.css"].map((p) => join(process.cwd(), p)).find((p) => existsSync(p))!, "utf8");

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const radios = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")];
const button = (text: RegExp): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => text.test(b.textContent ?? ""))!;

describe("MapRoom", () => {
  it("opens on the far shore, lists every region with its note, and marks where you are", () => {
    const room = new MapRoom(host);
    room.open(view(), cbs());
    expect(room.isOpen).toBe(true);
    expect(radios().map((r) => r.value)).toEqual(["hollowmere", "kessar"]);
    expect(radios().find((r) => r.checked)?.value).toBe("kessar");
    expect(document.querySelector(".dest.here .badge")?.textContent).toBe("you are here");
    expect(document.body.textContent).toContain("Toll: 40 pounds");
    expect(document.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(document.querySelector("[role=dialog]")?.getAttribute("aria-labelledby")).toBe("maproom-title");
    room.dispose();
  });

  it("D-100: opens with the chosen shore focused, and the crew's tick boxes only during a vote", () => {
    const room = new MapRoom(host);
    room.open(view(), cbs());
    expect(document.activeElement).toBe(radios().find((r) => r.checked));
    expect([...document.querySelectorAll(".crew li")].map((li) => li.className)).toEqual(["aboard", "aboard"]);
    room.update(view({ phase: 1, to: "kessar", ready: [{ slot: 0, name: "Colonel", ready: true }, { slot: 1, name: "Miss Pym", ready: false }] }));
    expect([...document.querySelectorAll(".crew li")].map((li) => li.className)).toEqual(["yes", "no"]);
    room.dispose();
  });

  it("proposing sends the chosen region; choosing home disables it with a reason", () => {
    const room = new MapRoom(host);
    const cb = cbs();
    room.open(view(), cb);
    button(/Propose sailing/).click();
    expect(cb.propose).toHaveBeenCalledWith("kessar");
    const home = radios()[0]!;
    home.checked = true;
    home.dispatchEvent(new Event("change", { bubbles: true }));
    expect(button(/Propose sailing/).disabled).toBe(true);
    expect(document.querySelector(".status")?.textContent).toMatch(/already at Hollowmere Depot/);
    button(/Propose sailing/).click();
    expect(cb.propose).toHaveBeenCalledTimes(1);
    room.dispose();
  });

  it("a proposal shows the vote, locks the destination, and offers ready and cancel", () => {
    const room = new MapRoom(host);
    const cb = cbs();
    room.open(view(), cb);
    room.update(view({ phase: 1, to: "kessar", ready: [{ slot: 0, name: "Colonel", ready: true }, { slot: 1, name: "Miss Pym", ready: false }] }));
    expect(button(/Propose sailing/).hidden).toBe(true);
    expect(button(/Ready to sail/).hidden).toBe(false);
    expect(button(/Ready to sail/).getAttribute("aria-pressed")).toBe("true"); // the server says slot 0 (you) is ready
    expect(button(/Call it off/).hidden).toBe(false);
    expect(radios().find((r) => r.value === "hollowmere")!.disabled).toBe(true);
    expect(document.querySelector(".status")?.textContent).toMatch(/1 of 2 ready/);
    expect([...document.querySelectorAll(".crew .state")].map((e) => e.textContent)).toEqual(["ready", "waiting"]); // (words, not colour)
    button(/Call it off/).click();
    expect(cb.cancel).toHaveBeenCalled();
    room.update(view({ phase: 1, to: "kessar" }));
    button(/Ready to sail/).click();
    expect(cb.ready).toHaveBeenCalledWith(true);
    room.dispose();
  });

  it("a sailing under way closes the room without calling close; Escape and Close do", () => {
    const room = new MapRoom(host);
    const cb = cbs();
    room.open(view(), cb);
    room.update(view({ phase: 2, to: "kessar" }));
    expect(room.isOpen).toBe(false);
    expect(cb.close).not.toHaveBeenCalled();
    room.open(view(), cb);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(room.isOpen).toBe(false);
    expect(cb.close).toHaveBeenCalledTimes(1);
    room.open(view(), cb);
    button(/^Close$/).click();
    expect(cb.close).toHaveBeenCalledTimes(2);
    room.dispose();
  });

  it("everything from the wire is text, never markup", () => {
    const room = new MapRoom(host);
    room.open(view({ regions: [{ id: "kessar", name: "<img src=x onerror=alert(1)>", blurb: "<b>bold</b>", note: "<script>1</script>", here: false }], ready: [{ slot: 0, name: "<i>x</i>", ready: false }] }), cbs());
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".dest b")).toBeNull();
    expect(document.querySelector(".crew i")).toBeNull();
    room.dispose();
  });

  it("dispose leaves nothing behind and is safe to repeat", () => {
    const before = document.body.querySelectorAll("*").length;
    const room = new MapRoom(host);
    room.open(view(), cbs());
    room.dispose();
    room.dispose();
    expect(document.body.querySelectorAll("*").length).toBe(before);
  });

  it("the stylesheet uses palette variables only and respects reduced motion and larger text", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).toMatch(/data-motion="reduced"/);
    expect(css).toMatch(/rem/); // sizes in rem: the interface scale (larger text) multiplies them
  });
});

describe("MapRoom: three shores (D-036)", () => {
  const three = (here: "hollowmere" | "kessar" | "highmark" = "hollowmere", o: Partial<MapRoomView> = {}): MapRoomView =>
    view({
      regions: [
        { id: "hollowmere", name: "Hollowmere Depot", blurb: "Home.", note: "", here: here === "hollowmere" },
        { id: "kessar", name: "Kessar Reach", blurb: "A bridge with opinions.", note: "", here: here === "kessar" },
        { id: "highmark", name: "Highmark", blurb: "A court, a chair and a hill.", note: "The chair is vacant in a procedural sense.", here: here === "highmark" },
      ],
      ...o,
    });
  const routes = (): { pair: string; active: boolean }[] => [...document.querySelectorAll<SVGElement>("path.route")].map((r) => ({ pair: r.getAttribute("data-lane")!, active: r.classList.contains("active") }));

  it("draws three marks with their names and a lane between every pair", () => {
    const room = new MapRoom(host);
    room.open(three(), cbs());
    expect([...document.querySelectorAll("g.mark")].map((g) => g.getAttribute("data-region"))).toEqual(["hollowmere", "kessar", "highmark"]);
    expect([...document.querySelectorAll("g.mark text")].map((t) => t.textContent)).toEqual(["Hollowmere", "Kessar", "Highmark"]);
    expect(routes().map((r) => r.pair).sort()).toEqual(["hollowmere|highmark", "hollowmere|kessar", "kessar|highmark"]);
    expect(document.querySelector("svg")?.getAttribute("aria-label")).toMatch(/three shores/);
    expect(radios().map((r) => r.value)).toEqual(["hollowmere", "kessar", "highmark"]);
    room.dispose();
  });

  it("the lane between where you stand and where you are bound lights up, from every shore", () => {
    for (const here of ["hollowmere", "kessar", "highmark"] as const) {
      const room = new MapRoom(host);
      room.open(three(here), cbs());
      for (const dest of (["hollowmere", "kessar", "highmark"] as const).filter((r) => r !== here)) {
        const input = radios().find((r) => r.value === dest)!;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        const lit = routes().filter((r) => r.active).map((r) => r.pair);
        expect(lit, `${here} -> ${dest}`).toEqual([[here, dest].sort((a, b) => ["hollowmere", "kessar", "highmark"].indexOf(a) - ["hollowmere", "kessar", "highmark"].indexOf(b)).join("|")]);
      }
      room.dispose();
    }
  });

  it("proposing Highmark sends it; its note is written beside it; a vote for it locks the destination", () => {
    const room = new MapRoom(host);
    const cb = cbs();
    room.open(three(), cb);
    const hm = radios().find((r) => r.value === "highmark")!;
    hm.checked = true;
    hm.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.body.textContent).toContain("The chair is vacant in a procedural sense.");
    button(/Propose sailing/).click();
    expect(cb.propose).toHaveBeenCalledWith("highmark");
    room.update(three("hollowmere", { phase: 1, to: "highmark" }));
    expect(radios().find((r) => r.checked)?.value).toBe("highmark");
    expect(radios().find((r) => r.value === "kessar")!.disabled).toBe(true);
    expect(routes().filter((r) => r.active).map((r) => r.pair)).toEqual(["hollowmere|highmark"]);
    room.dispose();
  });
});

describe("Sailing", () => {
  it("shows the destination and the seconds, changes its line, then the arrival card, then goes away", () => {
    const s = new Sailing(host);
    expect(s.visible).toBe(false);
    s.show("kessar", 5.2);
    expect(s.visible).toBe(true);
    expect(document.querySelector(".sailing .where")?.textContent).toBe("Bound for Kessar Reach");
    s.show("highmark", 3);
    expect(document.querySelector(".sailing .where")?.textContent).toBe("Bound for Highmark");
    s.show("kessar", 5.2);
    expect(document.querySelector(".sailing .clock")?.textContent).toBe("Six bells to landfall");
    s.show("Somewhere <b>else</b>", 1);
    expect(document.querySelector(".sailing .where")?.textContent).toBe("Bound for Somewhere <b>else</b>");
    expect(document.querySelector(".sailing b")).toBeNull();
    expect(document.querySelector(".sailing .clock")?.textContent).toBe("One bell to landfall");
    s.arriving();
    expect(document.querySelector(".sailing")?.classList.contains("arriving")).toBe(true);
    expect(document.querySelector(".sailing .clock")?.textContent).toMatch(/Unloading/);
    s.hide();
    expect(s.visible).toBe(false);
    s.show("hollowmere", Number.NaN);
    expect(document.querySelector(".sailing .clock")?.textContent).toBe("Landfall");
    s.dispose();
    expect(document.querySelector(".sailing")).toBeNull();
  });
});
