import { DAYS_IDLE_CAP } from "@cb/shared";
import { DAY_MS, type CampaignRecord, type SectionCodec } from "./types.ts";

/** Codecs of different modules are held in one list, so their value types are erased here (each codec still types its own). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCodec = SectionCodec<any>;

export interface Snapshot {
  sections: Record<string, string>;
  sectionVersions: Record<string, number>;
}

/** Serialises each module's live value through its codec. `live` is keyed by codec key; a missing value is simply not written. */
export function snapshot(codecs: readonly AnyCodec[], live: Record<string, unknown>): Snapshot {
  const sections: Record<string, string> = {};
  const sectionVersions: Record<string, number> = {};
  for (const c of codecs) {
    if (!(c.key in live)) continue;
    sections[c.key] = c.serialize(live[c.key]);
    sectionVersions[c.key] = c.version;
  }
  return { sections, sectionVersions };
}

export interface Restored {
  values: Record<string, unknown>;
  /** Sections that were present but failed to parse (or came from a newer module version): replaced by `fresh(seed)`. */
  repaired: string[];
  /** Sections the record has no entry for (a module added since the save): `fresh(seed)`. */
  added: string[];
  /** Section keys with no codec in this build, left alone: the saver writes them back verbatim. */
  unknown: string[];
  /**
   * The subset of `repaired` that was written by a NEWER module version (a downgrade, e.g. a Steam beta branch and back). The room plays on `fresh(seed)` for them but must NOT
   * save them (`snapshot` skips a key whose live value is absent), or the next save would overwrite the newer data with a fresh section.
   */
  newer: string[];
}

/**
 * Rebuilds every module's value from a record. One bad section never loses the campaign: it is replaced by `fresh(seed)` and reported.
 * A codec that throws counts as a failed parse.
 */
export function restore(codecs: readonly AnyCodec[], rec: Pick<CampaignRecord, "seed" | "sections" | "sectionVersions">): Restored {
  const values: Record<string, unknown> = {};
  const repaired: string[] = [];
  const added: string[] = [];
  const newer: string[] = [];
  const known = new Set<string>();
  for (const c of codecs) {
    known.add(c.key);
    const json = Object.hasOwn(rec.sections, c.key) ? rec.sections[c.key] : undefined;
    if (json === undefined) {
      values[c.key] = c.fresh(rec.seed);
      added.push(c.key);
      continue;
    }
    const writtenBy = rec.sectionVersions[c.key] ?? 0;
    let v: unknown;
    if (writtenBy > c.version) newer.push(c.key);
    try {
      v = writtenBy > c.version ? undefined : c.parse(json);
    } catch {
      v = undefined;
    }
    if (v === undefined) {
      values[c.key] = c.fresh(rec.seed);
      repaired.push(c.key);
    } else values[c.key] = v;
  }
  return { values, repaired, added, unknown: Object.keys(rec.sections).filter((k) => !known.has(k)), newer };
}

/** Whole 24 h periods since the last save, capped (the game must not punish a night's sleep, let alone a holiday). Garbage in = 0. */
export function idleDays(savedAtMs: number, nowMs: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(savedAtMs) || !Number.isFinite(nowMs) || nowMs <= savedAtMs) return 0;
  const d = Math.floor((nowMs - savedAtMs) / DAY_MS);
  return Math.min(DAYS_IDLE_CAP, d) as 0 | 1 | 2 | 3;
}
