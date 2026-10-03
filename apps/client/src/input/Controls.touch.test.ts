// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUTTON } from "@cb/shared";
import type { TouchButton, TouchSource } from "./touchLogic.ts";

/** Controls with a scripted touch overlay: the fingers become the same wire buttons as the pad's, by the same rules (D-049). */

function fakeTouch() {
  const down = { fire: false, aim: false, jump: false, use: false, crouch: false, melee: false, grab: false, throw: false, weapon: false, orders: false, view: false, pause: false } as Record<TouchButton, boolean>;
  let look: [number, number] = [0, 0];
  let pressed = 0;
  const t = {
    takePressed(): number {
      const p = pressed;
      pressed = 0;
      return p;
    },
    /** A tap entirely between two reads: down and up before the game looks. */
    tapBetween(b: TouchButton) {
      pressed |= 1 << (["fire", "aim", "jump", "use", "crouch", "melee", "grab", "throw", "weapon", "orders", "view", "pause"] as const).indexOf(b as never);
    },
    active: true,
    down,
    move: { x: 0, y: 0 },
    shown: [] as boolean[],
    takeLook(): [number, number] {
      const r = look;
      look = [0, 0];
      return r;
    },
    drag(dx: number, dy: number) {
      look = [look[0] + dx, look[1] + dy];
    },
    showUse(u: boolean) {
      this.shown.push(u);
    },
  };
  return t satisfies TouchSource & { drag(dx: number, dy: number): void; tapBetween(b: TouchButton): void };
}

async function make() {
  vi.resetModules();
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  vi.stubGlobal("navigator", { getGamepads: () => [] });
  const { Controls } = await import("./Controls.ts");
  const dev = await import("./devices.ts");
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const c = new Controls(canvas, { sensitivity: 1, padSensitivity: 1, holdToSprint: true });
  const t = fakeTouch();
  c.attachTouch(t);
  return { c, t, dev };
}
const frame = (c: { drainLook(dt: number): [number, number]; sample(): { buttons: number; moveF: number; moveR: number } }, dt = 1 / 30) => {
  const look = c.drainLook(dt);
  return { ...c.sample(), look };
};

afterEach(() => vi.unstubAllGlobals());

