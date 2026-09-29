/**
 * FIRST-PERSON VIEW e2e (added with the first-person camera; docs/_notes/firstperson.md).
 * Toggle key is X (V is melee, see input/Controls.ts VIEW_KEY). Polls state, never timing: the headless renderer is ~10 fps.
 */
import { expect, test, type Page } from "@playwright/test";

type Body = { rig: { joints: { head: { visible: boolean } } } };
type Hook = {
  session: { sessionId: string; predicted?: { x: number; y: number; z: number } };
  stage: { camera: { position: { x: number; y: number; z: number }; fov: number } };
  game: { rig: { yaw: number; pitch: number; mode: string; firstPersonAmount: number }; actors: Map<string, { body: Body }> };
};

const snap = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    const p = h.session.predicted!;
    const c = h.stage.camera;
    return {
      mode: h.game.rig.mode,
      blend: h.game.rig.firstPersonAmount,
      headVisible: h.game.actors.get(h.session.sessionId)!.body.rig.joints.head.visible,
      camHeight: c.position.y - p.y,
      camDistance: Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z),
      fov: c.fov,
      pos: { x: p.x, z: p.z },
    };
  });

test("V-alternative (X) toggles first person: head hidden, camera at the eyes, crosshair, movement follows the view, no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto("/?gfx=low&view=third"); // explicit: the saved choice is per browser
  await page.waitForSelector("#name", { timeout: 60_000 });
  await page.fill("#name", "Periscope");
  await page.click("#create");
  await page.waitForFunction(() => {
    const h = (window as unknown as { __cb?: Hook }).__cb;
    return h?.session.predicted !== undefined && h.game.actors.has(h.session.sessionId);
  });
  await page.locator("#stage").focus();

  await expect.poll(async () => (await snap(page)).camDistance, { timeout: 20_000 }).toBeGreaterThan(3); // follow camera has settled behind us
  const third = await snap(page);
  expect(third.mode).toBe("third");
  expect(third.headVisible).toBe(true);
  await expect(page.locator(".crosshair")).toBeHidden();

  await page.keyboard.press("KeyX");
  await expect.poll(async () => (await snap(page)).blend, { timeout: 20_000 }).toBe(1);
  const first = await snap(page);
  expect(first.mode).toBe("first");
  expect(first.headVisible).toBe(false); // own head (and its hat) hidden so it never clips the lens
  expect(first.camDistance).toBeLessThan(2.2); // at the eyes, not 5 m behind
  expect(first.camHeight).toBeGreaterThan(0.8);
  expect(first.camHeight).toBeLessThan(2.2);
  expect(first.fov).toBeGreaterThan(third.fov + 5);
  await expect(page.locator(".crosshair")).toBeVisible();
  await page.screenshot({ path: "test-results/firstperson.png" });

  // W moves along the view direction (yaw drives movement; the shared step is untouched).
  await page.evaluate(() => {
    const r = (window as unknown as { __cb: Hook }).__cb.game.rig;
    r.yaw = 0.9;
    r.pitch = 0.1;
  });
  const before = (await snap(page)).pos;
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const p = (await snap(page)).pos;
      return Math.hypot(p.x - before.x, p.z - before.z);
    }, { timeout: 30_000 })
    .toBeGreaterThan(2);
  await page.keyboard.up("KeyW");
  const after = (await snap(page)).pos;
  const len = Math.hypot(after.x - before.x, after.z - before.z);
  const dot = ((after.x - before.x) * -Math.sin(0.9) + (after.z - before.z) * -Math.cos(0.9)) / len;
  expect(dot).toBeGreaterThan(0.9);

  await page.keyboard.press("KeyX");
  await expect.poll(async () => (await snap(page)).blend, { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => (await snap(page)).headVisible).toBe(true);
  await expect.poll(async () => (await snap(page)).camDistance, { timeout: 20_000 }).toBeGreaterThan(3);
  await expect(page.locator(".crosshair")).toBeHidden();

  expect(errors).toEqual([]);
});
