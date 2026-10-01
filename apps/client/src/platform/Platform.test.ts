import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyOutcome, newCampaign, serializeCampaign, newPowers, serializePowers, newSettlements, serializeSettlements, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, type PlatformAdapter, type InviteRequest, type AchievementId, type PresenceState } from "@cb/shared";
import { PlatformLink } from "./PlatformLink.ts";
import { desktopInfo, pickPlatform } from "./Platform.ts";

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);

function fakeAdapter() {
  let invite: ((r: InviteRequest) => void) | undefined;
  const calls = { unlock: [] as AchievementId[], presence: [] as PresenceState[], init: 0, shutdown: 0, unsub: 0 };
  const adapter: PlatformAdapter = {
    kind: "steam-stub", available: true,
    init: async () => { calls.init++; return true; },
    unlock: (id) => { calls.unlock.push(id); },
    setPresence: (p) => { calls.presence.push(p); },
    onInvite: (cb) => { invite = cb; return () => { calls.unsub++; invite = undefined; }; },
    shutdown: () => { calls.shutdown++; },
  };
  return { adapter, calls, fire: (r: unknown) => invite?.(r as InviteRequest) };
}

const sections = (c = newCampaign(3)) => [serializeCampaign(c), serializePowers(newPowers(3)), serializeSettlements(newSettlements())] as const;
const zero = { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 };

describe("pickPlatform", () => {
  it("the web has no bridge: the no-op adapter", () => {
    const p = pickPlatform({});
    expect(p.kind).toBe("web");
    expect(p.available).toBe(false);
    expect(pickPlatform(undefined).kind).toBe("web");
  });
  it("the desktop bridge's adapter is used when it is whole; a hostile or half-built bridge falls back", () => {
    const { adapter } = fakeAdapter();
    expect(pickPlatform({ cbDesktop: { platform: adapter } })).toBe(adapter);
    for (const bad of [{ platform: {} }, { platform: null }, { platform: { unlock: 1 } }, {}, null]) expect(pickPlatform({ cbDesktop: bad as never }).kind).toBe("web");
    const thrower = { get cbDesktop(): never { throw new Error("boom"); } };
    expect(pickPlatform(thrower as never).kind).toBe("web");
    expect(desktopInfo(thrower as never)).toBeUndefined();
    expect(desktopInfo({ cbDesktop: { info: { version: "1.2.3", platform: "linux" } } })?.version).toBe("1.2.3");
    expect(desktopInfo({})).toBeUndefined();
  });
  it("only Platform.ts and the wish-list card look at window.cbDesktop in the client (the web build never reaches for it elsewhere)", () => {
    const root = new URL("..", import.meta.url).pathname;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) && /cbDesktop/.test(readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) hits.push(p.slice(root.length));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["platform/Platform.ts", "ui/Wishlist.ts"]);
  });
});

describe("PlatformLink (a fake adapter)", () => {
  it("unlocks first_crossing after the first outcome, once, and each later new id once", () => {
    const { adapter, calls } = fakeAdapter();
    const link = new PlatformLink(adapter, () => {});
    expect(link.campaign(...sections())).toEqual([]);
    expect(calls.unlock).toEqual([]);
    let c = applyOutcome(newCampaign(3), { scenario: "secure_crossing", resolution: "paid", toll: 40, paid: 20, bridge: "intact", tally: zero, brokePromise: false, seconds: 30 });
    expect(link.campaign(...sections(c))).toEqual(["first_crossing", "paid_in_full"]);
    expect(calls.unlock).toEqual(["first_crossing", "paid_in_full"]);
    expect(link.campaign(...sections(c))).toEqual([]);
    c = applyOutcome(c, { scenario: "hostage_rescue", resolution: "rescued", toll: 0, paid: 0, bridge: "intact", tally: zero, brokePromise: false, seconds: 30 });
    expect(link.campaign(...sections(c))).toEqual(["rescued_quim"]);
    expect(calls.unlock).toEqual(["first_crossing", "paid_in_full", "rescued_quim"]);
  });
  it("what the storefront already holds is not unlocked again; a malformed save earns nothing and throws nothing", () => {
    const { adapter, calls } = fakeAdapter();
    const link = new PlatformLink(adapter, () => {});
    link.hold(["first_crossing"]);
    const c = applyOutcome(newCampaign(3), { scenario: "secure_crossing", resolution: "bargained", toll: 40, paid: 0, bridge: "intact", tally: zero, brokePromise: false, seconds: 30 });
    expect(link.campaign(...sections(c))).toEqual([]);
    expect(() => link.campaign("not json", "{", "")).not.toThrow();
    expect(link.campaign("not json", "{", "")).toEqual([]);
    expect(calls.unlock).toEqual([]);
  });
  it("presence follows region, party and day, and only a CHANGED state is forwarded; the join code only if valid", () => {
    const { adapter, calls } = fakeAdapter();
    const link = new PlatformLink(adapter, () => {});
    link.presence({ where: "hq", region: "hollowmere", party: 1, day: 1 });
    link.presence({ where: "hq", region: "hollowmere", party: 1, day: 1 });
    link.presence({ where: "region", region: "kessar", party: 2, day: 2, joinCode: CODE });
    link.presence({ where: "region", region: "kessar", party: 2, day: 2, joinCode: "nope" });
    expect(calls.presence.map((p) => [p.where, p.region, p.party, p.day, p.joinCode])).toEqual([["hq", "hollowmere", 1, 1, undefined], ["region", "kessar", 2, 2, CODE], ["region", "kessar", 2, 2, undefined]]);
  });
  it("an invite joins by code and by nothing else; forged requests are ignored", () => {
    const { adapter, fire, calls } = fakeAdapter();
    const join = vi.fn();
    const link = new PlatformLink(adapter, join);
    fire({ joinCode: CODE });
    expect(join).toHaveBeenCalledExactlyOnceWith(CODE);
    for (const bad of [undefined, null, {}, { joinCode: "x" }, { joinCode: 5 }, { joinCode: `${CODE}${CODE}` }, { joinCode: "../../etc" }, "ABCDE"]) fire(bad);
    expect(join).toHaveBeenCalledTimes(1);
    link.dispose();
    expect(calls.unsub).toBe(1);
    expect(calls.shutdown).toBe(1);
  });
  it("the no-op adapter works end to end with the same calls (the web build)", () => {
    const link = new PlatformLink(pickPlatform({}), () => {});
    expect(() => { link.presence({ where: "menu", party: 1, day: 0 }); link.campaign(...sections()); link.dispose(); }).not.toThrow();
  });
});
