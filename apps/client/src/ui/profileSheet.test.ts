// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeSpec, generateCharacter } from "@cb/procedural";
import { settingsSheet } from "./Settings.ts";
import { encodeProfile } from "./profileCode.ts";
import { listExpeditions, noteExpedition, upsertExpedition } from "./expeditions.ts";
import { loadRoster } from "./characters.ts";

/** D-102: Options -> Profile: copy this device's code, restore one (two presses over other papers), never while a game is running. */
const A = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const B = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const flush = () => new Promise((r) => setTimeout(r, 0));
const page = (): HTMLElement => document.querySelector<HTMLElement>("#panel-profile")!;
const btn = (re: RegExp): HTMLButtonElement => [...page().querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? ""))!;
const box = (): HTMLTextAreaElement => page().querySelector<HTMLTextAreaElement>("textarea:not([readonly])")!;
const restoreNote = (): string => box().closest(".srow")!.querySelector(".note")!.textContent ?? "";

describe("the Profile page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    settingsSheet().inGame = false;
  });

  it("Copy my code puts the code on the clipboard and shows it, selected, for copying by hand", async () => {
    localStorage.setItem("cb.identity", A);
    localStorage.setItem("cb.name", "Ada");
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    settingsSheet().open(null, "profile");
    btn(/copy my code/i).click();
    await flush();
    const shown = page().querySelector<HTMLTextAreaElement>("textarea[readonly]")!;
    expect(shown.hidden).toBe(false);
    expect(shown.value).toMatch(/^CB1-/);
    expect(writeText).toHaveBeenCalledWith(shown.value);
    expect(shown.closest(".srow")!.textContent).toMatch(/Copied/);
  });

  it("restores a code: a bad paste is named, a good one is written and the door reopens", async () => {
    vi.useFakeTimers();
    try {
      const reopened = vi.fn();
      const sheet = settingsSheet();
      sheet.onRestored = reopened;
      sheet.open(null, "profile");
      box().value = "hello";
      btn(/^restore$/i).click();
      expect(restoreNote()).toMatch(/not a profile code/);
      const look = encodeSpec(generateCharacter(3));
      box().value = encodeProfile({ identity: A, characters: [{ id: "abc123de", name: "Ada", look }], expeditions: upsertExpedition([], "K7M2Q", { name: "Ada", who: "abc123de" }, Date.now()) });
      btn(/^restore$/i).click();
      expect(restoreNote()).toMatch(/Restored 1 character and 1 expedition/);
      expect(localStorage.getItem("cb.identity")).toBe(A);
      expect(loadRoster().list.map((c) => c.name)).toEqual(["Ada"]);
      expect(listExpeditions().map((e) => e.code)).toEqual(["K7M2Q"]);
      vi.advanceTimersByTime(1300);
      expect(reopened).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("other papers over this device's own expeditions need a second press; in a game, Restore is locked", () => {
    localStorage.setItem("cb.identity", B);
    noteExpedition("W4X7Z", { name: "Cecily" });
    const sheet = settingsSheet();
    sheet.onRestored = () => undefined;
    sheet.open(null, "profile");
    box().value = encodeProfile({ identity: A, characters: [{ id: "abc123de", name: "Ada", look: encodeSpec(generateCharacter(3)) }], expeditions: [] });
    box().dispatchEvent(new Event("input"));
    btn(/^restore$/i).click();
    expect(restoreNote()).toMatch(/1 expedition under other papers/);
    expect(localStorage.getItem("cb.identity")).toBe(B);
    btn(/press again/i).click();
    expect(localStorage.getItem("cb.identity")).toBe(A);
    sheet.inGame = true;
    expect(btn(/^restore$/i).disabled).toBe(true);
    expect(restoreNote()).toMatch(/Leave the expedition first/);
  });
});
