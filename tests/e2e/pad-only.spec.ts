/**
 * PAD-ONLY e2e (D-038, docs/_notes/polish2.md section 12 item 4): the whole front-door-to-field flow with a scripted Xbox pad and NO keyboard or mouse event, until the very last assertion
 * (one key event, to see the keyboard's own words come back).
 *
 * The pad is a plain object installed with `addInitScript` behind `navigator.getGamepads` (standard mapping); the test moves its sticks and presses its buttons by editing that object, exactly as a
 * browser would report a real one. Waits are POLLS on state (the headless renderer runs at ~10 fps), never timers: a "tap" is held until the page has plainly seen it.
 *
 * What it covers: A on the front door; the left stick walks; the right stick turns; A jumps; X at the notice board opens the paper and B closes it; X at the supply pyramid opens the manifest, the
 * d-pad walks the focus to a stepper and A moves it; LT + RT fires and the server's `shots` rises; X with nothing to use reloads; R3 held switches the view; Start pauses and A resumes; and the
 * prompts: Xbox glyphs on the HUD, then the pad's id is changed to a DualSense and the PlayStation glyphs appear with no reload, then one key event returns the keyboard's.
 * NOT covered: the command wheel (it needs a hired hand on the ground; a solo player at HQ has none, and the wheel says so), and any real hardware.
 */
import { expect, test, type Page } from "@playwright/test";

const XBOX_ID = "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)";
const DUALSENSE_ID = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";

const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 } as const;
type Name = keyof typeof BTN;

type PadObj = { id: string; axes: number[]; buttons: { pressed: boolean; touched: boolean; value: number }[]; seen: number[]; reads: number };
type Hook = {
  session: {
    sessionId: string;
    predicted?: { x: number; y: number; z: number; vy: number; flags: number };
    room: { state: { players: Map<string, { shots: number; reload: number; weapons: number; ammo: number }>; props: Map<string, { x: number; z: number }>; party: string }; send(t: string, m: unknown): void };
  };
  game: { rig: { yaw: number; mode: string } };
};

/** Installed before any page script: a connected standard-mapping pad the test edits through `window.__pad`. */
function installPad(id: string): void {
  const pad: PadObj & Record<string, unknown> = {
    id,
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    // how many times the page has READ each button down, and read the pad at all (so a tap can be released the moment it has been seen)
    seen: Array.from({ length: 17 }, () => 0),
    reads: 0,
  };
  (window as unknown as { __pad: PadObj }).__pad = pad as unknown as PadObj;
  const read = (): unknown[] => {
    const p = pad as unknown as PadObj;
    p.reads++;
    for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i]!.pressed) p.seen[i]!++;
    return [pad];
  };
  Object.defineProperty(navigator, "getGamepads", { value: read, configurable: true });
}

const set = (page: Page, name: Name, down: boolean) =>
  page.evaluate(([i, d]) => {
    const b = (window as unknown as { __pad: PadObj }).__pad.buttons[i as number]!;
    b.pressed = d as boolean;
    b.touched = d as boolean;
    b.value = d ? 1 : 0;
  }, [BTN[name], down] as const);
const stick = (page: Page, which: "l" | "r", x: number, y: number) =>
  page.evaluate(([w, a, b]) => {
    const ax = (window as unknown as { __pad: PadObj }).__pad.axes;
    const o = w === "l" ? 0 : 2;
    ax[o] = a as number;
    ax[o + 1] = b as number;
  }, [which, x, y] as const);
const setId = (page: Page, id: string) => page.evaluate((v) => ((window as unknown as { __pad: PadObj }).__pad.id = v), id);

/** Holds a button until `seen()` is true (the page has acted on it), then lets go. */
async function holdUntil(page: Page, name: Name, seen: () => Promise<boolean>, ms = 30_000): Promise<void> {
  await set(page, name, true);
  try {
    await expect.poll(seen, { timeout: ms }).toBe(true);
  } finally {
    await set(page, name, false);
    await page.waitForTimeout(600); // (a release the page has plainly seen: a press that follows a release inside one frame is one long press)
  }
}
/**
 * A TAP: down until the page has read it down, released at once (before its next frame), then up until the page has read it up. The page sees one press and no hold time: a timed
 * 350 ms press used to be longer than the 0.3 s a HOLD needs (R3's view switch), so on a page whose frames landed inside it the "tap" switched the view (seen on CI and here).
 */
