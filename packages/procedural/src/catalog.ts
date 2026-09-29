/**
 * Option catalogs for the caricature character system. Order is part of the wire format: append new
 * options at the END of a list only (existing saved characters store indices). Names are UI strings.
 */
export const NOSE_STYLES = ["Button", "Hooked", "Bulb", "Long", "Flat", "Ruddy Lump"] as const;
export const HAIR_STYLES = ["Bald", "Side Part", "Wild Tufts", "Curls", "Slicked", "Receding", "Top Knot"] as const;
export const MOUSTACHES = ["None", "Handlebar", "Walrus", "Pencil", "Toothbrush", "Imperial", "Horseshoe", "Magnificent Fringe"] as const;
export const BEARDS = ["None", "Full", "Chin Puff", "Goatee", "Mutton Beard", "Spade"] as const;
export const SIDEBURNS = ["None", "Short", "Mutton Chops", "Flourishing"] as const;
export const HATS = ["None", "Top Hat", "Bowler", "Pith Helmet", "Shako", "Bicorne", "Slouch Hat", "Peaked Cap"] as const;
export const JACKETS = ["Shirt Sleeves", "Frock Coat", "Tunic", "Waistcoat", "Greatcoat", "Hunting Jacket"] as const;
export const SHIRTS = ["Plain", "Striped", "Checked", "Collarless"] as const;
export const TROUSERS = ["Plain", "Striped", "Breeches", "Baggy"] as const;
export const BOOTS = ["Tall Riding", "Ankle", "Spats", "Hobnailed"] as const;
export const BELTS = ["None", "Leather", "Cummerbund"] as const;
export const EYEWEAR = ["None", "Monocle", "Spectacles", "Goggles", "Pince-nez"] as const;
export const SASHES = ["None", "Diagonal", "Waist"] as const;
export const WOODEN_LEG = ["None", "Left", "Right"] as const;
export const EYEPATCH = ["None", "Left", "Right"] as const;

/** Skin tones (sRGB hex). Deliberately varied; these are caricature bodies, not ethnic types. */
export const SKIN_TONES = [0xf2c7a5, 0xe0a67e, 0xc98a5e, 0xa66a43, 0x7d4b2e, 0x5a3520, 0xe8b59a, 0xd39a76] as const;
export const HAIR_COLORS = [0x1c1410, 0x3b2616, 0x6a4423, 0x9a6a2f, 0xc79a4a, 0xa64a24, 0x8a8a8a, 0xe6e2d6, 0x2a2a3a, 0x7a2a1a] as const;
/** Cloth palette: muted Victorian dyes. */
export const CLOTH_COLORS = [
  0x8f2d22, 0x2f4f7f, 0x3f6a3a, 0x8a6a1f, 0x5a3a5a, 0x2b2b30, 0x7a7466, 0xb8a06a, 0x4a5a3a, 0x6a2a2a, 0x3a5a6a, 0xa8552f,
] as const;
export const ACCENT_COLORS = [0xd4a93a, 0xc0c0c8, 0xb8732f, 0xd9d0b8] as const;

export const SCAR_BITS = { CHEEK: 1, BROW: 2, CHIN: 4, NECK: 8, FOREHEAD: 16 } as const;
export const TEETH_BITS = { MISSING_FRONT: 1, GOLD_FRONT: 2, MISSING_SIDE: 4, GOLD_SIDE: 8 } as const;
