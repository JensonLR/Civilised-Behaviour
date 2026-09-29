/**
 * THE colour palette: the single source of truth for every colour in the game - characters, terrain, props, effects, lighting
 * and UI. Nothing else should contain a colour literal that means "a colour in the world" (the art-direction tests enforce the
 * rules below; docs/ART_DIRECTION.md explains the intent).
 *
 * Direction: a late-Victorian illustrated adventure. Warm, slightly dusty, storybook colour; deep warm plum-brown shadows
 * (never black); one ink colour for every outline; muted dyes for cloth so a crowd of twelve outfits still reads as one world;
 * gore is a *style* applied to the same dressings, never the only carrier of meaning.
 *
 * Values are sRGB hex numbers (0xRRGGBB), exactly what three.js `Color.setHex` and CSS `#rrggbb` expect.
 */
export const PALETTE = {
  /** The darkest colour that exists. Outlines, pupils, deepest shadow accents. Nothing else may be darker. */
  ink: 0x1b130d,

  /** Scene lighting. The "bounce" is a plum-brown so shadows are warm and coloured, not grey. */
  light: { sun: 0xffe0b8, sky: 0xc4d6f0, bounce: 0x6a5560 },

  sky: { top: 0x3b66a4, mid: 0xa2bcd6, horizon: 0xecd3ae },

  world: {
    grass: 0x66823a,
    dry: 0xa39853,
    rock: 0x7d7468,
    boulder: 0x8a8478,
    trunk: 0x5b4630,
    crown: 0x45702f,
    ruin: 0xa68a5b,
    // terrain painting: hollows, sunlit rises, meadow patches, worn earth
    grassDeep: 0x4a6a30,
    meadow: 0x8a9a45,
    dirt: 0x93744b,
    dirtDark: 0x6e5438,
    moss: 0x5c7038,
    // rocks: dark mossy foot, pale weathered top
    rockDark: 0x5a5249,
    rockPale: 0xb2aa98,
    pebble: 0x9a9284,
    // trees
    crownLight: 0x7a9a3c,
    crownDeep: 0x2f5a2c,
    acacia: 0x8a9a3a,
    acaciaLight: 0xa8a94a,
    barkLight: 0x8a6c4a,
    snag: 0xa89a80,
    // ground flowers
    bloomRed: 0xa65c48,
    bloomYellow: 0xd0bc78,
    bloomBlue: 0x7f8fbd,
    bloomWhite: 0xe6dfc8,
    // the far country: three hill rings, near to far (blended toward the fog before they are drawn)
    hillNear: 0x5d7a55,
    hillMid: 0x7c948a,
    hillFar: 0x9fb0b4,
    // painterly sky
    skyCloud: 0xf3ead8,
    skyCloudShade: 0xb9b7c4,
    skyGlow: 0xf2cc92,
    sunDisc: 0xfff0c8,
    sunRing: 0xf6d79a,
  },

  props: {
    crate: 0x9a7a4a,
    barrel: 0x6a4a2a,
    bottle: 0x3d7a4d,
    chair: 0x7a3f2a,
    crateDark: 0x7a5c34,
    crateBand: 0x6a5a48,
    barrelDark: 0x54381e,
    bottleDark: 0x2d5a3a,
    bottleGlint: 0x7fb58a,
    cork: 0xb59060,
    chairDark: 0x6a3626,
    chairCane: 0xb08a5a,
  },

  /** The expedition camp at the spawn: canvas, rope, the Society's pennant, a fire, luggage and a cart. Flame colours are light sources. */
  camp: {
    canvas: 0xd8caa4,
    canvasShade: 0xb9a982,
    canvasTrim: 0x8f3a2c,
    tentDoor: 0x4a3a30,
    pole: 0x8a6a45,
    rope: 0xb59f74,
    flagCloth: 0x7f2a26,
    flagMark: 0xe8dcc0,
    signWood: 0x6a4a2c,
    signPaint: 0xe6d9b4,
    fireStone: 0x77706a,
    ash: 0x6e655c,
    log: 0x54402c,
    charred: 0x4a3a2e,
    leather: 0x6b4a30,
    trunkGreen: 0x3f5a4a,
    brass: 0xa88a4c,
    strap: 0x5a4030,
    hatbox: 0xa8705a,
    cartWood: 0x8a6538,
    cartRed: 0x8a3a2c,
    cartCanvas: 0xcfc19a,
    iron: 0x4c4c50,
    sack: 0xb59a6a,
    flameOuter: 0xd9782f,
    flameMid: 0xeaa23c,
    flameCore: 0xf6d685,
    ember: 0xb8502c,
    glow: 0xf0a04a,
  },

  /** Everyday materials shared by clothing, props and hats. */
  material: { wood: 0x7a5230, leather: 0x5a3a24, cream: 0xe8dcc0, soot: 0x241c16, iron: 0x5c5e62, bandage: 0xe6dbbd, bandageDirty: 0xc9bb96 },

  /** Clothing trim and accessories: hat bands, plumes, sashes, medal ribbons, spectacle frames. */
  trim: {
    hatBand: 0x2a2a30,
    hatBandBrown: 0x2a1c14,
    straw: 0xd9c48a,
    plume: 0xb43a3a,
    plumeQuill: 0x8a2a2a,
    ivory: 0xd9d0b8,
    frame: 0x2a2018,
    goggleGlass: 0x4a3a2a,
    shirtStripe: 0x8a6a5a,
    cummerbund: 0x7a1f2a,
    sashRed: 0x8f1f2a,
    sashGold: 0xb8a06a,
    ribbonBlue: 0x2a4f8a,
    ribbonRed: 0x9a3030,
    hobnail: 0x8a8a8a,
    teeth: 0xeee6cc,
    blushHot: 0xc4574a,
  },

  /** Metalwork colours (the spec's "accent" field). */
  metal: [0xd0a94a, 0xc0c0c8, 0xb8732f, 0xd9d0b8],

  /** Skin: eight tones, light to deep, one warm hue family. Blush, shadow and lips are derived from these, never picked. */
  skin: [0xf3cfb3, 0xe8b998, 0xd29c76, 0xb07a55, 0x8f5d40, 0x6d4531, 0xecc0a6, 0xdcae8c],

  hair: [0x1c1410, 0x3b2616, 0x6a4423, 0x9a6a2f, 0xc79a4a, 0xa64a24, 0x8a8a8a, 0xe6e2d6, 0x2a2a3a, 0x7a2a1a],

  /** Cloth dyes: muted Victorian. Twelve distinguishable hues, none garish. */
  cloth: [0x8f2d22, 0x2f4f7f, 0x3f6a3a, 0x8a6a1f, 0x5a3a5a, 0x3d3d46, 0x7a7466, 0xb8a06a, 0x5c5c3a, 0x6a2a2a, 0x3a6a68, 0xa8552f],

  iris: [0x4f7a9a, 0x5f8a4a, 0x7a5030, 0x8a6a30, 0x3a4a6a],

  /** Face-part constants. */
  face: { white: 0xf4efe2, pupil: 0x15100c, mouth: 0x5a1f1a, cavity: 0x2a0c0c, tongue: 0xc4646a, scar: 0x9a4a4a, nostril: 0x2a1418 },

  /** Wound stains per gore setting. `off` deliberately contains no red at all (iodine and grime). */
  gore: {
    full: { fresh: 0xa3161a, old: 0x6e0f12, drip: 0x8a1216 },
    reduced: { fresh: 0x7d4136, old: 0x5c302a, drip: 0x6b352d },
    off: { fresh: 0xc08a2c, old: 0x9c8a66, drip: 0xb08028 },
  },

  /** Particle colours for hit effects per gore setting (dust and sparks when gore is off). */
  hitFx: {
    full: [0xa3161a, 0x8a1216, 0xb81d20],
    reduced: [0x7d4136, 0x6b352d],
    off: [0xf3e6b8, 0xd9c98a, 0xffffff],
    stain: 0x6e0f12,
  },

  /** Interface colours (also published as CSS custom properties). */
  ui: {
    ink: 0x2a2118,
    paper: 0xefe3c8,
    paper2: 0xe2d2ac,
    field: 0xfbf5e4,
    track: 0xd9caa3,
    brass: 0xb8863b,
    brassDark: 0x7d5a22,
    stamp: 0x8f2d22,
    stampDark: 0x5b1a12,
    text: 0xfbf0dc,
    backdrop: 0x1b1610,
    scrim: 0x140e08,
  },
} as const;

