// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Menu, type MenuHandlers } from "./Menu.ts";
import { EXPEDITIONS_KEY, listExpeditions, noteExpedition } from "./expeditions.ts";
import { dormantCopy, isDormantSave } from "./menuLogic.ts";
import { CHARACTERS_KEY, MAX_CHARACTERS, parseRoster } from "./characters.ts";

/** The front door's Continue button, "Your expeditions" list, fresh-world New campaign and the friendly card for a save that is not there (D-039). */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const root = (): HTMLElement => document.querySelector<HTMLElement>("#menu")!;
const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root().querySelector<T>(sel)!;
const NOW = Date.now();

interface Calls {
  create: { name: string; dismemberment: boolean }[];
  join: string[];
  resume: { code: string; name: string }[];
}
function make(over: Partial<MenuHandlers> = {}, withResume = true): { menu: Menu; calls: Calls } {
  const calls: Calls = { create: [], join: [], resume: [] };
  const menu = new Menu(root(), {
    onCreate: async (name, rules) => void calls.create.push({ name, dismemberment: rules.dismemberment }),
    onJoin: async (code) => void calls.join.push(code),
    ...(withResume ? { onResume: async (code: string, name: string) => void calls.resume.push({ code, name }) } : {}),
    ...over,
  });
  return { menu, calls };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `<div id="hud"></div><div id="menu"></div>`;
});
afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("a first visit: nothing to continue", () => {
  it("shows no Continue and no list; New campaign is the stamp; the note says the world is fresh", () => {
    make();
    expect(q("#continue-row").hidden).toBe(true);
    expect(q("#expeditions").hidden).toBe(true);
    expect(q("#create").classList.contains("primary")).toBe(true);
    expect(q("#create-note").textContent).toMatch(/fresh world/i);
    expect(q("#create-note").textContent).toMatch(/new seed/i);
  });

  it("New campaign founds a campaign and resumes nothing", async () => {
    const { calls } = make();
    q<HTMLInputElement>("#name").value = "Ada";
    q<HTMLButtonElement>("#create").click();
    await flush();
    expect(calls.create).toEqual([{ name: "Ada", dismemberment: true }]);
    expect(calls.resume).toEqual([]);
  });
});

