/** Room names and JSON-ish message contracts shared by client and server. */
export const ROOM_WORLD = "world";

export interface JoinOptions {
  /** Display name, sanitised server-side. */
  name?: string;
  /** Campaign join code (empty/absent when creating). */
  code?: string;
  /** Opaque identity token from the PlatformIdentity adapter (browser: generated id). */
  token?: string;
  /** Desired world seed when creating a campaign. Server may clamp/replace. */
  seed?: number;
  /** Encoded character look (untrusted; the server validates, clamps and strips server-owned history). */
  look?: string;
  /** Campaign rule chosen when creating: allow dismemberment (default true). Ignored when joining. */
  dismemberment?: boolean;
}

/** Client -> server messages other than the input stream. */
export interface ClientMessages {
  ping: { t: number };
  setName: { name: string };
  /** Change appearance (HQ/creator). Rate limited; history fields are ignored. */
  setLook: { look: string };
}

/** Minimum gap between accepted setLook messages per client. */
export const SET_LOOK_MIN_INTERVAL_MS = 1500;

/** Server -> client messages. */
export interface ServerMessages {
  pong: { t: number; serverTime: number };
  notice: { text: string };
  /** A player took a hit. Cosmetic only (flinch, blood, ragdoll impulse); the authoritative result is in PlayerState. */
  hit: HitEvent;
  /** A limb was severed (cosmetic companion of the authoritative PlayerState.missing bit). */
  sever: SeverEvent;
}

/** Broadcast when a limb comes off. Direction and power drive the flying limb and the spray. */
export interface SeverEvent {
  /** Session id of the victim. */
  id: string;
  /** LIMB bit. */
  limb: number;
  dx: number;
  dz: number;
  power: number;
}

/** Broadcast when a player is harmed. `dx`/`dz` is the unit horizontal direction the blow pushes the victim. */
export interface HitEvent {
  /** Session id of the victim. */
  id: string;
  /** ZONE the blow landed in. */
  zone: number;
  dx: number;
  dz: number;
  /** 0..1: how hard the blow was (damage / 60, clamped); scales particles and ragdoll impulse. */
  power: number;
  /** This hit put the victim down. */
  down: boolean;
}

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 5;

export function isValidJoinCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length !== JOIN_CODE_LENGTH) return false;
  for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

function isUnsafeCodePoint(cp: number): boolean {
  return (
    cp < 0x20 || // C0 controls
    (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 controls
    (cp >= 0x200b && cp <= 0x200f) || // zero-width + directional marks
    (cp >= 0x2028 && cp <= 0x202e) || // line/paragraph separators + bidi embeds/overrides
    (cp >= 0x2060 && cp <= 0x206f) || // invisible formatting
    cp === 0xfeff // BOM / zero-width no-break space
  );
}

/** Player-visible custom text is untrusted: strip invisible/control characters, collapse spaces, cap length. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "Nameless Fool";
  let out = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isUnsafeCodePoint(cp)) continue;
    out += ch;
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 20).join("") || "Nameless Fool";
}
