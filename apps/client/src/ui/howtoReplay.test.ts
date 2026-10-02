// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSettingChange } from "../settings.ts";
import { openHowTo } from "./HowTo.ts";
import { Orientation, hasSeenOrientation } from "./Orientation.ts";
import { noteExpedition } from "./expeditions.ts";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("the Field Manual can replay the orientation", () => {
  it("has a Replay tutorial button; pressing it forgets this campaign's progress, tells a running card, and closes the manual", () => {
    noteExpedition("K7M2Q", { name: "Ada" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const card = new Orientation(host, "K7M2Q");
    card.skip();
    expect(hasSeenOrientation("K7M2Q")).toBe(true);
    const heard: string[] = [];
    const off = onSettingChange((k) => heard.push(k));
    openHowTo();
    const sheet = document.getElementById("sheet-howto")!;
    expect(sheet.hidden).toBe(false);
    const replay = sheet.querySelector<HTMLButtonElement>('button[data-act="replay-orientation"]')!;
    expect(replay.textContent).toBe("Replay tutorial");
    replay.click();
    expect(hasSeenOrientation("K7M2Q")).toBe(false);
    expect(card.active).toBe(true);
    expect(heard).toContain("replayOrientation");
    expect(sheet.hidden).toBe(true);
    off();
    card.dispose();
    vi.restoreAllMocks();
  });
});
