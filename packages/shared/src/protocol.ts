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
}

/** Client -> server messages other than the input stream. */
export interface ClientMessages {
  ping: { t: number };
  setName: { name: string };
}

/** Server -> client messages. */
export interface ServerMessages {
  pong: { t: number; serverTime: number };
  notice: { text: string };
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
