// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSettingChange } from "../settings.ts";
import { openHowTo } from "./HowTo.ts";
import { hasSeenOrientation } from "./Orientation.ts";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("the Field Manual can replay the orientation", () => {
  it("has a Replay button; pressing it forgets that the orientation was dismissed, tells a running card, and closes the manual", () => {
    localStorage.setItem("cb.seenOrientation", "1");
    localStorage.setItem("cb.orientation", '{"done":5,"skipped":true}');
    const heard: string[] = [];
    const off = onSettingChange((k) => heard.push(k));
    openHowTo();
    const sheet = document.getElementById("sheet-howto")!;
    expect(sheet.hidden).toBe(false);
    const replay = sheet.querySelector<HTMLButtonElement>('button[data-act="replay-orientation"]')!;
    expect(replay.textContent).toMatch(/orientation/i);
    expect(hasSeenOrientation()).toBe(true);
    replay.click();
    expect(hasSeenOrientation()).toBe(false);
    expect(localStorage.getItem("cb.orientation")).toBeNull();
    expect(heard).toContain("replayOrientation");
    expect(sheet.hidden).toBe(true);
    off();
    vi.restoreAllMocks();
  });
});