async function tap(page: Page, name: Name): Promise<void> {
  await page.evaluate(async (i) => {
    const p = (window as unknown as { __pad: PadObj }).__pad;
    const b = p.buttons[i]!;
    p.seen[i] = 0;
    b.pressed = b.touched = true;
    b.value = 1;
    await new Promise<void>((r) => { const t = (): void => void (p.seen[i]! > 0 ? r() : setTimeout(t, 2)); t(); });
    b.pressed = b.touched = false;
    b.value = 0;
    const at = p.reads;
    await new Promise<void>((r) => { const t = (): void => void (p.reads > at ? r() : setTimeout(t, 2)); t(); });
  }, BTN[name]);
  await page.waitForTimeout(150);
}

const hook = <T>(page: Page, fn: (h: Hook) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cb)`) as Promise<T>;
const tp = (page: Page, x: number, z: number, facing: number) =>
  page.evaluate(([a, b, f]) => (window as unknown as { __cb: Hook }).__cb.session.room.send("debug", { cmd: `tp:${a}:${b}:${f}` }), [x, z, facing] as const);

test("a pad alone: front door, walk, turn, jump, sheets by glyph, fire, reload, view, pause; Xbox then PlayStation then keyboard words", async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(installPad, XBOX_ID);
  await page.addInitScript(() => {
    localStorage.setItem("cb.name", "Padwise");
    localStorage.setItem("cb.skipTutorials", "1");
  });
  await page.goto("/?gfx=test&view=third");
  await page.waitForSelector("#name", { timeout: 120_000 });

  // ---- the front door, by pad: the d-pad walks the focus to "New campaign", A chooses it -----------------------------------------------------
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || "");
    seen.push(id);
    if (id === "create") break;
    await tap(page, "down");
  }
  expect(seen.length, `the d-pad reached "New campaign" (${seen.join(",")})`).toBeLessThan(12);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("create");
  await tap(page, "a");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 120_000 });
  await expect.poll(() => hook(page, (h) => h.session.predicted !== undefined && h.session.room.state.players.has(h.session.sessionId)), { timeout: 60_000 }).toBe(true);

  // ---- the left stick walks; the right stick turns; A jumps ----------------------------------------------------------------------------------
  const pos = () => hook(page, (h) => ({ x: h.session.predicted!.x, z: h.session.predicted!.z }));
  const p0 = await pos();
  await stick(page, "l", 0, -1);
  await expect.poll(async () => { const p = await pos(); return Math.hypot(p.x - p0.x, p.z - p0.z); }, { timeout: 60_000 }).toBeGreaterThan(2);
  await stick(page, "l", 0, 0);

  const yaw0 = await hook(page, (h) => h.game.rig.yaw);
  await stick(page, "r", 1, 0);
  await expect.poll(async () => Math.abs((await hook(page, (h) => h.game.rig.yaw)) - yaw0), { timeout: 30_000 }).toBeGreaterThan(0.3);
  await stick(page, "r", 0, 0);

  // A jumps. The jump is a transient (half a second in the air) and expect.poll samples at growing gaps, so on a fast runner the whole jump fell between two samples and,
  // A being held (a jump is on the press), the poll waited out its 30 s (CI, D-047). A watcher in the page LATCHES "left the ground" on whichever frame it happens.
  await page.evaluate(() => {
    const w = window as unknown as { __cb: Hook; __jumped?: boolean };
    w.__jumped = false;
    const watch = (): void => {
      const p = w.__cb.session.predicted;
      if (p && (p.vy > 1 || (p.flags & 1) === 0)) w.__jumped = true;
      if (!w.__jumped) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await holdUntil(page, "a", () => page.evaluate(() => (window as unknown as { __jumped?: boolean }).__jumped === true));

  // ---- the prompts follow the device: Xbox glyphs at the notice board ----------------------------------------------------------------------
  // the notice board stands at (3.65, -11.05): a step east of it, facing it (west)
  await tp(page, 5.2, -11.05, Math.PI / 2);
  await expect(page.locator(".prompt .glyph-xbox-x")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-device", "xbox");
  await expect(page.locator(".help .glyph-xbox-a")).not.toHaveCount(0); // the hint line too (in the page; a small window hides it)

  // (a press whose effect shows is held until it shows: on a starved runner a 350 ms tap can fall between two frames' pad reads and be lost, as CI saw here)
  await holdUntil(page, "x", () => page.locator("#sheet-paper").isVisible(), 60_000); // X is Use: something is in reach
  await holdUntil(page, "b", () => page.locator("#sheet-paper").isHidden());

  // ---- the supply pyramid: the manifest opens, the d-pad walks the focus to a stepper, A moves it ------------------------------------------
  await tp(page, -4.85, -6.85, Math.PI / 2);
  await expect(page.locator(".prompt .glyph-xbox-x")).toBeVisible({ timeout: 60_000 });
  await holdUntil(page, "x", () => page.locator("#sheet-loadout").isVisible(), 60_000);
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(() => document.activeElement?.getAttribute("data-k"))) === "horses+") break;
    await tap(page, "down");
  }
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-k"))).toBe("horses+");
  await tap(page, "a");
  await expect.poll(() => hook(page, (h) => (JSON.parse(h.session.room.state.party) as { loadout: { horses: number } }).loadout.horses), { timeout: 30_000 }).toBe(1); // the server took the manifest
  await holdUntil(page, "b", () => page.locator("#sheet-loadout").isHidden());

  // ---- LT + RT fires: the server's `shots` rises ---------------------------------------------------------------------------------------------
  // open ground: nothing to use. The camp's loose props are scattered by the campaign's seed, a fresh one per campaign since D-039, and (0, 12) had one in Use
  // reach for about 1 seed in 5 (379 of seeds 1..2000); so the spot is the first near it with no prop within 4 m (none in reach for any of those seeds).
  const open = await hook(page, (h) => {
    const props: { x: number; z: number }[] = [];
    h.session.room.state.props.forEach((p) => props.push({ x: p.x, z: p.z }));
    for (let r = 0; r <= 8; r += 2) for (let k = 0; k < 8; k++) {
      const x = r * Math.cos((k * Math.PI) / 4), z = 12 + r * Math.sin((k * Math.PI) / 4);
      if (props.every((p) => Math.hypot(p.x - x, p.z - z) > 4)) return { x, z };
    }
    return { x: 0, z: 12 };
  });
  await tp(page, open.x, open.z, 0);
  await hook(page, (h) => h.session.room.send("debug", { cmd: "give:all" }));
  await expect.poll(() => hook(page, (h) => h.session.room.state.players.get(h.session.sessionId)!.weapons), { timeout: 30_000 }).toBeGreaterThan(0);
  await tap(page, "right"); // the d-pad takes the next piece from the rack
  const shots0 = await hook(page, (h) => h.session.room.state.players.get(h.session.sessionId)!.shots);
  await set(page, "lt", true);
  await set(page, "rt", true);
  await expect.poll(() => hook(page, (h) => h.session.room.state.players.get(h.session.sessionId)!.shots), { timeout: 60_000 }).not.toBe(shots0);
  await set(page, "rt", false);
  await set(page, "lt", false);

  // ---- X with nothing to use reloads -------------------------------------------------------------------------------------------------------
  await expect(page.locator(".prompt:not([hidden])")).toHaveCount(0); // (nothing in reach: the prompt is gone)
  await set(page, "x", true);
  try {
    await expect.poll(() => hook(page, (h) => h.session.room.state.players.get(h.session.sessionId)!.reload), { timeout: 60_000 }).toBeGreaterThan(0);
  } finally {
    await set(page, "x", false);
  }

  // ---- R3 held switches the view (a tap would not) ---------------------------------------------------------------------------------------
  expect(await hook(page, (h) => h.game.rig.mode)).toBe("third");
  await tap(page, "r3");
  expect(await hook(page, (h) => h.game.rig.mode)).toBe("third"); // a press is not a switch
  await holdUntil(page, "r3", () => hook(page, (h) => h.game.rig.mode === "first"));
  await holdUntil(page, "r3", () => hook(page, (h) => h.game.rig.mode === "third"));

  // ---- Start pauses; A resumes -------------------------------------------------------------------------------------------------------------
  await tap(page, "start");
  await expect(page.locator("#sheet-pause")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#sheet-pause .glyph")).not.toHaveCount(0); // the pause screen's own hints are glyphs too
  await tap(page, "a");
  await expect(page.locator("#sheet-pause")).toBeHidden({ timeout: 30_000 });

  // ---- the device changes under the player's hands: PlayStation glyphs, no reload, then the keyboard's words --------------------------------
  await tp(page, 5.2, -11.05, Math.PI / 2);
  await expect(page.locator(".prompt .glyph-xbox-x")).toBeVisible({ timeout: 60_000 });
  await setId(page, DUALSENSE_ID);
  // any pad input names the device: a nudge of the right stick (it turns the camera only; Y, the old choice, is melee, which swings and turns the body
  // toward the camera, so the player could turn away from the board and lose the prompt being checked)
  await stick(page, "r", 0.4, 0);
  await expect(page.locator(".prompt .glyph-ps-square")).toBeVisible({ timeout: 30_000 });
  await stick(page, "r", 0, 0);
  await expect(page.locator(".prompt .glyph-xbox-x")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-device", "playstation");

  await page.keyboard.press("ShiftLeft"); // the one keyboard event of the flow
  await expect(page.locator(".prompt kbd.glyph-key")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-device", "keyboard");

  expect(errors).toEqual([]);
});
