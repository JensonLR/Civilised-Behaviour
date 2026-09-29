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
  await page.goto(code ? `/?join=${code}` : "/");
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
  await expect.poll(async () => (await hook(a)).players).toBe(2);

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
