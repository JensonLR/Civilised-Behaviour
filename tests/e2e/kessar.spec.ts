import { expect, test } from "@playwright/test";

type Hook = {
  session: { world: { boundsRadius: number }; room: { state: { region: string; travelPhase: number; scenario: string }; send(type: string, msg: unknown): void } };
};

/** One real browser: found at Kessar Reach (`?region=kessar`), sees the orders of the day, sails home, and the page rebuilds its world for Hollowmere. */
test("a browser founded at Kessar Reach shows the orders, sails home and rebuilds the world", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/?gfx=test&region=kessar");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: { session: { predicted?: unknown } } }).__cb?.session.predicted), undefined, { timeout: 120_000 });

  const state = () => page.evaluate(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    return { region: h.session.room.state.region, phase: h.session.room.state.travelPhase, bounds: h.session.world.boundsRadius };
  });
  expect(await state()).toMatchObject({ region: "kessar", phase: 0, bounds: 120 });
  await expect(page.locator(".objectives")).toBeVisible({ timeout: 30_000 }); // the scenario's orders reached the HUD
  await expect(page.locator(".objectives .text").first()).toContainText(/toll bar/i);

  // sail home from the landing dock (the server only takes a proposal near the map table or a dock)
  await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.send("travelPropose", { to: "hollowmere" }));
  await expect.poll(async () => (await state()).region, { timeout: 60_000 }).toBe("hollowmere");
  await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe(0); // this page built the new shore and said so (regionReady)
  expect((await state()).bounds).not.toBe(120); // the client's own world is Hollowmere's now
  await expect(page.locator(".sailing")).toBeHidden();
  await expect(page.locator(".objectives")).toBeHidden();
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
