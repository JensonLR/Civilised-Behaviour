import { PALETTE, Rng } from "@cb/shared";

/**
 * A horse is a flat record of small integers, like a character (spec.ts): trivially validated (clamp each field), packed into a short URL-safe string,
 * generated from ONE seed, and server-safe (no three.js here). `MountState.coat` replicates only the seed; every client turns it into the same animal with
 * `horseFromSeed`. The expedition's horses are small stout cobs with big heads and long, opinionated noses (the Society buys by the pound, not by the hand).
 * Colours are palette entries, never literals (`HORSE_COATS`, `HORSE_MANE`, `BLANKET_DYES`).
 */

/** The twelve coats, in wire order. Every colour is a PALETTE entry. */
export const HORSE_COAT_NAMES = ["Bay", "Dark Bay", "Chestnut", "Golden", "Flaxen", "Sorrel", "Grey", "Cream", "Raven", "Dun", "Seal Brown", "Mahogany"] as const;
export const HORSE_COATS: readonly number[] = [
  PALETTE.world.hide,
  PALETTE.world.hideDark,
  PALETTE.hair[2]!,
  PALETTE.hair[3]!,
  PALETTE.hair[4]!,
  PALETTE.hair[5]!,
  PALETTE.hair[6]!,
  PALETTE.hair[7]!,
  PALETTE.hair[8]!,
  PALETTE.world.sand,
  PALETTE.hair[1]!,
  PALETTE.hair[9]!,
];
/** Manes and tails: matches the coat (0), black, flaxen, white, dark brown, or the second coat colour (5). */
export const HORSE_MANE_NAMES = ["Coat", "Black", "Flaxen", "White", "Dark Brown", "Second Coat"] as const;
export const HORSE_MANE: readonly number[] = [-1, PALETTE.hair[0]!, PALETTE.hair[4]!, PALETTE.hair[7]!, PALETTE.hair[1]!, -2];
export const HORSE_PATTERN_NAMES = ["Plain", "Blaze", "Socks", "Dapple", "Piebald"] as const;
export const HORSE_MANE_STYLES = ["Roached", "Full", "Plaited", "Shaggy"] as const;
export const HORSE_TAIL_STYLES = ["Long", "Bobbed", "Plaited", "Scruffy"] as const;
export const HORSE_BRIDLES = ["Rope Halter", "Leather", "Brass Cheekpieces"] as const;
export const HORSE_SADDLES = ["Bare Back", "Riding Saddle", "Pack Saddle"] as const;
export const HORSE_BLANKETS = ["None", "Striped", "Checked", "Diamonds", "Chevrons", "Solid"] as const;
export const HORSE_PACKS = ["None", "Saddlebags", "Bedroll", "Panniers"] as const;
/** Blanket and harness dyes: the cloth palette. */
export const BLANKET_DYES: readonly number[] = PALETTE.cloth;

/** ORDER IS THE WIRE FORMAT. Append only. */
export const HORSE_FIELDS = [
  { key: "coat", max: 11 },
  { key: "coat2", max: 11 },
  { key: "pattern", max: 4 },
  { key: "mane", max: 3 },
  { key: "maneColor", max: 5 },
  { key: "tail", max: 3 },
  { key: "height", max: 255 },
  { key: "bulk", max: 255 },
  { key: "neck", max: 255 },
  { key: "head", max: 255 },
  { key: "roman", max: 3 },
  { key: "bridle", max: 2 },
  { key: "saddle", max: 2 },
  { key: "blanket", max: 5 },
  { key: "blanketColor", max: 11 },
  { key: "harness", max: 1 },
  { key: "packs", max: 3 },
] as const;
export type HorseFieldKey = (typeof HORSE_FIELDS)[number]["key"];
export type HorseSpec = { [K in HorseFieldKey]: number };

export const HORSE_SPEC_VERSION = 1;
export const HORSE_SPEC_BYTES = 1 + HORSE_FIELDS.length;

const clampInt = (v: unknown, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return n < 0 ? 0 : n > max ? max : n;
};

