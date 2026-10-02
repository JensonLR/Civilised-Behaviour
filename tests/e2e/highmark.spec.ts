import { expect, test } from "@playwright/test";

/**
 * D-036 in a real browser: the party sails from Hollowmere's map room to Highmark (the second reachable region). The chart lists three shores, the world is rebuilt for the terraced
 * hill, and the tracker names the contract ("The Vacant Chair"). Waits are polls on state, never timers.
 */
type Room = { state: { region: string; travelPhase: number; scenario: string }; send(type: string, msg: unknown): void };
type Hook = { session: { world: { boundsRadius: number }; room: Room } };

test("a browser sails from the map room to Highmark, builds the hill and is given the Vacant Chair", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem("cb.skipTutorials", "1"));
  await page.goto("/?gfx=test");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: { session: { predicted?: unknown } } }).__cb?.session.predicted), undefined, { timeout: 120_000 });

  const state = () =>
    page.evaluate(() => {
      const h = (window as unknown as { __cb: Hook }).__cb;
      return { region: h.session.room.state.region, phase: h.session.room.state.travelPhase, bounds: h.session.world.boundsRadius };
    });
  expect(await state()).toMatchObject({ region: "hollowmere", phase: 0 });

  // the map table opens the map room; the chart lists every shore (five since D-037)
  await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.send("debug", { cmd: "tp:-2.4:-5.8:0" }));
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#sheet-maproom")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#sheet-maproom .dest")).toHaveCount(5);
  await expect(page.locator("#sheet-maproom .dest[data-region=highmark]")).toContainText("Highmark");
  await page.locator("#sheet-maproom .dest[data-region=highmark]").click();
  await page.locator("#sheet-maproom button.primary", { hasText: "Propose sailing" }).click();

  await expect.poll(async () => (await state()).region, { timeout: 90_000 }).toBe("highmark");
  await expect.poll(async () => (await state()).phase, { timeout: 180_000 }).toBe(0); // this page built the new shore and said so (regionReady)
  expect((await state()).bounds).toBe(150); // Highmark's own world (HIGHMARK_ANCHORS.bounds)
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".objectives")).toContainText("The Vacant Chair");
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