describe("with expeditions on this device", () => {
  beforeEach(() => {
    noteExpedition("K7M2Q", { name: "Ada", region: "hollowmere", day: 2 }, NOW - 86_400_000);
    noteExpedition("R4T9W", { name: "Bea", region: "kessar", day: 5 }, NOW - 3_600_000 * 3);
  });

  it("offers Continue for the most recent, naming it, and New campaign steps back from the stamp", () => {
    make();
    expect(q("#continue-row").hidden).toBe(false);
    expect(q("#continue .cont-title").textContent).toBe("Continue");
    expect(q("#continue .cont-meta").textContent).toContain("No. R4T9W");
    expect(q("#continue .cont-meta").textContent).toContain("Kessar Reach");
    expect(q("#continue .cont-meta").textContent).toContain("Day 5");
    expect(q("#continue").classList.contains("primary")).toBe(true);
    expect(q("#create").classList.contains("primary")).toBe(false);
  });

  it("Continue is one click: it resumes the most recent expedition through onResume with the name in the box, and closes the door", async () => {
    const { calls } = make();
    q<HTMLInputElement>("#name").value = "Sir Ada";
    q<HTMLButtonElement>("#continue").click();
    expect(q(".consult").hidden).toBe(false); // the working card
    await flush();
    expect(calls.resume).toEqual([{ code: "R4T9W", name: "Sir Ada" }]);
    expect(calls.create).toEqual([]);
    expect(root().hidden).toBe(true);
  });

  it("lists every expedition, newest first, each resumable on its own", async () => {
    const { calls } = make();
    const rows = [...root().querySelectorAll<HTMLElement>("#expeditions li")];
    expect(rows.map((r) => r.querySelector<HTMLElement>(".go")!.dataset.code)).toEqual(["R4T9W", "K7M2Q"]);
    expect(rows[0]!.textContent).toContain("Bea");
    expect(rows[1]!.textContent).toContain("No. K7M2Q");
    expect(rows[1]!.textContent).toContain("Day 2");
    rows[1]!.querySelector<HTMLButtonElement>(".go")!.click();
    await flush();
    expect(calls.resume.map((c) => c.code)).toEqual(["K7M2Q"]);
  });

  it("Forget takes two presses, then removes it from the list and from storage; the last one hides the whole section", () => {
    make();
    const drop = (code: string): HTMLButtonElement => q<HTMLButtonElement>(`#expeditions li:has(.go[data-code="${code}"]) .drop`);
    drop("K7M2Q").click();
    expect(drop("K7M2Q").textContent).toBe("Sure?");
    expect(listExpeditions().map((e) => e.code)).toContain("K7M2Q"); // one press changes nothing
    drop("K7M2Q").click();
    expect(listExpeditions().map((e) => e.code)).toEqual(["R4T9W"]);
    expect(root().querySelectorAll("#expeditions li")).toHaveLength(1);
    q<HTMLButtonElement>("#expeditions .drop").click();
    q<HTMLButtonElement>("#expeditions .drop").click();
    expect(listExpeditions()).toEqual([]);
    expect(q("#expeditions").hidden).toBe(true);
    expect(q("#continue-row").hidden).toBe(true);
    expect(q("#create").classList.contains("primary")).toBe(true);
  });

  it("a stray click that is then abandoned does not leave Forget armed", () => {
    make();
    const drop = q<HTMLButtonElement>("#expeditions li .drop");
    drop.click();
    expect(drop.dataset.armed).toBe("1");
    drop.dispatchEvent(new Event("blur"));
    expect(drop.dataset.armed).toBeUndefined();
    expect(drop.textContent).toBe("Forget");
  });

  it("the demo (no onResume) offers neither Continue nor a list, whatever is stored", () => {
    make({}, false);
    expect(q("#continue-row").hidden).toBe(true);
    expect(q("#expeditions").hidden).toBe(true);
  });

  it("New campaign with expeditions on the device still founds a fresh campaign (never a resume)", async () => {
    const { calls } = make();
    q<HTMLButtonElement>("#create").click();
    await flush();
    expect(calls.create).toHaveLength(1);
    expect(calls.resume).toEqual([]);
  });

  it("join by code is still there and still joins", async () => {
    const { calls } = make();
    q<HTMLInputElement>("#code").value = "h3n6p";
    q<HTMLButtonElement>("#join").click();
    await flush();
    expect(calls.join).toEqual(["H3N6P"]);
  });
});

