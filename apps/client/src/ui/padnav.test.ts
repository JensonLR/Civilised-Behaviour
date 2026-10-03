// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLoadout, generatePaper, hirePool, newCampaign, type ParleyView } from "@cb/shared";
import { CommandWheel } from "./CommandWheel.ts";
import { LoadoutSheet } from "./Loadout.ts";
import { MapRoom } from "./MapRoom.ts";
import { NewspaperView } from "./Newspaper.ts";
import { Parley } from "./Parley.ts";
import { Pause } from "./Pause.ts";
import { openSettings, settingsSheet } from "./Settings.ts";
import { openHowTo } from "./HowTo.ts";

/**
 * Every sheet by pad alone (D-038 section 5): all its actionables are reachable by D-pad down (and up wraps), A presses the one in focus, B closes the sheet, LB and RB turn its pages, the first
 * focus is its primary action, and a sheet never loses its focus (a control removed or disabled under the cursor: the next input lands on the primary action, not on nothing). A scripted pad,
 * the animation frame cranked by hand; happy-dom has no layout, so `offsetParent` is faked as "present".
 */

interface FakePad {
  connected: true;
  mapping: "standard";
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}
const pad: FakePad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
let frames: FrameRequestCallback[] = [];
let now = 0;
const A = 0, B = 1, LB = 4, RB = 5, UP = 12, DOWN = 13;
const press = (i: number, on: boolean): void => void (pad.buttons[i] = { pressed: on, value: on ? 1 : 0 });
const tick = (): void => {
  now += 300;
  const run = frames;
  frames = [];
  for (const f of run) f(now);
};
const tap = (i: number): void => {
  press(i, true);
  tick();
  press(i, false);
  tick();
};
const active = (): HTMLElement => document.activeElement as HTMLElement;