// ---- colour maths (also used by the art-direction tests) ------------------------------------------------------------------------

export const cssHex = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;

/** [h (degrees 0..360), s (0..1), l (0..1)] of an sRGB hex. */
export function hsl(n: number): [number, number, number] {
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Colourfulness independent of lightness: (max - min) / 255. HSL saturation exaggerates pale colours, this does not. */
export function chroma(n: number): number {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** WCAG relative luminance of an sRGB hex. */
export function luminance(n: number): number {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}

/** WCAG contrast ratio (1..21) between two sRGB hexes. */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The interface colours as CSS custom properties (`--ink`, `--paper`, ...). */
export function paletteCssVars(): Record<string, string> {
  const u = PALETTE.ui;
  return {
    "--ink": cssHex(u.ink),
    "--paper": cssHex(u.paper),
    "--paper-2": cssHex(u.paper2),
    "--field": cssHex(u.field),
    "--track": cssHex(u.track),
    "--brass": cssHex(u.brass),
    "--brass-dark": cssHex(u.brassDark),
    "--stamp": cssHex(u.stamp),
    "--stamp-dark": cssHex(u.stampDark),
    "--text": cssHex(u.text),
    "--backdrop": cssHex(u.backdrop),
    "--scrim": cssHex(u.scrim),
  };
}