describe("a save that is not there", () => {
  const dormant = async (): Promise<void> => {
    throw new Error("No expedition by that code is waiting for you.");
  };

  it("gets a friendly card that names the number and what may have happened, not the raw refusal", async () => {
    noteExpedition("K7M2Q", { name: "Ada" }, NOW);
    make({ onResume: dormant });
    q<HTMLButtonElement>("#continue").click();
    await flush();
    const card = q(".consult");
    expect(card.dataset.state).toBe("error");
    expect(card.dataset.kind).toBe("dormant");
    expect(q("#consult-head").textContent).toBe("The file cannot be found");
    expect(q("#consult-step").textContent).toBe(dormantCopy("K7M2Q"));
    expect(q("#consult-step").textContent).toContain("K7M2Q");
    expect(q("#consult-step").textContent).not.toContain("No expedition by that code");
    expect(q<HTMLElement>(".consult .forget").hidden).toBe(false);
    expect(q<HTMLElement>(".consult .retry").hidden).toBe(false);
    expect(root().hidden).toBe(false); // the door stays; nothing was entered
  });

  it("Forget on that card strikes the expedition off the list and returns to the door", async () => {
    noteExpedition("R4T9W", { name: "Bea" }, NOW - 1000);
    noteExpedition("K7M2Q", { name: "Ada" }, NOW);
    make({ onResume: dormant });
    q<HTMLButtonElement>("#continue").click(); // K7M2Q is newest
    await flush();
    q<HTMLButtonElement>(".consult .forget").click();
    expect(listExpeditions().map((e) => e.code)).toEqual(["R4T9W"]);
    expect(q(".consult").hidden).toBe(true);
    expect(root().querySelectorAll("#expeditions li")).toHaveLength(1);
    expect(q("#continue .cont-meta").textContent).toContain("R4T9W");
  });

  it("Try again asks again (a campaign still putting its last save away comes right on the second ask)", async () => {
    noteExpedition("K7M2Q", {}, NOW);
    let asks = 0;
    const { calls } = make({
      onResume: async (code) => {
        asks++;
        if (asks === 1) await dormant();
        else calls.resume.push({ code, name: "" });
      },
    });
    q<HTMLButtonElement>("#continue").click();
    await flush();
    q<HTMLButtonElement>(".consult .retry").click();
    await flush();
    expect(asks).toBe(2);
    expect(calls.resume.map((c) => c.code)).toEqual(["K7M2Q"]);
    expect(root().hidden).toBe(true);
  });

  it("any other failure keeps the plain card with the real reason (and no Forget)", async () => {
    noteExpedition("K7M2Q", {}, NOW);
    make({ onResume: async () => { throw new Error("Failed to fetch"); } });
    q<HTMLButtonElement>("#continue").click();
    await flush();
    expect(q(".consult").dataset.kind).toBe("");
    expect(q("#consult-head").textContent).toBe("The Society regrets...");
    expect(q("#consult-step").textContent).toMatch(/telegraph line is down/i);
    expect(q<HTMLElement>(".consult .forget").hidden).toBe(true);
  });

  it("the old path still works: a join that found nothing offers to resume the code in the box, and a dormant answer there is friendly too", async () => {
    make({
      onJoin: async () => { throw new Error("No campaign with that code (or it is full)."); },
      onResume: dormant,
    });
    q<HTMLInputElement>("#code").value = "H3N6P";
    q<HTMLButtonElement>("#join").click();
    await flush();
    expect(q<HTMLElement>(".consult .resume").hidden).toBe(false);
    q<HTMLButtonElement>(".consult .resume").click();
    await flush();
    expect(q("#consult-head").textContent).toBe("The file cannot be found");
    expect(q<HTMLElement>(".consult .forget").hidden).toBe(true); // (a code this device never recorded has nothing to strike off)
  });

  it("recognises the server's refusal and nothing else", () => {
    expect(isDormantSave("No expedition by that code is waiting for you.")).toBe(true);
    expect(isDormantSave("  No expedition by that code is waiting for you. ")).toBe(true);
    expect(isDormantSave("Failed to fetch")).toBe(false);
    expect(isDormantSave("")).toBe(false);
  });
});

