import { MAX_RECORD_BYTES, type CampaignRecord } from "./types.ts";
import { validateRecord } from "./record.ts";

/** On-disk envelope: `{ format: "cb-save", version, crc32, record }`. crc32 covers `JSON.stringify(record)` as written. */
export const SAVE_FORMAT = "cb-save";
export const SAVE_VERSION = 1;
/** An envelope bigger than this is garbage whatever it says (a record is capped at MAX_RECORD_BYTES). */
const MAX_ENVELOPE_CHARS = MAX_RECORD_BYTES * 4;

let table: Uint32Array | undefined;

/** CRC-32 (IEEE) over the UTF-8 bytes of `text`. */
export function crc32(text: string): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  const bytes = Buffer.from(text, "utf8");
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeEnvelope(record: CampaignRecord): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, crc32: crc32(JSON.stringify(record)), record });
}

/**
 * Version chain: `MIGRATIONS[n]` upgrades a record written at version n to n + 1 (pure, defensive: the input is hostile until validated).
 * v0 (the first prototype layout) named the creator `ownerKey`, the members `memberKeys`, had no `v` and no `sectionVersions`.
 */
const MIGRATIONS: Record<number, (record: unknown) => unknown> = {
  0: (r) => {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const sections = typeof o.sections === "object" && o.sections !== null ? (o.sections as Record<string, unknown>) : {};
    const sectionVersions: Record<string, number> = {};
    for (const k of Object.keys(sections)) sectionVersions[k] = 1;
    return { v: 1, id: o.id, code: o.code, seed: o.seed, rev: o.rev, savedAt: o.savedAt, owner: o.ownerKey, members: o.memberKeys, sections, sectionVersions };
  },
};

export function migrate(record: unknown, from: number): unknown {
  let r = record;
  for (let v = from; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return undefined;
    r = step(r);
  }
  return r;
}

export type Decoded =
  | { kind: "ok"; record: CampaignRecord; migratedFrom?: number }
  | { kind: "corrupt"; reason: string }
  | { kind: "too_new"; version: number };

/** Parses a save file. Never throws: anything wrong is `corrupt`, anything newer than this build is `too_new` (and must never be overwritten). */
export function decodeEnvelope(text: string): Decoded {
  try {
    if (text.length === 0) return { kind: "corrupt", reason: "empty" };
    if (text.length > MAX_ENVELOPE_CHARS) return { kind: "corrupt", reason: "oversized" };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { kind: "corrupt", reason: "bad json" };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "corrupt", reason: "not an envelope" };
    const e = raw as Record<string, unknown>;
    if (e.format !== SAVE_FORMAT) return { kind: "corrupt", reason: "wrong format" };
    const version = e.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return { kind: "corrupt", reason: "bad version" };
    if (version > SAVE_VERSION) return { kind: "too_new", version };
    if (typeof e.crc32 !== "number" || e.crc32 !== crc32(JSON.stringify(e.record))) return { kind: "corrupt", reason: "crc mismatch" };
    const migrated = version === SAVE_VERSION ? e.record : migrate(e.record, version);
    const record = validateRecord(migrated);
    if (!record) return { kind: "corrupt", reason: "bad record" };
    return version === SAVE_VERSION ? { kind: "ok", record } : { kind: "ok", record, migratedFrom: version };
  } catch {
    return { kind: "corrupt", reason: "unreadable" };
  }
}