beforeEach(() => {
  frames = [];
  now = 1000;
  for (const b of pad.buttons) (b.pressed = false), (b.value = 0);
  pad.axes = [0, 0, 0, 0];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.defineProperty(navigator, "getGamepads", { value: () => [pad], configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { get(this: HTMLElement) { return this.closest("[hidden]") ? null : document.body; }, configurable: true }); // (no layout in happy-dom: hidden means not there)
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** What PadNav can reach inside a sheet's panel, in reading order. */
const actionables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("input, select, button, a[href], [role='menuitem'], [role='button']")].filter(
    (el) => !(el as HTMLInputElement).disabled && el.getAttribute("aria-disabled") !== "true" && el.getAttribute("tabindex") !== "-1" && !el.closest("[inert]") && !el.closest("[hidden]"),
  );

interface Sheet {
  name: string;
  root: () => HTMLElement;
  isOpen: () => boolean;
  /** The control the sheet's own Modal puts first. */
  primary?: string;
  tabs?: boolean;
}

function checkSheet(s: Sheet): void {
  const root = s.root();
  expect(s.isOpen(), `${s.name} open`).toBe(true);
  const items = actionables(root);
  expect(items.length, `${s.name} has actionables`).toBeGreaterThan(0);

  // first focus: inside the sheet, on its primary action
  expect(root.contains(active()), `${s.name}: first focus is inside`).toBe(true);
  expect(items, `${s.name}: first focus is a control a pad reaches`).toContain(active());
  if (s.primary) expect(active().matches(s.primary), `${s.name}: first focus is ${s.primary}`).toBe(true);

  // every actionable is reachable by d-pad down alone, and up wraps from the first to the last
  const seen = new Set<HTMLElement>([active()]);
  for (let i = 0; i < items.length + 1; i++) {
    tap(DOWN);
    expect(root.contains(active()), `${s.name}: down stays in the sheet`).toBe(true);
    seen.add(active());
  }
  for (const el of items) expect(seen.has(el), `${s.name}: reached ${el.outerHTML.slice(0, 70)}`).toBe(true);
  tap(UP);
  tap(UP);
  expect(root.contains(active())).toBe(true); // (no trap that eats focus, no escape into the page behind)

  // the shoulder buttons are page turns, offered to the sheet on its root
  const turns: number[] = [];
  const onTab = (e: Event): void => void turns.push((e as CustomEvent<number>).detail);
  root.addEventListener("padtab", onTab);
  tap(LB);
  tap(RB);
  root.removeEventListener("padtab", onTab);
  expect(turns, `${s.name}: LB then RB`).toEqual([-1, 1]);

  // a sheet never loses its focus: the focused control disappears, the next input lands on the sheet's primary action
  if (items.length > 1) {
    const gone = active();
    const parent = gone.parentElement!;
    const next = gone.nextSibling;
    gone.remove();
    expect(root.contains(active())).toBe(false);
    tap(DOWN);
    expect(root.contains(active()), `${s.name}: focus recovered into the sheet`).toBe(true);
    parent.insertBefore(gone, next);
  }

  // B closes it
  tap(B);
  expect(s.isOpen(), `${s.name}: B closes`).toBe(false);
}

const parleyView: ParleyView = {
  round: 1,
  speaker: "Lamp-Warden Ysolde Hask",
  line: "The toll is forty pounds.",
  toll: 40,
  mood: "neutral",
  options: [
    { id: "pay", label: "Pay the toll", cost: 40, hint: "Quick. Dull." },
    { id: "haggle_flatter", label: "Reason with her", cost: 0, hint: "She has heard it." },
    { id: "walk_away", label: "Walk away", cost: 0, hint: "She notes the time." },
  ],
};

describe("every sheet by pad alone", () => {
  it("the pause sheet", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const pause = new Pause({ canvas: document.createElement("canvas"), invite: () => ({ code: "K7M2Q", link: "x", present: 2, seed: 7 }), leave: () => undefined });
    pause.active = true;
    pause.open();
    checkSheet({ name: "pause", root: () => document.getElementById("sheet-pause")!, isOpen: () => pause.isOpen, primary: ".primary" });
  });

  it("the field manual", () => {
    openHowTo(null);
    checkSheet({ name: "how-to", root: () => document.getElementById("sheet-howto")!, isOpen: () => !document.getElementById("sheet-howto")!.hidden, primary: ".primary" });
  });

  it("the settings, with its tabs on the bumpers", () => {
    openSettings(null, "controls");
    const root = (): HTMLElement => document.getElementById("sheet-settings")!;
    checkSheet({ name: "settings", root, isOpen: () => settingsSheet().isOpen, tabs: true });
  });

  it("the manifest", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sheet = new LoadoutSheet(host);
    sheet.open({ loadout: emptyLoadout(), purse: 120, humans: 1, roster: [], pool: hirePool(41, 2) }, { set: () => undefined, hire: () => undefined, confirm: () => undefined, close: () => undefined });
    checkSheet({ name: "manifest", root: () => document.getElementById("sheet-loadout")!, isOpen: () => sheet.isOpen });
    sheet.dispose();
  });

  it("the map room", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const room = new MapRoom(host);
    room.open(
      {
        regions: [
          { id: "hollowmere", name: "Hollowmere Depot", blurb: "Home.", note: "", here: true },
          { id: "kessar", name: "Kessar Reach", blurb: "A bridge with opinions.", note: "Crossing: the bridge stands.", here: false },
        ],
        ready: [{ slot: 0, name: "Colonel", ready: false }],
        phase: 0,
        you: 0,
      },
      { propose: () => undefined, ready: () => undefined, cancel: () => undefined, close: () => undefined },
    );
    checkSheet({ name: "map room", root: () => document.getElementById("sheet-maproom")!, isOpen: () => room.isOpen });
    room.dispose();
  });

  it("the broadsheet", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const paper = new NewspaperView(host);
    paper.show(generatePaper(newCampaign(3), 3), () => undefined);
    checkSheet({ name: "newspaper", root: () => document.getElementById("sheet-paper")!, isOpen: () => !document.getElementById("sheet-paper")!.hidden, primary: "[data-autofocus]" });
    paper.dispose();
  });

  it("the parley, where A takes the option in focus", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const p = new Parley(host);
    const picked: number[] = [];
    p.open(parleyView, (i) => picked.push(i), () => undefined);
    const root = document.getElementById("sheet-parley")!;
    expect(active().dataset.i).toBe("0"); // the first option is the first focus
    tap(DOWN);
    expect(active().dataset.i).toBe("1");
    tap(A);
    expect(picked).toEqual([1]);
    checkSheet({ name: "parley", root: () => root, isOpen: () => p.isOpen });
    p.dispose();
  });
});