describe("D-102: the characters this device keeps", () => {
  const stored = () => parseRoster(localStorage.getItem(CHARACTERS_KEY))!;
  const who = (): HTMLSelectElement => q<HTMLSelectElement>("#who");

  it("a first visit has one character (the old name kept): no list, no Retire, only + New", () => {
    localStorage.setItem("cb.name", "Ada");
    make();
    expect(q<HTMLInputElement>("#name").value).toBe("Ada");
    expect(who().hidden).toBe(true);
    expect(q("#who-drop").hidden).toBe(true);
    expect(q("#who-new").hidden).toBe(false);
    expect(stored().list.map((c) => c.name)).toEqual(["Ada"]);
  });

  it("+ New starts another with a fresh look and an empty name; the name box names whoever is chosen; the list switches between them", () => {
    localStorage.setItem("cb.name", "Ada");
    const looks: string[] = [];
    const { menu } = make({ onCharacter: (l) => void looks.push(l) });
    const adaLook = menu.look;
    q<HTMLButtonElement>("#who-new").click();
    expect(who().hidden).toBe(false);
    expect(q("#who-drop").hidden).toBe(false);
    expect(q<HTMLInputElement>("#name").value).toBe("");
    expect(looks).toHaveLength(1);
    expect(menu.look).toBe(looks[0]);
    const name = q<HTMLInputElement>("#name");
    name.value = "Bram";
    name.dispatchEvent(new Event("input"));
    expect([...who().options].map((o) => o.textContent)).toEqual(["Ada", "Bram"]);
    expect(stored().list.map((c) => c.name)).toEqual(["Ada", "Bram"]);
    expect(localStorage.getItem("cb.name")).toBe("Bram");
    who().value = stored().list[0]!.id;
    who().dispatchEvent(new Event("change"));
    expect(name.value).toBe("Ada");
    expect(menu.look).toBe(adaLook);
    expect(looks.at(-1)).toBe(adaLook);
    menu.setLook(looks[0]!);
    expect(stored().list[0]!.look).toBe(looks[0]);
  });

  it("Retire takes two presses and never the last one; + New stops at the cap", () => {
    localStorage.setItem("cb.name", "Ada");
    make();
    q<HTMLButtonElement>("#who-new").click();
    const drop = q<HTMLButtonElement>("#who-drop");
    drop.click();
    expect(stored().list).toHaveLength(2);
    drop.click();
    expect(stored().list.map((c) => c.name)).toEqual(["Ada"]);
    expect(drop.hidden).toBe(true);
    expect(q<HTMLInputElement>("#name").value).toBe("Ada");
    for (let i = 0; i < MAX_CHARACTERS + 2; i++) q<HTMLButtonElement>("#who-new").click();
    expect(stored().list).toHaveLength(MAX_CHARACTERS);
    expect(q<HTMLButtonElement>("#who-new").disabled).toBe(true);
  });

  it("resuming a save brings back the character who played it, name and look", async () => {
    localStorage.setItem("cb.name", "Ada");
    const looks: string[] = [];
    const { menu, calls } = make({ onCharacter: (l) => void looks.push(l) });
    const ada = menu.characterId;
    q<HTMLButtonElement>("#who-new").click();
    const name = q<HTMLInputElement>("#name");
    name.value = "Bram";
    name.dispatchEvent(new Event("input"));
    noteExpedition("K7M2Q", { name: "Ada", who: ada, party: ["Cecily"] }, NOW);
    root().innerHTML = ""; // (the next visit: Bram is the chosen one when the door opens)
    const again = make({ onCharacter: (l) => void looks.push(l) });
    expect(q<HTMLInputElement>("#name").value).toBe("Bram");
    expect(q("#continue .cont-meta").textContent).toContain("with Cecily");
    q<HTMLButtonElement>("#continue").click();
    await flush();
    expect(calls.resume).toEqual([]);
    expect(again.calls.resume).toEqual([{ code: "K7M2Q", name: "Ada" }]);
    expect(again.menu.characterId).toBe(ada);
    expect(again.menu.look).toBe(stored().list.find((c) => c.id === ada)!.look);
    expect(looks.at(-1)).toBe(again.menu.look);
  });
});

describe("hostile storage", () => {
  it("a record full of markup and nonsense draws as plain text, never as elements, and never throws", () => {
    localStorage.setItem(
      EXPEDITIONS_KEY,
      JSON.stringify({ v: 1, list: [{ code: "K7M2Q", name: "<img src=x onerror=alert(1)><script>boom()</script>", region: "<b>x</b>", day: "<i>", lastPlayed: NOW }, { code: "<svg onload=x>", lastPlayed: NOW }, null, 7] }),
    );
    expect(() => make()).not.toThrow();
    expect(root().querySelectorAll("#expeditions li")).toHaveLength(1);
    expect(root().querySelector("#expeditions img, #expeditions script, #expeditions svg, #expeditions b, #expeditions i")).toBeNull();
    expect(q("#expeditions .exp-title").textContent).toContain("img src=x");
  });

  it("garbage in the key leaves the door as a first visit would", () => {
    localStorage.setItem(EXPEDITIONS_KEY, "\u0000\u0001 not json");
    make();
    expect(q("#continue-row").hidden).toBe(true);
    expect(q("#create").classList.contains("primary")).toBe(true);
  });
});
