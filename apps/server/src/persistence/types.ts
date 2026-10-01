/**
 * Persistence contract (docs/_notes/campaign.md section 4). The store keeps OPAQUE per-module JSON sections; it never
 * interprets them. Identity is an HMAC key, never a raw id.
 */
export interface CampaignRecord {
  v: 1;
  /** Server uuid, immutable. Also the file name, so it is validated against ID_RE everywhere. */
  id: string;
  /** The five-character join code (JOIN_CODE_ALPHABET). Unique across the store. */
  code: string;
  /** World seed (uint32). */
  seed: number;
  /** Optimistic-concurrency revision: 0 = never stored, otherwise assigned by the store (previous rev + 1). */
  rev: number;
  /** Store clock (ms) of the last save. Drives `idleDays`. Assigned by the store. */
  savedAt: number;
  /** Identity KEY (HMAC) of the creator. */
  owner: string;
  /** Identity KEYS of everyone who ever joined (<= MAX_MEMBERS). */
  members: string[];
  /** Opaque JSON text per module ("campaign", "party", "powers", "settlements"; "players" is reserved and unused). */
  sections: Record<string, string>;
  sectionVersions: Record<string, number>;
}

export type SaveResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "conflict" | "too_large" | "invalid" | "too_new" | "io"; currentRev?: number };

export interface CampaignStore {
  load(id: string): Promise<CampaignRecord | undefined>;
  findByCode(code: string): Promise<CampaignRecord | undefined>;
  /** `expectedRev`: null = create (must not exist), otherwise the rev the caller last saw. The store assigns rev + savedAt. */
  save(rec: CampaignRecord, expectedRev: number | null): Promise<SaveResult>;
  /** Campaigns the identity key is a member of, newest first. */
  list(identityKey: string): Promise<{ id: string; code: string; savedAt: number }[]>;
  delete(id: string): Promise<boolean>;
  /**
   * Erase one identity: its key leaves every `members` list (a campaign left with nobody is deleted, an owner is re-pointed at the
   * first remaining member); backups of the old record go with it. Returns the number of campaigns touched. `savedAt` is NOT reset.
   */
  deleteByIdentity(identityKey: string): Promise<number>;
  /** Deletes campaigns whose last save is more than `olderThanMs` ago (by the store clock). Returns how many. */
  purgeDormant(olderThanMs: number): Promise<number>;
  close(): Promise<void>;
}

export interface PlayerIdentity {
  kind: "anon" | "steam";
  id: string;
  assurance: "unverified" | "verified";
}

/** The Steam ticket check plugs in here later; anonymous device ids need no verifier. */
export interface IdentityVerifier {
  verify(token: unknown): Promise<PlayerIdentity | undefined>;
}

export interface SectionCodec<T> {
  key: string;
  version: number;
  fresh(seed: number): T;
  parse(json: string): T | undefined;
  serialize(v: T): string;
}

export interface Logger {
  debug?(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_MEMBERS = 8;
export const MAX_SECTIONS = 16;
export const DAY_MS = 24 * 60 * 60 * 1000;
