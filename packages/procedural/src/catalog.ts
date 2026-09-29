import { PALETTE } from "@cb/shared";
/**
 * Option catalogs for the caricature character system. Order is part of the wire format: append new
 * options at the END of a list only (existing saved characters store indices). Names are UI strings.
 */
export const NOSE_STYLES = ["Button", "Hooked", "Bulb", "Long", "Flat", "Ruddy Lump"] as const;
export const HAIR_STYLES = ["Bald", "Side Part", "Wild Tufts", "Curls", "Slicked", "Receding", "Top Knot", "Bowl Cut", "Long Lank", "Pompadour"] as const;
export const MOUSTACHES = ["None", "Handlebar", "Walrus", "Pencil", "Toothbrush", "Imperial", "Horseshoe", "Magnificent Fringe", "Waxed Tips", "Soup Strainer"] as const;
export const BEARDS = ["None", "Full", "Chin Puff", "Goatee", "Mutton Beard", "Spade", "Wizard", "Neck Fringe"] as const;
export const SIDEBURNS = ["None", "Short", "Mutton Chops", "Flourishing"] as const;
export const HATS = ["None", "Top Hat", "Bowler", "Pith Helmet", "Shako", "Bicorne", "Slouch Hat", "Peaked Cap", "Flat Cap", "Plumed Helmet", "Boater"] as const;
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
export const SKIN_TONES = PALETTE.skin;
export const HAIR_COLORS = PALETTE.hair;
/** Cloth palette: muted Victorian dyes. */
export const CLOTH_COLORS = PALETTE.cloth;
export const ACCENT_COLORS = PALETTE.metal;

export const SCAR_BITS = { CHEEK: 1, BROW: 2, CHIN: 4, NECK: 8, FOREHEAD: 16 } as const;
export const TEETH_BITS = { MISSING_FRONT: 1, GOLD_FRONT: 2, MISSING_SIDE: 4, GOLD_SIDE: 8 } as const;
