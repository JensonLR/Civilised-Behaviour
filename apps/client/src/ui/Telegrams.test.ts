// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Telegrams } from "./Telegrams.ts";

/** The stack never reaches the aim zone: past the middle of the picture (less 2.5 rem) the older slips fold to one line and the newest stays whole. */
describe("telegram stack and the aim zone", () => {
  afterEach(() => vi.restoreAllMocks());

  const stackAt = (bottom: number): { t: Telegrams; root: HTMLElement } => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ bottom } as DOMRect);
    const t = new Telegrams(document.body);
    return { t, root: document.body.querySelector<HTMLElement>(".telegrams")! };
  };

  it("folds the older slips when the stack would reach past the middle less 2.5 rem", () => {
    const { t, root } = stackAt(400);
    t.push("one");
    expect(root.classList.contains("crowded")).toBe(false); // (one slip never folds)
    t.push("two");
    expect(root.classList.contains("crowded")).toBe(true);
    t.dispose();
  });

  it("leaves a stack that ends above the line whole", () => {
    const { t, root } = stackAt(300); // (720 / 2 - 40 = 320)
    t.push("one");
    t.push("two");
    t.push("three");
    expect(root.classList.contains("crowded")).toBe(false);
    t.dispose();
  });
});

/** A debrief (an ending's results, a line each) is marked so the sheet shows it whole, a row per line; a passing slip is not. */
describe("debrief slips", () => {
  it("marks a multi-line notice as a debrief and keeps its lines", () => {
    const t = new Telegrams(document.body);
    t.push("The purse is £165 (+£45).");
    t.push("The Committee pays £45.\nThe Ward now regards you as wary.\nThe purse is £165.");
    const slips = Array.from(document.body.querySelectorAll<HTMLElement>(".telegrams .telegram"));
    expect(slips.map((e) => e.classList.contains("debrief"))).toEqual([false, true]);
    expect(slips[1]!.querySelector(".body")!.textContent!.split("\n")).toHaveLength(3);
    t.dispose();
  });
});
