// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

/** The overlay as a browser drives it: pointer events from fingers (D-049). */

async function make() {
  vi.resetModules();
  document.body.replaceChildren();
  document.body.className = "";
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  const { TouchControls } = await import("./TouchControls.ts");
  const dev = await import("./devices.ts");
  const t = new TouchControls(document);
  return { t, dev };
}
const ptr = (target: Element, type: string, id: number, x: number, y: number, pointerType = "touch"): void => {
  target.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType, bubbles: true, cancelable: true }));
};

afterEach(() => vi.unstubAllGlobals());

describe("TouchControls (the DOM overlay)", () => {
  it("shows only in the field, for a touch player, with no sheet up; a finger anywhere makes the player a touch player", async () => {
    const { t, dev } = await make();
    expect(t.root.hidden).toBe(true);
    t.inGame = true;
    expect(t.root.hidden).toBe(true);   // a keyboard player so far
    ptr(document.body, "pointerdown", 1, 10, 10);
    expect(dev.deviceTracker.device).toBe("touch");
    expect(t.root.hidden).toBe(false);
    expect(document.body.classList.contains("touch-ui")).toBe(true);
    // the portrait notice lives above the HUD (its own element) and is offered only while the controls are
    const notice = document.querySelector<HTMLElement>("body > .t-portrait")!;
    expect(notice.hidden).toBe(false);
    t.blocked = true;
    expect(t.root.hidden).toBe(true);
    expect(notice.hidden).toBe(true);
    t.blocked = false;
    dev.deviceTracker.note("keyboard");
    expect(t.root.hidden).toBe(true);
    expect(document.body.classList.contains("touch-ui")).toBe(false);
  });

  it("the stick steers from where the thumb lands, a second finger drags the view, a third holds FIRE; a mouse is ignored; a sheet lets go of everything", async () => {
    const { t, dev } = await make();
    t.inGame = true;
    dev.deviceTracker.note("touch");
    const zone = t.root.querySelector(".t-stick-zone")!;
    const look = t.root.querySelector(".t-look")!;
    const fire = t.root.querySelector(".t-fire")!;
    ptr(zone, "pointerdown", 1, 150, 300);
    ptr(zone, "pointermove", 1, 150, 200);   // straight up, far
    expect(t.move.y).toBeLessThan(-0.9);
    expect(Math.abs(t.move.x)).toBeLessThan(1e-9);
    ptr(look, "pointerdown", 2, 600, 200);
    ptr(look, "pointermove", 2, 640, 190);
    ptr(look, "pointermove", 2, 660, 185);
    expect(t.takeLook()).toEqual([60, -15]);
    expect(t.takeLook()).toEqual([0, 0]);
    ptr(fire, "pointerdown", 3, 700, 350);
    expect(t.down.fire).toBe(true);
    expect(t.takePressed()).toBe(1 << 0);   // (FIRE is button 0: reported once, even after it is let go)
    expect(t.takePressed()).toBe(0);
    ptr(fire, "pointerdown", 4, 700, 350, "mouse");   // (a mouse click on the glass is not a finger)
    ptr(fire, "pointerup", 3, 700, 350);
    expect(t.down.fire).toBe(false);
    ptr(zone, "pointerup", 1, 150, 200);
    expect(t.move).toEqual({ x: 0, y: 0 });
    ptr(zone, "pointerdown", 5, 150, 300);
    ptr(zone, "pointermove", 5, 250, 300);
    ptr(fire, "pointerdown", 6, 700, 350);
    t.blocked = true;
    expect(t.move).toEqual({ x: 0, y: 0 });
    expect(t.down.fire).toBe(false);
  });

  it("USE reads RELOAD when there is nothing to use; every button carries its word", async () => {
    const { t } = await make();
    const use = t.root.querySelector(".t-use")!;
    t.showUse(false);
    expect(use.textContent).toBe("RELOAD");
    t.showUse(true);
    expect(use.textContent).toBe("USE");
    const words = [...t.root.querySelectorAll(".t-btn")].map((b) => b.textContent);
    for (const w of ["FIRE", "AIM", "JUMP", "CROUCH", "MELEE", "GRAB", "THROW", "ARMS", "ORDERS", "VIEW", "PAUSE"]) expect(words).toContain(w);
    // the prompts name the same buttons (the manual and the orientation card print `TOUCH_LABEL`)
    const { TOUCH_LABEL } = await import("./devices.ts");
    for (const id of ["fire", "aim", "jump", "crouch", "melee", "grab", "throw", "view", "pause", "interact"] as const) expect(words, id).toContain(TOUCH_LABEL[id]);
  });
});
