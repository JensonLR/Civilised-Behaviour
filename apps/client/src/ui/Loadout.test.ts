// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FOLLOWER_CAP } from "@cb/shared";
import type { Loadout } from "@cb/shared";
import { hirePool } from "@cb/shared";
import { emptyLoadout } from "@cb/shared";
import { LoadoutSheet, type LoadoutCallbacks, type LoadoutView } from "./Loadout.ts";

let host: HTMLElement;
let sheet: LoadoutSheet;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  sheet = new LoadoutSheet(host);
});
afterEach(() => {
  sheet.dispose();
  document.body.innerHTML = "";
});

const pool = hirePool(41, 2);
const view = (o: Partial<LoadoutView> = {}): LoadoutView => ({ loadout: emptyLoadout(), purse: 120, humans: 1, roster: [], pool, ...o });
const cbs = (): { set: Mock<(l: Loadout) => void>; hire: Mock<(id: string, on: boolean) => void>; confirm: Mock<() => void>; close: Mock<() => void> } & LoadoutCallbacks =>
  ({ set: vi.fn<(l: Loadout) => void>(), hire: vi.fn<(id: string, on: boolean) => void>(), confirm: vi.fn<() => void>(), close: vi.fn<() => void>() });
const q = <T extends HTMLElement = HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
const qa = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...host.querySelectorAll<T>(sel)];
const key = (k: string): void => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };

