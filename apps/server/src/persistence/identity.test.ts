import { Rng } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { canResume, identityKey, parseIdentity, resolveIdentity } from "./identity.ts";
import { createRecord } from "./record.ts";
import type { IdentityVerifier, PlayerIdentity } from "./types.ts";

const UUID = "3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a13";
const anon = (id = UUID): PlayerIdentity => ({ kind: "anon", id, assurance: "unverified" });
const PEPPER = "a-long-enough-test-pepper";

describe("parseIdentity", () => {
  it("accepts a UUID v4 (normalised to lower case) as an unverified anonymous identity", () => {
    expect(parseIdentity(UUID)).toEqual(anon());
    expect(parseIdentity(UUID.toUpperCase())).toEqual(anon());
  });

  it("rejects everything else, including a steam claim (that needs a verifier)", () => {
    const bad: unknown[] = [undefined, null, 0, 12, {}, [], [UUID], true, "", "x", UUID + "0", UUID.slice(1), UUID.replace("-4e7b-", "-1e7b-"), UUID.replace("-8a61-", "-0a61-"), UUID.replace(/-/g, ""), "steam:76561198000000000", ` ${UUID}`, `${UUID}\n`, "00000000-0000-0000-0000-000000000000", { toString: () => UUID }];
    for (const b of bad) expect(parseIdentity(b)).toBeUndefined();
  });

  it("fuzz: 2000 tokens never throw and are accepted exactly when they are a v4 uuid", () => {
    const rng = new Rng(7);
    const hex = "0123456789abcdefABCDEF";
    const gen = (i: number): unknown => {
      switch (i % 6) {
        case 0: return Array.from({ length: rng.int(0, 40) }, () => String.fromCharCode(rng.int(0, 0xffff))).join("");
        case 1: { const s = UUID.split(""); s[rng.int(0, 35)] = hex[rng.int(0, hex.length - 1)]!; return s.join(""); }
        case 2: return [undefined, null, NaN, 1e999, {}, [], () => 1, Symbol.iterator, 10n][rng.int(0, 8)];
        case 3: return "x".repeat(rng.int(0, 100000));
        case 4: return Array.from({ length: 36 }, (_, k) => ([8, 13, 18, 23].includes(k) ? "-" : hex[rng.int(0, hex.length - 1)])).join("");
        default: return UUID.slice(0, rng.int(0, 36));
      }
    };
    const strict = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const t = gen(i);
      const r = parseIdentity(t);
      expect(r !== undefined).toBe(typeof t === "string" && strict.test(t));
      if (r) {
        accepted++;
        expect(r).toEqual({ kind: "anon", id: (t as string).toLowerCase(), assurance: "unverified" });
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

describe("identityKey", () => {
  it("is a stable 43-char base64url HMAC that depends on pepper, kind and id", () => {
    const k = identityKey(anon(), PEPPER);
    expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(identityKey(anon(), PEPPER)).toBe(k);
    expect(identityKey(anon(), PEPPER + "x")).not.toBe(k);
    expect(identityKey(anon(UUID.replace("3f", "3e")), PEPPER)).not.toBe(k);
    expect(identityKey({ kind: "steam", id: UUID, assurance: "verified" }, PEPPER)).not.toBe(k);
    expect(k).not.toContain(UUID);
  });

  it("2000 distinct ids give 2000 distinct keys", () => {
    const rng = new Rng(11);
    const keys = new Set<string>();
    for (let i = 0; i < 2000; i++) keys.add(identityKey(anon(`${rng.int(0, 0xffffff).toString(16).padStart(8, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`), PEPPER));
    expect(keys.size).toBe(2000);
  });

  it("refuses an empty pepper rather than hashing with nothing", () => {
    expect(() => identityKey(anon(), "")).toThrow();
  });
});

describe("resolveIdentity (the async front door)", () => {
  const steamId = "76561198000000042";
  const verifier = (out: PlayerIdentity | undefined | "throw"): IdentityVerifier => ({ verify: async () => (out === "throw" ? Promise.reject(new Error("ticket service down")) : out) });

  it("anon needs no verifier", async () => {
    expect(await resolveIdentity(UUID)).toEqual(anon());
    expect(await resolveIdentity(UUID, verifier(undefined))).toEqual(anon());
  });

  it("a steam token is accepted only through a verifier that vouches for it", async () => {
    const t = `steam:${steamId}`;
    expect(await resolveIdentity(t)).toBeUndefined();
    expect(await resolveIdentity(t, verifier({ kind: "steam", id: steamId, assurance: "verified" }))).toEqual({ kind: "steam", id: steamId, assurance: "verified" });
    expect(await resolveIdentity(t, verifier({ kind: "steam", id: steamId, assurance: "unverified" }))).toBeUndefined();
    expect(await resolveIdentity(t, verifier({ kind: "steam", id: "12", assurance: "verified" }))).toBeUndefined();
    expect(await resolveIdentity(t, verifier({ kind: "anon", id: UUID, assurance: "verified" }))).toBeUndefined();
    expect(await resolveIdentity(t, verifier(undefined))).toBeUndefined();
    expect(await resolveIdentity(t, verifier("throw"))).toBeUndefined();
  });

  it("junk never reaches the verifier", async () => {
    let calls = 0;
    const v: IdentityVerifier = { verify: async () => (calls++, undefined) };
    for (const t of [undefined, 5, {}, "", "hello", "steam", "x".repeat(10000), `STEAM:${steamId}`]) expect(await resolveIdentity(t, v)).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe("canResume", () => {
  it("is membership, nothing else", () => {
    const owner = identityKey(anon(), PEPPER);
    const rec = { ...createRecord({ code: "ABCDE", seed: 1, owner }) };
    expect(canResume(rec, owner)).toBe(true);
    expect(canResume(rec, identityKey(anon(UUID.replace("3f", "3e")), PEPPER))).toBe(false);
    expect(canResume(rec, "")).toBe(false);
    expect(canResume(rec, undefined as unknown as string)).toBe(false);
  });
});
