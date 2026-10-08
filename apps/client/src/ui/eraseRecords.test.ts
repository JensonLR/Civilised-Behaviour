// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsSheet } from "./Settings.ts";

/** Self-service erasure from the settings sheet (PRIVACY_DATA_MAP): two presses, only outside a game, and the browser forgets its identity and its list. */
const TOKEN = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const flush = () => new Promise((r) => setTimeout(r, 0));
const button = (): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => /erase/i.test(b.textContent ?? ""))!;

describe("erase my records", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("the first press arms it, the second asks the server, and the browser forgets its identity and expeditions but keeps its settings", async () => {
    localStorage.setItem("cb.identity", TOKEN);
    localStorage.setItem("cb.expeditions", "[]");
    localStorage.setItem("cb.settings.example", "kept");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, campaigns: 2 }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const sheet = settingsSheet();
    sheet.open(null, "access");
    const b = button();
    expect(b.disabled).toBe(false);
    b.click();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(b.textContent).toMatch(/again/i);
    b.click();
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/privacy\/erase$/);
    expect(JSON.parse(String(init.body))).toEqual({ identity: TOKEN });
    expect(localStorage.getItem("cb.identity")).toBeNull();
    expect(localStorage.getItem("cb.expeditions")).toBeNull();
    expect(localStorage.getItem("cb.settings.example")).toBe("kept");
    expect(b.parentElement?.textContent).toMatch(/2 campaigns/);
  });

  it("offline or refused, nothing local is forgotten; in a game the button is locked", async () => {
    localStorage.setItem("cb.identity", TOKEN);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const sheet = settingsSheet();
    sheet.open(null, "access");
    const b = button();
    b.click();
    b.click();
    await flush();
    await flush();
    expect(localStorage.getItem("cb.identity")).toBe(TOKEN);
    expect(b.parentElement?.textContent).toMatch(/cannot be reached/);
    sheet.inGame = true;
    expect(b.disabled).toBe(true);
    expect(b.parentElement?.textContent).toMatch(/Leave the expedition first/);
    sheet.inGame = false;
  });
});