describe("Controls: the touch overlay", () => {
  it("the stick moves like a pad's (forward is up the screen), the rim forward runs, a drag looks, and the device becomes touch", async () => {
    const { c, t, dev } = await make();
    t.move.x = 0;
    t.move.y = -0.6;
    let s = frame(c);
    expect(s.moveF).toBeGreaterThan(0);
    expect(s.buttons & BUTTON.SPRINT).toBe(0);
    expect(dev.deviceTracker.device).toBe("touch");
    t.move.y = -1;
    s = frame(c);
    expect(s.buttons & BUTTON.SPRINT).toBe(BUTTON.SPRINT);
    t.drag(10, -4);
    s = frame(c);
    expect(s.look[0]).toBeGreaterThan(10);   // scaled into "mouse pixels"
    expect(s.look[1]).toBeLessThan(0);
    expect(c.assistOn).toBe(true);           // the aim assist serves a thumb as it serves a pad
    // a key press takes it back: keyboard prompts, no assist for the mouse
    t.move.y = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(c.usingTouch).toBe(false);
    expect(dev.deviceTracker.device).toBe("keyboard");
  });

  it("FIRE holds and a tap shorter than a step still fires; AIM and CROUCH toggle; JUMP is a press", async () => {
    const { c, t } = await make();
    t.down.fire = true;
    c.drainLook(1 / 30);
    t.down.fire = false;   // let go before the step's sample
    expect(c.sample().buttons & BUTTON.FIRE).toBe(BUTTON.FIRE);
    expect(frame(c).buttons & BUTTON.FIRE).toBe(0);
    t.down.aim = true;
    expect(frame(c).buttons & BUTTON.AIM).toBe(BUTTON.AIM);
    t.down.aim = false;
    expect(frame(c).buttons & BUTTON.AIM).toBe(BUTTON.AIM);   // still aiming: a tap on, a tap off
    expect(c.aiming).toBe(true);
    t.down.aim = true;
    frame(c);
    t.down.aim = false;
    expect(frame(c).buttons & BUTTON.AIM).toBe(0);
    t.down.crouch = true;
    frame(c);
    t.down.crouch = false;
    expect(frame(c).buttons & BUTTON.CROUCH).toBe(BUTTON.CROUCH);
    t.down.jump = true;
    expect(frame(c).buttons & BUTTON.JUMP).toBe(BUTTON.JUMP);
  });

  it("USE is the pad's rule: a tap uses what is in reach, else reloads (and the button says so); a hold reloads; a revive keeps Use down", async () => {
    const { c, t } = await make();
    let usable = false;
    let holdUse = false;
    c.canInteract = () => usable;
    c.holdInteract = () => holdUse;
    t.down.use = true;
    expect(frame(c).buttons & (BUTTON.INTERACT | BUTTON.RELOAD)).toBe(BUTTON.RELOAD);
    t.down.use = false;
    frame(c);
    expect(t.shown.at(-1)).toBe(false);
    usable = true;
    t.down.use = true;
    expect(frame(c).buttons & (BUTTON.INTERACT | BUTTON.RELOAD)).toBe(BUTTON.INTERACT);
    expect(t.shown.at(-1)).toBe(true);
    let reloaded = false;
    for (let i = 0; i < 15; i++) if (frame(c).buttons & BUTTON.RELOAD) reloaded = true;   // held half a second beside a pickup: a reload
    expect(reloaded).toBe(true);
    t.down.use = false;
    frame(c);
    holdUse = true;
    t.down.use = true;
    let allHeld = true;
    for (let i = 0; i < 20; i++) if ((frame(c).buttons & BUTTON.INTERACT) === 0) allHeld = false;
    expect(allHeld).toBe(true);
  });

  it("ARMS: a tap is the next weapon, a hold puts it away; ORDERS opens and closes the wheel; VIEW and PAUSE fire once a press", async () => {
    const { c, t } = await make();
    const wish0 = c.weaponWish;
    t.down.weapon = true;
    frame(c);
    t.down.weapon = false;
    frame(c);
    expect(c.weaponWish).not.toBe(wish0);
    t.down.weapon = true;
    for (let i = 0; i < 15; i++) frame(c);
    t.down.weapon = false;
    frame(c);
    expect(c.weaponWish).toBe(-1);
    const cmds: string[] = [];
    c.onCommand = (p) => cmds.push(p);
    t.down.orders = true;
    frame(c);
    frame(c);
    t.down.orders = false;
    frame(c);
    expect(cmds).toEqual(["down", "up"]);
    let views = 0, pauses = 0;
    c.onToggleView = () => views++;
    c.onPause = () => pauses++;
    t.down.view = t.down.pause = true;
    for (let i = 0; i < 5; i++) frame(c);
    expect([views, pauses]).toEqual([1, 1]);
  });

  it("a tap that came and went between two reads is not lost: ARMS changes weapon, FIRE fires, PAUSE pauses (the first real-browser run lost ARMS to a slow frame)", async () => {
    const { c, t } = await make();
    const w0 = c.weaponWish;
    t.tapBetween("weapon");
    frame(c);
    frame(c);
    expect(c.weaponWish).not.toBe(w0);
    t.tapBetween("fire");
    expect(frame(c).buttons & BUTTON.FIRE).toBe(BUTTON.FIRE);
    expect(frame(c).buttons & BUTTON.FIRE).toBe(0);
    let pauses = 0;
    c.onPause = () => pauses++;
    t.tapBetween("pause");
    frame(c);
    frame(c);
    expect(pauses).toBe(1);
  });

  it("nothing while a sheet is up, nothing stuck after it; an inactive overlay adds nothing", async () => {
    const { c, t } = await make();
    t.down.fire = true;
    t.move.y = -1;
    frame(c);
    c.blocked = true;
    expect(frame(c)).toMatchObject({ buttons: 0, moveF: 0, moveR: 0 });
    t.down.fire = false;
    t.move.y = 0;
    c.blocked = false;
    expect(frame(c).buttons & BUTTON.FIRE).toBe(0);
    (t as { active: boolean }).active = false;
    t.down.jump = true;
    t.move.y = -1;
    expect(frame(c)).toMatchObject({ buttons: 0, moveF: 0 });
  });
});
