import { isValidJoinCode } from "@cb/shared";
import { MAX_MEMBERS, MAX_RECORD_BYTES, MAX_SECTIONS, type CampaignRecord, type SaveResult } from "./types.ts";

export const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** Identity keys are base64url HMACs (43 chars) but any short url-safe token is accepted. */
export const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const SECTION_RE = /^[a-z][a-z0-9_]{0,31}$/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;

/** Hostile-safe shape check that also COPIES: the result shares nothing with the input and has only known keys. Never throws. */
export function validateRecord(x: unknown): CampaignRecord | undefined {
  try {
    if (!isObj(x) || x.v !== 1) return undefined;
    const { id, code, seed, rev, savedAt, owner, members, sections, sectionVersions } = x;
    if (typeof id !== "string" || !ID_RE.test(id)) return undefined;
    if (!isValidJoinCode(code)) return undefined;
    if (!isInt(seed, 0, 0xffffffff)) return undefined;
    if (!isInt(rev, 0, 2_000_000_000)) return undefined;
    if (!isInt(savedAt, 0, Number.MAX_SAFE_INTEGER)) return undefined;
    if (typeof owner !== "string" || !KEY_RE.test(owner)) return undefined;
    if (!Array.isArray(members) || members.length > MAX_MEMBERS) return undefined;
    const seen = new Set<string>();
    for (const m of members) {
      if (typeof m !== "string" || !KEY_RE.test(m) || seen.has(m)) return undefined;
      seen.add(m);
    }
    if (!isObj(sections) || !isObj(sectionVersions)) return undefined;
    const keys = Object.keys(sections);
    if (keys.length > MAX_SECTIONS) return undefined;
    const outSections: Record<string, string> = {};
    const outVersions: Record<string, number> = {};
    for (const k of keys) {
      const s = sections[k];
      const sv = sectionVersions[k];
      if (!SECTION_RE.test(k) || typeof s !== "string" || !isInt(sv, 0, 65535)) return undefined;
      outSections[k] = s;
      outVersions[k] = sv;
    }
    if (Object.keys(sectionVersions).length !== keys.length) return undefined;
    return { v: 1, id, code, seed, rev, savedAt, owner, members: [...members] as string[], sections: outSections, sectionVersions: outVersions };
  } catch {
    return undefined;
  }
}

/** What every store checks before touching storage. */
export function precheck(rec: unknown): "invalid" | "too_large" | undefined {
  const ok = validateRecord(rec);
  if (!ok) return "invalid";
  return Buffer.byteLength(JSON.stringify(ok), "utf8") > MAX_RECORD_BYTES ? "too_large" : undefined;
}

/** The optimistic-concurrency rule, shared by every store: null = create, else must equal the stored rev. */
export function checkExpected(current: CampaignRecord | undefined, expectedRev: number | null): SaveResult | undefined {
  if (expectedRev === null) return current ? { ok: false, reason: "conflict", currentRev: current.rev } : undefined;
  if (!Number.isInteger(expectedRev) || expectedRev < 0) return { ok: false, reason: "invalid" };
  if (!current || current.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: current?.rev };
  return undefined;
}

/** The record as the store keeps it after a successful save. */
export function stamped(rec: CampaignRecord, expectedRev: number | null, savedAt: number): CampaignRecord {
  const copy = validateRecord(rec) as CampaignRecord;
  copy.rev = (expectedRev ?? 0) + 1;
  copy.savedAt = Math.max(0, Math.floor(savedAt));
  return copy;
}

/**
 * `deleteByIdentity` for one record: undefined = nobody is left (delete it); the same object back with `changed:false` = the key was
 * not a member. The owner is re-pointed at the first remaining member; rev moves on; `savedAt` is kept (dormancy is not reset).
 */
export function removeIdentity(rec: CampaignRecord, key: string): { rec: CampaignRecord | undefined; changed: boolean } {
  if (!rec.members.includes(key) && rec.owner !== key) return { rec, changed: false };
  const members = rec.members.filter((m) => m !== key);
  const first = members[0];
  if (first === undefined) return { rec: undefined, changed: true };
  return { rec: { ...rec, members, owner: rec.owner === key ? first : rec.owner, rev: rec.rev + 1 }, changed: true };
}

/** A brand-new, never-stored record (rev 0). `members` starts as the creator. */
export function createRecord(init: { id?: string; code: string; seed: number; owner: string; sections?: Record<string, string>; sectionVersions?: Record<string, number> }): CampaignRecord {
  return {
    v: 1,
    id: init.id ?? crypto.randomUUID(),
    code: init.code,
    seed: init.seed >>> 0,
    rev: 0,
    savedAt: 0,
    owner: init.owner,
    members: [init.owner],
    sections: { ...init.sections },
    sectionVersions: { ...init.sectionVersions },
  };
}

/** Adds an identity key to `members`; at the cap the oldest non-owner makes room. Returns a new record. */
export function withMember(rec: CampaignRecord, key: string): CampaignRecord {
  if (rec.members.includes(key)) return rec;
  const members = [...rec.members];
  if (members.length >= MAX_MEMBERS) {
    const i = members.findIndex((m) => m !== rec.owner);
    members.splice(i < 0 ? 0 : i, 1);
  }
  members.push(key);
  return { ...rec, members };
}
