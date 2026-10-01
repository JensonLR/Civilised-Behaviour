import { createHmac } from "node:crypto";
import type { CampaignRecord, IdentityVerifier, PlayerIdentity } from "./types.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEAM_ID = /^[0-9]{17}$/;

/**
 * Anonymous device identities only: a UUID v4 (what the client's `cb.identity` is), normalised to lower case. Anything else - including
 * `steam:<17 digits>`, which is a CLAIM until a verifier has checked a ticket - is undefined here. Never throws.
 */
export function parseIdentity(token: unknown): PlayerIdentity | undefined {
  if (typeof token !== "string" || token.length !== 36 || !UUID_V4.test(token)) return undefined;
  return { kind: "anon", id: token.toLowerCase(), assurance: "unverified" };
}

/** The async front door: anon tokens parse locally; a `steam:` token is accepted only if the injected verifier vouches for it. */
export async function resolveIdentity(token: unknown, verifier?: IdentityVerifier): Promise<PlayerIdentity | undefined> {
  const anon = parseIdentity(token);
  if (anon) return anon;
  if (!verifier || typeof token !== "string" || token.length > 4096 || !token.startsWith("steam:")) return undefined;
  try {
    const v = await verifier.verify(token);
    if (!v || v.kind !== "steam" || v.assurance !== "verified" || typeof v.id !== "string" || !STEAM_ID.test(v.id)) return undefined;
    return { kind: "steam", id: v.id, assurance: "verified" };
  } catch {
    return undefined;
  }
}

/**
 * The only form in which an identity is ever stored or logged: HMAC-SHA256(pepper, kind + ":" + id), base64url (43 chars).
 * Stable for a given pepper; useless without it. Rotating the pepper orphans every membership, so treat it like a database password.
 */
export function identityKey(id: PlayerIdentity, pepper: string): string {
  if (typeof pepper !== "string" || pepper.length === 0) throw new Error("identityKey needs a non-empty pepper");
  return createHmac("sha256", pepper).update(`${id.kind}:${id.id}`).digest("base64url");
}

/** An unverified identity authorises nothing beyond what the join code already does: resuming needs the code AND having been a member. */
export function canResume(rec: CampaignRecord, key: string): boolean {
  return typeof key === "string" && rec.members.includes(key);
}
