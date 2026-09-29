import { expect, test, type Page } from "@playwright/test";

type Hook = {
  session: {
    code: string;
    sessionId: string;
    predicted?: { x: number; y: number; z: number };
    room: { state: { players: { size: number } } };
  };
  game: { overlay: { snapshot(): string } };
};

const hook = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __cb: Hook }).__cb;
  const p = h.session.predicted;
  return { code: h.session.code, id: h.session.sessionId, players: h.session.room.state.players.size, pos: p ? { x: p.x, y: p.y, z: p.z } : null };
});

async function start(page: Page, name: string, code?: string) {
  await page.goto(code ? `/?join=${code}&gfx=low` : "/?gfx=low"); // low preset: fewer pixels/shadows for the software rasteriser
  await page.waitForSelector("#name", { timeout: 60_000 }); // the game boots via dynamic import after `load`
  await page.fill("#name", name);
  await page.click(code ? "#join" : "#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: unknown }).__cb));
  await page.waitForFunction(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    return h.session.predicted !== undefined;
  });
}

test("two players share a campaign, move with prediction, see each other", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  a.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await start(a, "Ada");
  const { code } = await hook(a);
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  // Regression: the HUD once rendered "undefined" because it read the code before first state sync.
  await expect(a.locator(".codebar b")).toHaveText(code);

  const b = await (await browser.newContext()).newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await start(b, "Bertram", code);
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);

  // Player A holds W until they have travelled 3 m. Polling the displacement (not the clock)
  // keeps this valid on software-rendered CI where frames take ~100 ms.
  const before = (await hook(a)).pos!;
  await a.locator("#stage").focus();
  await a.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const p = (await hook(a)).pos!;
      return Math.hypot(p.x - before.x, p.z - before.z);
    }, { timeout: 20_000 })
    .toBeGreaterThan(3);
  await a.keyboard.up("KeyW");
  await a.waitForTimeout(800); // let deceleration + server patches settle
  const after = (await hook(a)).pos!;

  // B's view of A converges on A's authoritative position.
  const seenByB = await b.evaluate((id) => {
    const h = (window as unknown as { __cb: Hook & { session: { room: { state: { players: Map<string, { x: number; z: number }> } } } } }).__cb;
    const p = h.session.room.state.players.get(id);
    return p ? { x: p.x, z: p.z } : null;
  }, (await hook(a)).id);
  expect(seenByB).not.toBeNull();
  expect(Math.hypot(seenByB!.x - after.x, seenByB!.z - after.z)).toBeLessThan(0.75);

  await a.screenshot({ path: "test-results/coop-a.png" });
  await b.screenshot({ path: "test-results/coop-b.png" });
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});

test("joining a bad code shows a friendly error", async ({ page }) => {
  await page.goto("/");
  await page.fill("#name", "Nobody");
  await page.fill("#code", "ZZZZZ");
  await page.click("#join");
  await expect(page.locator("#status")).toContainText(/No campaign/);
});

