/**
 * TOUCH-ONLY e2e (D-049): a phone held sideways (844 x 390, touch, mobile), the front door to the field with fingers only. Taps are Playwright's touchscreen; drags and held thumbs are
 * the DevTools protocol's touch events (`Input.dispatchTouchEvent`), which Chrome turns into the same Pointer Events a phone's glass does. Waits are POLLS on state, never timers.
 *
 * What it covers: a tap on the door makes the player a touch player and the field opens with the on-screen controls up (and the keyboard hints gone); the left thumb walks; a drag on the
 * right turns the camera; ARMS draws a weapon and FIRE fires it (the server's `shots` rises); two fingers at once (the stick held while FIRE is tapped); PAUSE opens the pause sheet, the
 * controls step aside, and a tap on Resume brings them back.
 * NOT covered: real phones (their GPUs, their browsers' quirks), the command wheel (no hired hand at HQ), iOS Safari (no element full screen there).
 */
import { expect, test, type CDPSession, type Page } from "@playwright/test";

test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

type Hook = {
  session: {
    sessionId: string;
    predicted?: { x: number; y: number; z: number };
    room: { state: { players: Map<string, { shots: number; weapon: number }> } };
  };
  game: { rig: { yaw: number } };
  controls: { weaponWish: number };
};
const hook = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __cb?: Hook }).__cb;
  const me = h?.session.room.state.players.get(h.session.sessionId);
  const p = h?.session.predicted;
  return { ok: !!p, x: p?.x ?? 0, z: p?.z ?? 0, yaw: h?.game.rig.yaw ?? 0, shots: me?.shots ?? 0, weapon: me?.weapon ?? 0 };
});

/** One touch frame: the fingers now on the glass (id -> point). An empty list lifts every finger. */
async function fingers(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: { id: number; x: number; y: number }[]): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
}
async function centre(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test("a phone, fingers only: walk, look, draw, fire, pause and resume", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/?gfx=test");
  const name = page.locator("#name");
  await name.waitFor({ timeout: 120_000 });
  await page.touchscreen.tap(...Object.values(await centre(page, "#name")) as [number, number]);
  await name.fill("Thumbs");
  await page.touchscreen.tap(...Object.values(await centre(page, "#create")) as [number, number]);
  await expect.poll(async () => (await hook(page)).ok, { timeout: 180_000 }).toBe(true);

  // the field opens with the controls up and the keyboard's hints gone
  await expect(page.locator("#touch")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#hud .help")).toBeHidden();
  await page.screenshot({ path: "test-results/touch-field.png" });

  // the left thumb walks: land, push up the screen, hold until the body has plainly moved
  const p0 = await hook(page);
  await fingers(cdp, "touchStart", [{ id: 1, x: 140, y: 300 }]);
  await fingers(cdp, "touchMove", [{ id: 1, x: 140, y: 240 }]);
  await expect.poll(async () => { const p = await hook(page); return Math.hypot(p.x - p0.x, p.z - p0.z); }, { timeout: 60_000 }).toBeGreaterThan(1.5);
  await fingers(cdp, "touchEnd", []);

  // a drag on the right turns the camera
  const yaw0 = (await hook(page)).yaw;
  await fingers(cdp, "touchStart", [{ id: 2, x: 520, y: 140 }]);
  for (let x = 540; x <= 640; x += 20) await fingers(cdp, "touchMove", [{ id: 2, x, y: 140 }]);
  await fingers(cdp, "touchEnd", []);
  await expect.poll(async () => Math.abs((await hook(page)).yaw - yaw0), { timeout: 30_000 }).toBeGreaterThan(0.2);

  // ARMS draws a weapon (a tap: next weapon), FIRE fires it; held while the other thumb is on the stick (two fingers at once)
  const arms = await centre(page, ".t-weapon");
  await page.touchscreen.tap(arms.x, arms.y);
  await expect.poll(async () => (await hook(page)).weapon, { timeout: 30_000 }).toBeGreaterThan(0);
  const shots0 = (await hook(page)).shots;
  const fire = await centre(page, ".t-fire");
  await fingers(cdp, "touchStart", [{ id: 3, x: 140, y: 300 }]);
  await fingers(cdp, "touchStart", [{ id: 3, x: 140, y: 300 }, { id: 4, x: fire.x, y: fire.y }]);
  await expect.poll(async () => (await hook(page)).shots !== shots0, { timeout: 60_000 }).toBe(true);
  await fingers(cdp, "touchEnd", []);
  await page.screenshot({ path: "test-results/touch-fired.png" });

  // PAUSE opens the sheet and the controls step aside; Resume brings them back
  const pause = await centre(page, ".t-pause");
  await page.touchscreen.tap(pause.x, pause.y);
  await expect(page.getByRole("heading", { name: "Expedition Halted" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#touch")).toBeHidden();
  await page.screenshot({ path: "test-results/touch-pause.png" });
  const resume = page.getByRole("button", { name: "Resume" });
  const r = (await resume.boundingBox())!;
  await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  await expect(page.locator("#touch")).toBeVisible({ timeout: 30_000 });
});
