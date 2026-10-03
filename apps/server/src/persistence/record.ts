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
  const member = rec.members.includes(key) || rec.owner === key;
  const scrub = forgetInSections(rec.sections, key);
  if (!member && !scrub.changed) return { rec, changed: false };
  const members = rec.members.filter((m) => m !== key);
  const first = members[0];
  if (first === undefined) return { rec: undefined, changed: true };
  return { rec: { ...rec, members, owner: rec.owner === key ? first : rec.owner, sections: scrub.sections, rev: rec.rev + 1 }, changed: true };
}

/**
 * Erasure reaches the sections too (D-055: the honours section is keyed by member keys, and a module added later may hold keys as well): in every section that mentions
 * the key, each JSON object property NAMED by it and each array entry EQUAL to it is dropped; a section that mentions it and is not JSON is dropped whole (it comes back
 * fresh on the next load). Sections that never mention the key are returned as they were. Pure.
 */
export function forgetInSections(sections: Readonly<Record<string, string>>, key: string): { sections: Record<string, string>; changed: boolean } {
  const out: Record<string, string> = {};
  let changed = false;
  for (const [name, json] of Object.entries(sections)) {
    if (!key || !json.includes(key)) {
      out[name] = json;
      continue;
    }
    changed = true;
    try {
      out[name] = JSON.stringify(scrubKey(JSON.parse(json), key));
    } catch {
      // not JSON: dropped whole
    }
  }
  return { sections: out, changed };
}

function scrubKey(v: unknown, key: string): unknown {
  if (Array.isArray(v)) return v.filter((x) => x !== key).map((x) => scrubKey(x, key));
  if (typeof v === "string" && v.includes(key)) return v.split(key).join("");
  if (typeof v !== "object" || v === null) return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (k !== key) o[k] = scrubKey(x, key);
  return o;
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

/**
 * Adds an identity key to `members`. A full book evicts nobody: the joiner plays while the room is live but is not remembered (the persistence review's finding (b): evicting
 * the oldest let anyone holding a live join code rejoin under fresh device ids and push the real members out, who could then never resume). A member leaves the book only
 * by asking (`removeIdentity`, the privacy deletion). Returns the same record when nothing changes.
 */
export function withMember(rec: CampaignRecord, key: string): CampaignRecord {
  if (rec.members.includes(key) || rec.members.length >= MAX_MEMBERS) return rec;
  return { ...rec, members: [...rec.members, key] };
}