test("a player walks up to a prop, picks it up, and throws it (real browser, server-authoritative)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page, "Porter");
  const propsHeld = () =>
    page.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { sessionId: string; room: { state: { props: Map<string, { holder: string }> } } } } }).__cb;
      return [...h.session.room.state.props.values()].filter((p) => p.holder === h.session.sessionId).length;
    });

  await page.evaluate(() => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: "nearProp" }));
  await expect(page.locator(".prompt")).toContainText("Pick up", { timeout: 20_000 });
  await page.screenshot({ path: "test-results/prop-prompt.png" });

  await page.locator("#stage").focus();
  await page.keyboard.press("KeyE"); // a very short tap must still register (input latching)
  await expect.poll(propsHeld, { timeout: 20_000 }).toBe(1);
  await expect(page.locator(".prompt")).toContainText("Throw");
  await page.screenshot({ path: "test-results/prop-carried.png" });

  await page.keyboard.press("KeyG");
  await expect.poll(propsHeld, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test("character creator: customise, join, and each player sees the other's look", async ({ browser }) => {
  const errors: string[] = [];
  const pageWith = async (name: string, code?: string) => {
    const page = await (await browser.newContext()).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(code ? `/?join=${code}&gfx=low` : "/?gfx=low");
    await page.waitForSelector(".creator .fields"); // the game boots via dynamic import after `load`
    return page;
  };
  const storedLook = (p: Page) => p.evaluate(() => localStorage.getItem("cb.look"));

  const a = await pageWith("Ada");
  const initialLook = await storedLook(a);
  expect(initialLook).toMatch(/^[A-Za-z0-9_-]{40,60}$/);

  // Controls change the stored (and previewed) look.
  await a.click('[data-act="dice"]');
  const dicedLook = await storedLook(a);
  expect(dicedLook).not.toBe(initialLook);
  await a.click('.tabs button[data-tab="face"]');
  const noseSelect = a.locator('.creator select').first();
  const before = await storedLook(a);
  const optionCount = await noseSelect.locator("option").count();
  await noseSelect.selectOption(String((Number(await noseSelect.inputValue()) + 1) % optionCount));
  expect(await storedLook(a)).not.toBe(before);
  await a.click('.tabs button[data-tab="colour"]');
  await a.locator(".swatch").nth(2).click();
  const finalLookA = (await storedLook(a))!;
  await a.screenshot({ path: "test-results/creator.png" });

  await a.fill("#name", "Ada");
  await a.click("#create");
  await a.waitForFunction(() => Boolean((window as unknown as { __cb?: { session?: { predicted?: unknown } } }).__cb?.session?.predicted));
  const code = await a.locator(".codebar b").textContent();

  const b = await pageWith("Bertram", code!);
  await b.click('[data-act="dice"]');
  const finalLookB = (await storedLook(b))!;
  expect(finalLookB).not.toBe(finalLookA);
  await b.fill("#name", "Bertram");
  await b.click("#join");
  await b.waitForFunction(() => Boolean((window as unknown as { __cb?: { session?: { predicted?: unknown } } }).__cb?.session?.predicted));

  const looksSeenBy = (p: Page) =>
    p.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { room: { state: { players: Map<string, { name: string; look: string }> } } } } }).__cb;
      return Object.fromEntries([...h.session.room.state.players.values()].map((pl) => [pl.name, pl.look]));
    });
  await expect.poll(async () => Object.keys(await looksSeenBy(a)).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => Object.keys(await looksSeenBy(b)).length, { timeout: 30_000 }).toBe(2);
  for (const seen of [await looksSeenBy(a), await looksSeenBy(b)]) {
    expect(seen["Ada"]).toBe(finalLookA); // server canonicalised form equals what was submitted (no history to strip)
    expect(seen["Bertram"]).toBe(finalLookB);
  }
  await b.locator("#stage").focus();
  await b.screenshot({ path: "test-results/two-characters.png" });
  expect(errors).toEqual([]);
});

test("a downed player is revived by a teammate holding interact, then dragged to safety (two real browsers)", async ({ browser }) => {
  const errors: string[] = [];
  const mk = async () => {
    const p = await (await browser.newContext()).newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  };
  const send = (p: Page, cmd: string) =>
    p.evaluate((c) => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: c }), cmd);
  const me = (p: Page) =>
    p.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { sessionId: string; room: { state: { players: Map<string, { flags: number; health: number; x: number; z: number; dragger: string }> } } } } }).__cb;
      const s = h.session.room.state.players.get(h.session.sessionId)!;
      return { flags: s.flags, health: s.health, x: s.x, z: s.z, dragger: s.dragger };
    });
  const DOWNED = 16;
  const DRAGGED = 256;

  const a = await mk();
  await start(a, "Wounded");
  const { code } = await hook(a);
  const b = await mk();
  await start(b, "Medic", code);
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);

  // A goes down: banner + status appear for A, and B sees the marker on A's nametag.
  await send(a, "down");
  await expect(a.locator(".downed")).toContainText("You are down", { timeout: 20_000 });
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 20_000 }).toBe(DOWNED);
  expect((await me(a)).health).toBe(0);
  await a.screenshot({ path: "test-results/downed.png" });

  // B stands beside A, sees the prompt, holds E: progress bar climbs, A is revived with partial health.
  await send(b, "nearDowned");
  await expect(b.locator(".prompt")).toContainText("Revive", { timeout: 20_000 });
  await b.locator("#stage").focus();
  await b.keyboard.down("KeyE");
  await expect(b.locator(".progress")).toBeVisible({ timeout: 20_000 });
  await b.screenshot({ path: "test-results/reviving.png" });
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 30_000 }).toBe(0);
  await b.keyboard.up("KeyE");
  expect((await me(a)).health).toBe(35);
  await expect(a.locator(".downed")).toBeHidden({ timeout: 20_000 });

  // Drag: A down again, B grabs (F) and walks north (W); A's body follows.
  await send(a, "down");
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 20_000 }).toBe(DOWNED);
  await send(b, "nearDowned");
  await expect(b.locator(".prompt")).toContainText("Drag", { timeout: 20_000 });
  await b.keyboard.press("KeyF");
  await expect.poll(async () => (await me(a)).flags & DRAGGED, { timeout: 20_000 }).toBe(DRAGGED);
  const before = await me(a);
  await b.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const now = await me(a);
      return Math.hypot(now.x - before.x, now.z - before.z);
    }, { timeout: 40_000 })
    .toBeGreaterThan(2);
  await b.screenshot({ path: "test-results/dragging.png" });
  await b.keyboard.up("KeyW");
  await b.keyboard.press("KeyF"); // let go
  await expect.poll(async () => (await me(a)).flags & DRAGGED, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});