describe("the activation rules", () => {
  it("A presses a button, flips a switch and steps a select; left and right move a slider", () => {
    document.body.innerHTML = `<div id="r" class="overlay"><div role="dialog" aria-modal="true"><button id="b">b</button><input id="sw" type="checkbox"><select id="sel"><option>1</option><option>2</option></select><input id="rg" type="range" min="0" max="100" step="1" value="50"></div></div>`;
    const root = document.getElementById("r")!;
    // a sheet-like root: use the real PadNav through a Modal-free harness
    return import("./PadNav.ts").then(({ startPadNav }) => {
      startPadNav(root, () => true);
      const clicks: string[] = [];
      document.getElementById("b")!.addEventListener("click", () => clicks.push("b"));
      document.getElementById("sw")!.addEventListener("click", () => clicks.push("sw"));
      document.getElementById("b")!.focus();
      tap(A);
      expect(clicks).toEqual(["b"]);
      tap(DOWN);
      expect(active().id).toBe("sw");
      tap(A);
      expect(clicks).toEqual(["b", "sw"]);
      tap(DOWN);
      expect(active().id).toBe("sel");
      tap(A);
      expect((document.getElementById("sel") as HTMLSelectElement).selectedIndex).toBe(1);
      tap(A);
      expect((document.getElementById("sel") as HTMLSelectElement).selectedIndex).toBe(0); // wraps
      tap(DOWN);
      expect(active().id).toBe("rg");
      const before = Number((document.getElementById("rg") as HTMLInputElement).value);
      pad.axes = [0, 0, 0, 0];
      tap(15); // d-pad right
      expect(Number((document.getElementById("rg") as HTMLInputElement).value)).toBeGreaterThan(before);
      tap(14); // left
      expect(Number((document.getElementById("rg") as HTMLInputElement).value)).toBe(before);
    });
  });

  it("D-041: a held direction steps once, waits, then repeats; a press a little slower than a flick is still one step", () => {
    document.body.innerHTML = `<div id="r"><button id="b0">0</button><button id="b1">1</button><button id="b2">2</button><button id="b3">3</button><button id="b4">4</button><button id="b5">5</button></div>`;
    const root = document.getElementById("r")!;
    return import("./PadNav.ts").then(({ startPadNav, NAV_FIRST_REPEAT_MS, NAV_REPEAT_MS }) => {
      startPadNav(root, () => true);
      document.getElementById("b0")!.focus();
      // (each poll here is 300 ms apart: longer than the old 190 ms repeat, shorter than the first repeat)
      expect(NAV_FIRST_REPEAT_MS).toBeGreaterThan(300);
      expect(NAV_REPEAT_MS).toBeLessThan(300);
      press(DOWN, true);
      tick();
      expect(active().id).toBe("b1"); // at once
      tick();
      expect(active().id).toBe("b1"); // 300 ms held: still one step
      tick();
      expect(active().id).toBe("b2"); // 600 ms: the repeat has begun
      tick();
      expect(active().id).toBe("b3"); // and runs
      press(DOWN, false);
      tick();
      tap(DOWN);
      expect(active().id).toBe("b4"); // a fresh press steps at once
    });
  });

  it("the command wheel's stamps are reachable and B cancels without sending", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sent: string[] = [];
    const wheel = new CommandWheel(host, (c) => sent.push(c));
    wheel.open();
    tap(DOWN);
    tap(DOWN);
    expect(active().classList.contains("stamp")).toBe(true);
    tap(B);
    expect(wheel.isOpen).toBe(false);
    expect(sent).toEqual([]);
    wheel.dispose();
  });
});

