// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceTracker, glyphFor, PROMPT_IDS, type InputDevice } from "../input/devices.ts";
import { bindPrompt, fillPrompt, glyphEl, hasPromptToken, promptPlain } from "../input/glyphDom.ts";
import { setGlyphPreference } from "../settings.ts";
import { CombatHud } from "./CombatHud.ts";
import { CommandWheel } from "./CommandWheel.ts";
import { Hud } from "./Hud.ts";
import { Orientation } from "./Orientation.ts";
import { buildHudChrome } from "./hudChrome.ts";
import { buildPadSection } from "./SettingsPad.ts";
import { sheetHints } from "./sheetHints.ts";
import { openHowTo } from "./HowTo.ts";

/**
 * Prompts (D-038 section 5): no module in ui/ writes a key or button name; every prompt module draws Xbox, PlayStation and keyboard text from one place and draws itself again, with no
 * reload, when the player picks up the other device.
 */

const DEVICES: readonly InputDevice[] = ["keyboard", "xbox", "playstation"];
const use = (d: InputDevice): void => {
  deviceTracker.note(d);
};
beforeEach(() => {
  setGlyphPreference("auto");
  use("keyboard");
  document.body.innerHTML = "";
});
afterEach(() => {
  setGlyphPreference("auto");
  use("keyboard");
});

// ---- the scan -----------------------------------------------------------------------------------------------------------------------------

function uiSources(): { file: string; code: string }[] {
  const dir = ["src/ui", "apps/client/src/ui"].map((p) => join(process.cwd(), p)).find((p) => existsSync(p))!;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((file) => ({ file, code: readFileSync(join(dir, file), "utf8") }));
}
/** Drops block and line comments (a `//` inside a string such as a URL is kept: only a `//` after whitespace or a statement end is a comment). */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{},)])\/\/.*$/gm, "$1");