/** Forces any object into a valid spec: unknown keys dropped, missing/NaN -> 0, everything clamped. */
export function sanitizeHorse(input: unknown): HorseSpec {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out = {} as Record<string, number>;
  for (const f of HORSE_FIELDS) out[f.key] = clampInt(src[f.key], f.max);
  return out as HorseSpec;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Compact, URL/JSON-safe string form. Stable: the same spec always gives the same string. */
export function encodeHorse(spec: HorseSpec): string {
  const bytes = new Uint8Array(HORSE_SPEC_BYTES);
  bytes[0] = HORSE_SPEC_VERSION;
  HORSE_FIELDS.forEach((f, i) => (bytes[i + 1] = clampInt(spec[f.key], f.max)));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

/** Decodes untrusted input; undefined for anything malformed (wrong type, length, version, alphabet). Out-of-range values clamp. */
export function decodeHorse(s: unknown): HorseSpec | undefined {
  if (typeof s !== "string" || s.length > 64) return undefined;
  const vals: number[] = [];
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return undefined;
    vals.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const a = vals[i] as number;
    const b = vals[i + 1] ?? 0;
    const c = vals[i + 2];
    const d = vals[i + 3];
    bytes.push((a << 2) | (b >> 4));
    if (c !== undefined) bytes.push(((b & 15) << 4) | (c >> 2));
    if (d !== undefined && c !== undefined) bytes.push(((c & 3) << 6) | d);
  }
  if (bytes.length < HORSE_SPEC_BYTES || bytes[0] !== HORSE_SPEC_VERSION) return undefined;
  const out = {} as Record<string, number>;
  HORSE_FIELDS.forEach((f, i) => (out[f.key] = clampInt(bytes[i + 1], f.max)));
  return out as HorseSpec;
}

/**
 * The horse a seed makes: pure and deterministic (`MountState.coat` is the seed). Wagon horses wear harness and no saddle; the rest are saddled for riding. Plain
 * coats are the most common (the Society's stable buys what the sale has left), with the odd piebald as a scandal.
 */
export function horseFromSeed(seed: number, o: { harness?: boolean } = {}): HorseSpec {
  const rng = new Rng((seed >>> 0) ^ 0x4c0a1e5);
  rng.next();
  const pick = (weights: readonly number[]): number => {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };
  const coat = rng.int(0, 11);
  const harness = o.harness ?? false;
  return {
    coat,
    coat2: (coat + rng.int(3, 8)) % 12,
    pattern: pick([5, 2, 2, 1.5, 1]),
    mane: pick([1, 3, 2, 2]),
    maneColor: pick([4, 2, 1, 1, 1.5, 1]),
    tail: pick([4, 1, 1.5, 1.5]),
    height: rng.int(60, 200),
    bulk: rng.int(60, 220),
    neck: rng.int(40, 220),
    head: rng.int(70, 230),
    roman: pick([2, 3, 2, 1]),
    bridle: harness ? 1 : pick([1, 4, 1.5]),
    saddle: harness ? 0 : pick([0.5, 5, 1]),
    blanket: harness ? 0 : pick([2, 2, 1, 1, 1, 1]),
    blanketColor: rng.int(0, 11),
    harness: harness ? 1 : 0,
    packs: harness ? 0 : pick([5, 1, 1, 1]),
  };
}

/**
 * Where the rider sits and what the rider holds, in the horse's frame (-Z forward, +X right, origin on the ground under the barrel). Shared by the horse builder and the
 * ride pose. `y` is the rider's PELVIS height (MOUNT.seatHeight in shared/mount.ts: a test pins the two together).
 */
export const HORSE_SEAT = {
  y: 0.95,
  z: 0.0,
  /** Where a stirrup's tread hangs (right side; the left mirrors in x). */
  stirrup: { x: 0.4, y: 0.46, z: -0.02 },
  /** Where each hand holds the reins (right; the left mirrors). */
  hand: { x: 0.1, y: 1.16, z: -0.42 },
  /** The collar/hitch point of a harnessed horse, where the traces end (behind the croup; WAGON.hitchBack in shared/mount.ts). */
  trace: { x: 0.28, y: 0.6, z: 1.38 },
} as const;
