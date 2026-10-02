import { expect, test, type Page } from "@playwright/test";

/**
 * D-039 in a real browser: the owner's playtest report ("no form of save world", "load new world just spawns the same one so I don't see the tutorial"). One browser profile:
 *   A: New campaign -> the orientation card shows -> skip it -> the pause sheet shows the world seed and the save line -> Save and quit.
 *   The door offers Continue for A -> it resumes A (same code) and A's card stays skipped (remembered per campaign) -> Save and quit.
 *   New campaign B: a DIFFERENT code and seed, and the orientation card is back. Save and quit.
 *   The door lists both; a list row resumes A.
 * The e2e server keeps campaigns in its MEMORY store, which is enough: resume works within one server process. Every wait is a poll on state or the DOM, never a timer
 * (the headless browser is software-rendered). `gfx=test` is kept across the page loads that leaving causes by storing it (the URL is dropped by the door's own reload).
 */

type Hook = { session: { predicted?: unknown; room: { state: { code: string; seed: number; region: string } } }; pause: { open(): void } };

async function inGame(page: Page): Promise<{ code: string; seed: number; region: string }> {
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 180_000 });
  return page.evaluate(() => {
    const s = (window as unknown as { __cb: Hook }).__cb.session.room.state;
    return { code: s.code, seed: s.seed, region: s.region };
  });
}

/** Opens the pause sheet, checks it names the code and the seed and says where the save stands, and takes "Save and quit" to the door. */
async function saveAndQuit(page: Page, who: { code: string; seed: number }): Promise<void> {
  await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.pause.open());
  const sheet = page.locator("#sheet-pause");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.locator("#pause-info")).toContainText(who.code);
  await expect(sheet.locator("#pause-info")).toContainText(`World seed ${who.seed}`);
  // the server has told us how the save stands (it saves at every ledger change, and when the room was made)
  await expect(sheet.locator("#pause-save")).toContainText(/Saved|Saving|Where you stand is not/, { timeout: 30_000 });
  await sheet.locator('button[data-act="save-quit"]').click();
  // the page returns to the front door once the save is confirmed (a new page load: the door's list is there)
  await expect(page.locator("#continue-row")).toBeVisible({ timeout: 120_000 });
}

test("save and quit, Continue, and a NEW campaign that meets you with the orientation again", async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem("cb.gfx", "test")); // (leaving reloads the page without the URL's ?gfx=test)

  // ---- A: a first campaign: the card shows, and is skipped ------------------------------------------------------------------------------------
  await page.goto("/?gfx=test");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await expect(page.locator("#continue-row")).toBeHidden(); // nothing to continue yet
  await expect(page.locator("#create-note")).toContainText(/fresh world/i);
  await page.fill("#name", "Ada");
  await page.click("#create");
  const a = await inGame(page);
  expect(a.code).toMatch(/^[A-Z2-9]{5}$/);
  const card = page.locator(".orientation");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.locator("button.skip").click();
  await expect(card).toBeHidden({ timeout: 10_000 });
  // the skip is remembered under THIS campaign's code, not for the browser
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cb.expeditions") ?? "null") as { list: { code: string; orient?: { skipped: boolean } }[] } | null);
  expect(stored?.list.find((e) => e.code === a.code)?.orient?.skipped).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("cb.seenOrientation"))).toBeNull();
  await saveAndQuit(page, a);

  // ---- the door: Continue names A, and resumes it; A's card stays skipped -------------------------------------------------------------------
  await expect(page.locator("#continue .cont-meta")).toContainText(a.code);
  await expect(page.locator("#expeditions li")).toHaveCount(1);
  await page.click("#continue");
  const a2 = await inGame(page);
  expect(a2.code).toBe(a.code);
  expect(a2.seed).toBe(a.seed); // the same world, from the file
  expect(a2.region).toBe("hollowmere");
  await expect(card).toBeHidden(); // (per campaign: A was skipped)
  await saveAndQuit(page, a2);

  // ---- B: New campaign is a fresh world and the card is back ---------------------------------------------------------------------------------
  await page.click("#create");
  const b = await inGame(page);
  expect(b.code).not.toBe(a.code);
  expect(b.seed).not.toBe(a.seed);
  await expect(card).toBeVisible({ timeout: 60_000 }); // a NEW campaign starts with the orientation, whatever the last one did
  await saveAndQuit(page, b);

  // ---- the door lists both; Continue is the latest (B); a list row resumes A ---------------------------------------------------------------
  await expect(page.locator("#expeditions li")).toHaveCount(2);
  await expect(page.locator("#continue .cont-meta")).toContainText(b.code);
  await page.locator(`#expeditions .go[data-code="${a.code}"]`).click();
  const a3 = await inGame(page);
  expect(a3.code).toBe(a.code);
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test("a campaign the server no longer has gets the friendly card, and Forget clears it from the list", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem("cb.gfx", "test");
    // a record of an expedition this server never heard of (as after a reset, or past the Society's retention)
    if (!localStorage.getItem("cb.expeditions")) localStorage.setItem("cb.expeditions", JSON.stringify({ v: 1, list: [{ code: "Q2W3E", name: "Ada", region: "kessar", day: 3, lastPlayed: Date.now() - 86_400_000 }] }));
  });
  await page.goto("/?gfx=test");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await expect(page.locator("#continue .cont-meta")).toContainText("Q2W3E");
  await expect(page.locator("#continue .cont-meta")).toContainText("Kessar Reach");
  await page.click("#continue");
  const card = page.locator(".consult");
  await expect(card).toHaveAttribute("data-kind", "dormant", { timeout: 60_000 });
  await expect(page.locator("#consult-head")).toHaveText("The file cannot be found");
  await expect(page.locator("#consult-step")).toContainText("Q2W3E");
  await page.click(".consult .forget");
  await expect(card).toBeHidden();
  await expect(page.locator("#continue-row")).toBeHidden();
  await expect(page.locator("#expeditions")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("cb.expeditions"))).toBeNull();
});