/** Words that name a key or a button; inside a string they are a hard-coded prompt. */
const HARD = [
  /\b(?:press|hold|tap|click)\s+(?:E|R|F|G|V|X|Q|T|A|B|Y|LB|RB|LT|RT|L3|R3|Esc|Enter|Space|Back|Start)\b/,
  /\((?:X|E|A|B|Y|LB|RB|LT|RT|L3|R3)\)/,
  /["'`](?:Esc|Left mouse|Right mouse|D-pad[a-z ]*|LB|RB|LT|RT|L3|R3|Start|Back)["'`]/,
  /["'`]Hold (?:E|X|R|T)\b/,
];
/** Files that legitimately name keys: the settings screen draws the pad diagram and the rebinding list (the integrator mounts SettingsPad there), the creator is not a prompt. */
const EXEMPT = new Set(["Settings.ts", "CharacterCreator.ts", "creatorLogic.ts", "compassLogic.ts", "DebugOverlay.ts"]);

describe("no hard-coded key names in ui/", () => {
  it("scans every non-test module", () => {
    const files = uiSources();
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const { file, code } of files) {
      if (EXEMPT.has(file)) continue;
      const bare = stripComments(code);
      for (const re of HARD) {
        const m = re.exec(bare);
        if (m) hits.push(`${file}: ${m[0]}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the scanner itself catches what it should (a self-test, so a silent regex cannot pass the scan)", () => {
    const bad = ['x.textContent = "Empty – press X";', 'const t = `Hold E to load`;', 'text("(X)")', 'k = "Left mouse";'];
    for (const line of bad) expect(HARD.some((re) => re.test(stripComments(line)))).toBe(true);
    const fine = ['const a = "{interact} Use";', "// press E in a comment", "/* hold X here */ const b = 1;"];
    for (const line of fine) expect(HARD.some((re) => re.test(stripComments(line)))).toBe(false);
  });
});

// ---- the renderer -------------------------------------------------------------------------------------------------------------------------

describe("prompt tokens", () => {
  it("a token becomes a key cap on the keyboard and a shaped glyph on each pad family, text around it untouched", () => {
    const el = document.createElement("p");
    fillPrompt(el, "{interact}  Pick up barrel", "keyboard");
    expect(el.querySelector("kbd.glyph")!.textContent).toBe("E");
    expect(el.textContent).toBe("E  Pick up barrel");
    fillPrompt(el, "{interact}  Pick up barrel", "xbox");
    expect(el.querySelector(".glyph-xbox-x")!.textContent).toBe("X");
    expect(el.querySelector("kbd")).toBeNull();
    fillPrompt(el, "{interact}  Pick up barrel", "playstation");
    expect(el.querySelector(".glyph-ps-square")!.textContent).toBe("□");
    expect(el.textContent).toBe("□  Pick up barrel");
  });

  it("every prompt id renders on every device with a label and an accessible name", () => {
    for (const d of DEVICES) {
      for (const id of PROMPT_IDS) {
        const g = glyphEl(id, d);
        expect(g.textContent!.length, `${d}/${id}`).toBeGreaterThan(0);
        expect(g.getAttribute("aria-label")!.length, `${d}/${id}`).toBeGreaterThan(0);
        expect(g.textContent).toBe(glyphFor(id, d).label);
      }
    }
  });

  it("a held pad control says hold in its name and in its class; unknown tokens stay as written; alias {use} is interact", () => {
    const view = glyphEl("view", "xbox");
    expect(view.classList.contains("hold")).toBe(true);
    expect(view.getAttribute("aria-label")).toMatch(/^hold /);
    const el = document.createElement("p");
    fillPrompt(el, "Toll: {price} {use}", "xbox");
    expect(el.textContent).toBe("Toll: {price} X");
    expect(promptPlain("{use} / {jump}", "playstation")).toBe("□ / ✕");
    expect(hasPromptToken("{price}")).toBe(false);
    expect(hasPromptToken("{fire}")).toBe(true);
  });

  it("text is never read as markup", () => {
    const el = document.createElement("p");
    fillPrompt(el, "<img src=x onerror=alert(1)> {interact}", "keyboard");
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img");
  });

  it("bindPrompt follows the device in use and stops when told to", () => {
    const el = document.createElement("p");
    const off = bindPrompt(el, () => "{jump}");
    expect(el.textContent).toBe("Space");
    use("xbox");
    expect(el.textContent).toBe("A");
    use("playstation");
    expect(el.textContent).toBe("✕");
    off();
    use("keyboard");
    expect(el.textContent).toBe("✕");
  });

  it("the glyph preference pins the family whatever the last input was", () => {
    const el = document.createElement("p");
    bindPrompt(el, () => "{fire}");
    setGlyphPreference("playstation");
    deviceTracker.setPreference("playstation");
    use("keyboard");
    expect(el.textContent).toBe("R2");
    deviceTracker.setPreference("auto");
    expect(el.textContent).toBe("Left mouse");
  });
});

// ---- every prompt module ------------------------------------------------------------------------------------------------------------------

const text = (e: Element): string => e.textContent ?? "";
const family = (e: Element, d: InputDevice): void => {
  if (d === "keyboard") expect(e.querySelector("kbd.glyph"), `keyboard: a key cap`).not.toBeNull();
  else expect(e.querySelector(d === "xbox" ? "[class*='glyph-xbox-'], .glyph-bumper, .glyph-trigger, .glyph-stick, .glyph-stick-click, .glyph-small, [class*='glyph-dpad']" : "[class*='glyph-ps-'], .glyph-bumper, .glyph-trigger, .glyph-stick, .glyph-stick-click, .glyph-small, [class*='glyph-dpad']"), `${d}: a pad glyph`).not.toBeNull();
};

describe("every prompt module draws all three and follows a device change", () => {
  it("the HUD prompt (and it redraws between frames)", () => {
    const hud = new Hud(document.body);
    const view = { flags: 0, health: 100, reviveProgressOnMe: 0, reviveProgressByMe: -1, prompt: "{interact}  Pick up barrel     {grab}  Drag", reviverName: "", patientName: "", usingGamepad: false, wounds: 0 };
    hud.update(view);
    const prompt = document.querySelector<HTMLElement>(".prompt")!;
    expect(text(prompt)).toBe("E  Pick up barrel     F  Drag");
    family(prompt, "keyboard");
    use("xbox");
    expect(text(prompt)).toBe("X  Pick up barrel     RB  Drag"); // no update() in between
    family(prompt, "xbox");
    use("playstation");
    expect(text(prompt)).toBe("□  Pick up barrel     R1  Drag");
    family(prompt, "playstation");
    use("keyboard");
    expect(text(prompt)).toBe("E  Pick up barrel     F  Drag");
    hud.dispose();
  });

  it("the arms card: the empty-gun line, the number keys, the cannon card", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const c = new CombatHud(root);
    const arms = { weapon: 1, owned: 0b111110, ammo: 0, reserve: 6, reload: 0, wait: 0, gamepad: false, busy: false };
    c.updateArms(arms);
    const gauge = root.querySelector<HTMLElement>(".gtext")!;
    expect(text(gauge)).toBe("Empty – press R");
    use("xbox");
    expect(text(gauge)).toBe("Empty – press X");
    expect(gauge.querySelector(".hold")).not.toBeNull(); // on a pad the reload is the Use control HELD
    use("playstation");
    expect(text(gauge)).toBe("Empty – press □");
    c.updateCannon({ phase: 0, progress: 0, crew: 1, shells: 3, mine: true });
    expect(text(root.querySelector(".cs")!)).toBe("Empty – hold □ to load");
    use("keyboard");
    expect(text(root.querySelector(".cs")!)).toBe("Empty – hold E to load");
    c.updateCannon({ phase: 2, progress: 100, crew: 1, shells: 3, mine: true });
    expect(text(root.querySelector(".cs")!)).toContain("Left mouse lights the fuse");
    expect(root.querySelector(".slot kbd")!.classList.contains("kb-only")).toBe(true); // number keys are a keyboard thing
    c.dispose();
  });

  it("the key hints line", () => {
    const hud = document.createElement("div");
    document.body.appendChild(hud);
    const off = buildHudChrome(hud, "K7M2Q", "x");
    const help = hud.querySelector<HTMLElement>(".help")!;
    expect(text(help)).toContain("Space jump");
    expect(text(help)).toContain("F1 manual");
    use("xbox");
    expect(text(help)).toContain("A jump");
    expect(text(help)).not.toContain("F1");
    expect(text(help)).toContain("RT fire");
    use("playstation");
    expect(text(help)).toContain("✕ jump");
    expect(text(help)).toContain("R2 fire");
    off();
  });

  it("the orientation card", () => {
    const o = new Orientation(document.body);
    const tick = (d: "keyboard" | "pad"): void => o.tick(1 / 60, 0, 0, 0, "hollowmere", "none", false, d);
    tick("keyboard");
    const card = document.querySelector<HTMLElement>(".orientation")!;
    expect(text(card)).toContain("Esc skips");
    family(card, "keyboard");
    use("xbox");
    tick("pad");
    expect(text(card)).toContain("View skips");
    use("playstation");
    expect(text(card)).toContain("Share skips"); // (no tick between: the card follows the tracker)
    expect(card.querySelector(".glyph-ps-cross, .glyph-ps-square, .glyph-ps-circle, .glyph-ps-triangle, .glyph-small, .glyph-stick")).not.toBeNull();
    o.dispose();
  });

  it("the field manual lists the pad's own glyphs, and follows a device change while open", () => {
    openHowTo(null);
    const sheet = document.getElementById("sheet-howto")!;
    const list = sheet.querySelector<HTMLElement>("dl.keys")!;
    family(list, "keyboard");
    use("xbox");
    expect(list.className).toContain("pads");
    expect(list.querySelector(".glyph-xbox-a")).not.toBeNull();
    expect(list.querySelector(".glyph-xbox-x")).not.toBeNull();
    use("playstation");
    expect(list.querySelector(".glyph-ps-cross")).not.toBeNull();
    expect(list.querySelector(".glyph-ps-square")).not.toBeNull();
    expect(text(list)).toContain("Options");
    expect(text(list)).not.toMatch(/\bStart\b/);
    use("keyboard");
    expect(list.className).not.toContain("pads");
    family(list, "keyboard");
  });

  it("the command wheel's how-to line and the sheet hint bar", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wheel = new CommandWheel(host, () => undefined);
    const how = host.querySelector<HTMLElement>(".wheelhint")!;
    expect(text(how)).toContain("Hold T");
    use("xbox");
    expect(text(how)).toMatch(/Hold Down/);
    use("playstation");
    expect(how.querySelector(".hold")).not.toBeNull();
    const hints = sheetHints({ tabs: true });
    document.body.appendChild(hints.el);
    use("xbox");
    expect(text(hints.el)).toBe("A Choose   B Close   LB RB Page");
    use("playstation");
    expect(text(hints.el)).toBe("✕ Choose   ○ Close   L1 R1 Page");
    expect(hints.el.classList.contains("pad-only")).toBe(true);
    hints.dispose();
    wheel.dispose();
  });

  it("the settings' pad section draws the layout in the family in use and redraws on a change", () => {
    const sec = buildPadSection(() => []);
    document.body.appendChild(sec.el);
    use("playstation");
    expect(sec.el.querySelector(".glyph-ps-cross")).not.toBeNull();
    const jump = sec.el.querySelector<HTMLSelectElement>("select[data-action='jump']")!;
    expect([...jump.options].find((o) => o.value === "a")!.textContent).toBe("Cross button");
    use("xbox");
    expect([...jump.options].find((o) => o.value === "a")!.textContent).toBe("A button");
    sec.dispose();
  });
});
