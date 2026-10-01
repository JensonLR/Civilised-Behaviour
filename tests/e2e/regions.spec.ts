import { expect, test } from "@playwright/test";

/**
 * D-037 in a real browser: the party sails from Hollowmere's map room to Vesper Gorge, then from Vesper's dock to the Saltmarket Delta. Each shore is rebuilt for its own world (bounds), the
 * chart lists five, the tracker names the contract on offer and no page error is raised. Waits are polls on state, never timers.
 */
type Room = { state: { region: string; travelPhase: number }; send(type: string, msg: unknown): void };
type Hook = { session: { world: { boundsRadius: number }; room: Room } };

test("a browser sails Hollowmere to Vesper Gorge to the Saltmarket Delta and is given a contract at each", async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem("cb.seenOrientation", "1"));
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
  const tp = (x: number, z: number) => page.evaluate(([a, b]) => (window as unknown as { __cb: Hook }).__cb.session.room.send("debug", { cmd: `tp:${a}:${b}:0` }), [x, z]);
  const sail = async (to: string, name: string, at: [number, number]) => {
    await tp(at[0], at[1]);
    await page.waitForTimeout(400);
    await page.keyboard.press("KeyE");
    await expect(page.locator("#sheet-maproom")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#sheet-maproom .dest")).toHaveCount(5);
    await expect(page.locator(`#sheet-maproom .dest[data-region=${to}]`)).toContainText(name);
    await page.locator(`#sheet-maproom .dest[data-region=${to}]`).click();
    await page.locator("#sheet-maproom button.primary", { hasText: "Propose sailing" }).click();
    await expect.poll(async () => (await state()).region, { timeout: 90_000 }).toBe(to);
    await expect.poll(async () => (await state()).phase, { timeout: 180_000 }).toBe(0); // this page built the new shore and said so (regionReady)
  };
  expect(await state()).toMatchObject({ region: "hollowmere", phase: 0 });

  await sail("vesper", "Vesper", [-2.4, -5.8]);
  expect((await state()).bounds).toBe(150);
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".objectives")).toContainText(/The Lower Gallery|The Claim Race/);

  await sail("saltmarket", "Saltmarket", [0, 118]); // the dock is the landing
  expect((await state()).bounds).toBe(150);
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".objectives")).toContainText(/The Quiet Barge|The Auction at High Water/);
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