describe("the manifest sheet", () => {
  it("opens as a labelled dialog with a ledger row per item, in table order", () => {
    sheet.open(view(), cbs());
    expect(sheet.isOpen).toBe(true);
    const panel = q(".loadout");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(q("#loadout-title").textContent).toBe("Manifest");
    expect(qa(".lrow[data-item]").map((r) => r.dataset.item)).toEqual(["ammo", "medical", "provisions", "powder", "horses", "wagon"]);
    for (const r of qa(".lrow[data-item]")) {
      expect(r.querySelector(".name")!.textContent!.length).toBeGreaterThan(2);
      expect(r.querySelector(".note")!.textContent!.length).toBeGreaterThan(10);
      expect(r.querySelectorAll("button")).toHaveLength(2);
      for (const b of r.querySelectorAll("button")) expect(b.getAttribute("aria-label")).toMatch(/^(Fewer|More): /);
    }
  });

  it("steppers send the new manifest and show it at once; limits disable the stepper; the wagon toggles", () => {
    const c = cbs();
    sheet.open(view(), c);
    q('[data-k="ammo+"]').click();
    expect(c.set).toHaveBeenLastCalledWith({ ...emptyLoadout(), ammo: 1 });
    expect(q('[data-item="ammo"] output').textContent).toBe("1");
    q('[data-k="ammo+"]').click();
    expect(c.set).toHaveBeenLastCalledWith({ ...emptyLoadout(), ammo: 2 });
    expect(q<HTMLButtonElement>('[data-k="ammo+"]').disabled).toBe(true); // at the limit
    expect(q<HTMLButtonElement>('[data-k="medical-"]').disabled).toBe(true); // nothing to take away
    q('[data-k="wagon+"]').click();
    expect((c.set.mock.lastCall![0] as Loadout).wagon).toBe(true);
    expect(q('[data-item="wagon"] output').textContent).toBe("Yes");
    q('[data-k="wagon-"]').click();
    expect(q('[data-item="wagon"] output').textContent).toBe("No");
  });

  it("the purse line, the manifest cost and the balance are plain numbers in pounds", () => {
    sheet.open(view({ loadout: { ...emptyLoadout(), ammo: 1, horses: 1 }, purse: 100 }), cbs());
    const lines = qa(".summary .line").map((l) => l.textContent);
    expect(lines[0]).toContain("£100");
    expect(lines[1]).toContain("£38");
    expect(lines[2]).toContain("£62");
    sheet.update(view({ loadout: { ...emptyLoadout(), horses: 2, wagon: true }, purse: 30 }));
    const poor = qa(".summary .line").map((l) => l.textContent);
    expect(poor[1]).toContain("£90");
    expect(poor[2]).toContain("−£60"); // a deficit is written, not just coloured
  });

  it("the weight gauge speaks in words and numbers, never colour alone", () => {
    sheet.open(view(), cbs());
    expect(q(".gauge .word").textContent).toBe("Light");
    expect(q(".gauge .kg").textContent).toBe("0 of 30 kg");
    sheet.update(view({ loadout: { ...emptyLoadout(), ammo: 2, medical: 1, provisions: 1 } })); // 12 + 3 + 4 = 19 of 30
    expect(q(".gauge .word").textContent).toBe("Laden");
    sheet.update(view({ loadout: { ...emptyLoadout(), ammo: 2, medical: 3, provisions: 2 } })); // 29 of 30
    expect(q(".gauge .word").textContent).toBe("Full");
    sheet.update(view({ loadout: { ...emptyLoadout(), ammo: 2, powder: 3 } })); // 36 of 30
    expect(q(".gauge .word").textContent).toBe("Overloaded");
    expect(q(".gauge .kg").textContent).toBe("36 of 30 kg");
    expect(q(".problems").textContent).toMatch(/Overweight by 6 kg/);
    expect(q(".bar").getAttribute("data-word")).toBe("Overloaded");
    expect(q<HTMLElement>(".bar").style.getPropertyValue("--fill")).toBe("100%");
  });

  it("problems and the departure preview say what the quay will do", () => {
    sheet.open(view({ loadout: { ...emptyLoadout(), wagon: true }, purse: 500 }), cbs());
    expect(q(".problems").textContent).toMatch(/needs a horse/);
    expect(q(".sheet .status, .loadout .status").textContent).toMatch(/Wagon left on the quay/);
    sheet.update(view({ loadout: { ...emptyLoadout(), ammo: 1 }, purse: 500 }));
    expect(q(".problems").children).toHaveLength(0);
    expect(q(".loadout .status").textContent).toMatch(/Cancel is free/);
  });

  it("hands: the roster with stamps and facts, the pool with signing fees; Sign and Dismiss report intent", () => {
    const c = cbs();
    const hired = pool[0]!;
    sheet.open(view({ roster: [{ ...hired, owed: 6, loyalty: 35, wounded: 1 }], purse: 100 }), c);
    const mine = qa(".roster .hand");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.querySelector(".name")!.textContent).toBe(hired.name);
    expect(mine[0]!.querySelector(".stamp-tag")!.textContent!.length).toBeGreaterThan(5);
    expect(mine[0]!.querySelector(".facts")!.textContent).toMatch(/owed £6/);
    expect(mine[0]!.querySelector(".facts")!.textContent).toMatch(/laid up 1/);
    expect(qa(".pool .hand")).toHaveLength(pool.length - 1); // the hired one is not offered again
    qa<HTMLButtonElement>(".pool .hand button")[0]!.click();
    expect(c.hire).toHaveBeenCalledWith(pool[1]!.id, true);
    q(`[data-k="dismiss-${hired.id}"]`).click();
    expect(c.hire).toHaveBeenLastCalledWith(hired.id, false);
  });

  it("a hand the purse cannot sign, or a full roster, cannot be signed: aria-disabled, a reason in the status line, no message", () => {
    const c = cbs();
    sheet.open(view({ purse: 3 }), c);
    const b = qa<HTMLButtonElement>(".pool .hand button")[0]!;
    expect(b.getAttribute("aria-disabled")).toBe("true");
    b.click();
    expect(c.hire).not.toHaveBeenCalled();
    expect(q(".loadout .status").textContent).toMatch(/signing fee/);
    const full = Array.from({ length: FOLLOWER_CAP }, (_, i) => ({ ...pool[0]!, id: `hand-x${i}`, name: `Hand ${i}` }));
    sheet.update(view({ roster: full, purse: 500 }));
    const b2 = qa<HTMLButtonElement>(".pool .hand button")[0]!;
    b2.click();
    expect(c.hire).not.toHaveBeenCalled();
    expect(q(".loadout .status").textContent).toMatch(new RegExp(`${FOLLOWER_CAP} hands`));
  });

  it("empty rosters and empty quays have words", () => {
    sheet.open(view({ pool: [] }), cbs());
    expect(q(".roster .empty").textContent!.length).toBeGreaterThan(10);
    expect(q(".pool .empty").textContent!.length).toBeGreaterThan(10);
  });

  it("every string is text, never markup", () => {
    const evil = { ...pool[0]!, name: "<img src=x onerror=alert(1)>" };
    sheet.open(view({ roster: [evil] }), cbs());
    expect(host.querySelector("img")).toBeNull();
    expect(q(".roster .name").textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("hostile view data cannot break the sheet (NaN purse, junk manifest, too many hands)", () => {
    const junk = { loadout: { ammo: 99, wagon: "yes" }, purse: Number.NaN, humans: -4, roster: [], pool: [] } as unknown as LoadoutView;
    expect(() => sheet.open(junk, cbs())).not.toThrow();
    expect(q(".summary .line").textContent).toContain("£0");
    expect(q('[data-item="ammo"] output').textContent).toBe("2");
    const many = { ...view(), pool: Array.from({ length: 40 }, (_, i) => ({ ...pool[0]!, id: `hand-q${i}` })) };
    sheet.update(many);
    expect(qa(".pool .hand").length).toBeLessThanOrEqual(6);
  });

  it("Prepare confirms and closes without also reporting a plain close; Not yet / Escape close and report once", () => {
    const c = cbs();
    sheet.open(view(), c);
    q('[data-k="prepare"]').click();
    expect(c.confirm).toHaveBeenCalledTimes(1);
    expect(c.close).not.toHaveBeenCalled();
    expect(sheet.isOpen).toBe(false);
    sheet.open(view(), c);
    q('[data-k="leave"]').click();
    expect(c.close).toHaveBeenCalledTimes(1);
    sheet.open(view(), c);
    key("Escape");
    expect(sheet.isOpen).toBe(false);
    expect(c.close).toHaveBeenCalledTimes(2);
    expect(c.confirm).toHaveBeenCalledTimes(1);
  });

  it("the room closing the table (closeUi) does not report back", () => {
    const c = cbs();
    sheet.open(view(), c);
    sheet.closeUi();
    expect(sheet.isOpen).toBe(false);
    expect(c.close).not.toHaveBeenCalled();
  });

  it("focus: lands on the first control, follows tab order ledger -> hands -> actions, and survives an update", () => {
    sheet.open(view({ roster: [] }), cbs());
    const order = qa<HTMLElement>("button:not([disabled])").map((b) => b.dataset.k);
    expect(order[0]).toBe("ammo+");
    expect(order.indexOf("wagon+")).toBeGreaterThan(order.indexOf("ammo+"));
    expect(order.findIndex((k) => k?.startsWith("hire-"))).toBeGreaterThan(order.indexOf("wagon+"));
    expect(order.at(-2)).toBe("leave");
    expect(order.at(-1)).toBe("prepare");
    expect(document.activeElement).toBe(q('[data-k="ammo+"]'));
    q('[data-k="medical+"]').focus();
    sheet.update(view({ loadout: { ...emptyLoadout(), medical: 1 } }));
    expect(document.activeElement).toBe(q('[data-k="medical+"]'));
    // a stepper that has just hit its limit hands focus to its twin
    sheet.update(view({ loadout: { ...emptyLoadout(), medical: 2 } }));
    q('[data-k="medical+"]').focus();
    sheet.update(view({ loadout: { ...emptyLoadout(), medical: 3 } }));
    expect(document.activeElement).toBe(q('[data-k="medical-"]'));
  });

  it("is keyboard operable: a stepper is a real button (Enter / Space activate natively) and the dialog traps Tab", () => {
    sheet.open(view(), cbs());
    for (const b of qa<HTMLButtonElement>("button")) expect(b.type).toBe("button");
    const last = q('[data-k="prepare"]');
    last.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    // happy-dom has no layout (offsetParent is null), so the trap finds nothing to wrap; what matters is that it never throws or lets focus leave the sheet
    expect(q(".loadout").contains(document.activeElement)).toBe(true);
  });
});

describe("styles", () => {
  const path = ["src/ui/loadout.css", "apps/client/src/ui/loadout.css"].map((p) => join(process.cwd(), p)).find((p) => existsSync(p))!;
  const css = readFileSync(path, "utf8"); // (happy-dom's import.meta.url is not a file URL)
  it("carry no colour literals (palette variables only)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/i);
    expect(css).not.toMatch(/:\s*(white|black|red|green|blue|gold|silver|gray|grey|orange|yellow|purple|brown)\b/i);
    expect(css).toMatch(/var\(--/);
  });
  it("narrow screens reflow and motion is opt-in", () => {
    expect(css).toMatch(/@media \(max-width/);
    expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
  });
});