describe("the letter dial (D-049: a join code by pad alone)", () => {
  it("dialTurn wraps both ways and starts an empty slot at the ends of the alphabet; dialMove grows the field to its limit", async () => {
    const { dialTurn, dialMove } = await import("./PadNav.ts");
    expect(dialTurn("A", 0, 1, "ABC")).toBe("B");
    expect(dialTurn("C", 0, 1, "ABC")).toBe("A");
    expect(dialTurn("A", 0, -1, "ABC")).toBe("C");
    expect(dialTurn("AB", 2, 1, "ABC")).toBe("ABA");
    expect(dialTurn("AB", 2, -1, "ABC")).toBe("ABC");
    expect(dialMove("AB", 0, 1, "ABC", 5)).toEqual(["AB", 1]);
    expect(dialMove("AB", 1, 1, "ABC", 5)).toEqual(["ABA", 2]);
    expect(dialMove("ABCAB", 4, 1, "ABC", 5)).toEqual(["ABCAB", 4]);
    expect(dialMove("AB", 0, -1, "ABC", 5)).toEqual(["AB", 0]);
    const { dialDelete } = await import("./PadNav.ts");
    expect(dialDelete("ABC", 1)).toEqual(["AC", 1]);
    expect(dialDelete("ABC", 2)).toEqual(["AB", 1]);
    expect(dialDelete("A", 0)).toEqual(["", 0]);
  });

  it("A starts the dial, up/down/right type a code, A sends it as Enter; B stops without sending; the menu around it keeps its focus", async () => {
    const { startPadNav } = await import("./PadNav.ts");
    const root = document.createElement("div");
    root.innerHTML = `<input id="code" maxlength="3" data-pad-chars="ABC" data-pad-send /><input id="name" maxlength="4" data-pad-chars="xyz" /><button id="after">after</button>`;
    document.body.append(root);
    const code = root.querySelector<HTMLInputElement>("#code")!;
    const name = root.querySelector<HTMLInputElement>("#name")!;
    const sent: string[] = [];
    const dials: boolean[] = [];
    code.addEventListener("keydown", (e) => e.key === "Enter" && sent.push(code.value));
    name.addEventListener("keydown", (e) => e.key === "Enter" && sent.push(name.value));
    root.addEventListener("paddial", (e) => dials.push((e as CustomEvent<boolean>).detail));
    const stop = startPadNav(root, () => true);
    const RIGHT = 15;
    code.focus();
    tap(A); // the dial starts on "A"
    expect(code.classList.contains("dialing")).toBe(true);
    expect(code.value).toBe("A");
    tap(UP); // B
    tap(RIGHT); // BA
    tap(DOWN); // BC
    tap(RIGHT); // BCA
    tap(RIGHT); // (full: stays)
    tap(UP); // BCB
    expect(code.value).toBe("BCB");
    expect(active()).toBe(code); // up and down turned letters; they did not move the menu's focus
    tap(A);
    expect(sent).toEqual(["BCB"]);
    expect(code.classList.contains("dialing")).toBe(false);
    expect(dials).toEqual([true, false]);
    // the name field: A stops it but sends nothing (finishing a name must not found a campaign); B stops too, and does not close the sheet
    let back = 0;
    root.addEventListener("padback", () => back++);
    tap(DOWN);
    expect(active()).toBe(name);
    tap(A);
    tap(UP);
    tap(A);
    expect(name.value).toBe("y");
    expect(sent).toEqual(["BCB"]);
    tap(A); // X takes the letter out
    tap(2);
    expect(name.value).toBe("");
    tap(UP);
    tap(B);
    expect(name.value).toBe("x");
    tap(A);
    tap(B);
    expect(back).toBe(0);
    expect(name.classList.contains("dialing")).toBe(false);
    tap(DOWN); // the menu moves again
    expect(active().id).toBe("after");
    stop();
  });
});
