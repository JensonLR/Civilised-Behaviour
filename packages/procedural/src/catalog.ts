import { PALETTE } from "@cb/shared";
/**
 * Option catalogs for the caricature character system. Order is part of the wire format: append new
 * options at the END of a list only (existing saved characters store indices). Names are UI strings.
 */
export const NOSE_STYLES = ["Button", "Hooked", "Bulb", "Long", "Flat", "Ruddy Lump", "Snub", "Roman"] as const;
export const HAIR_STYLES = ["Bald", "Side Part", "Wild Tufts", "Curls", "Slicked", "Receding", "Top Knot", "Bowl Cut", "Long Lank", "Pompadour", "Ponytail", "Plait", "Monk Fringe", "Comb-Over", "Thin Wisps", "Shaggy Mane", "Mop Top", "Draped Fall", "Braid Crown", "Salt Locks", "Wrapped Plait", "Shoulder Curtain", "Tied Tail"] as const;
export const MOUSTACHES = ["None", "Handlebar", "Walrus", "Pencil", "Toothbrush", "Imperial", "Horseshoe", "Magnificent Fringe", "Waxed Tips", "Soup Strainer", "Chevron", "Lampshade", "Cavalry", "Wisp"] as const;
export const BEARDS = ["None", "Full", "Chin Puff", "Goatee", "Mutton Beard", "Spade", "Wizard", "Neck Fringe", "Van Dyke", "Forked", "Bib", "Soul Patch", "Sea Captain"] as const;
export const SIDEBURNS = ["None", "Short", "Mutton Chops", "Flourishing", "Bushy Wings", "Piccadilly Weepers", "Sculpted Points"] as const;
export const HATS = ["None", "Top Hat", "Bowler", "Pith Helmet", "Shako", "Bicorne", "Slouch Hat", "Peaked Cap", "Flat Cap", "Plumed Helmet", "Boater", "Fez", "Veiled Pith", "Tricorn", "Kepi", "Deerstalker", "Topee", "Nightcap", "Busby", "Sou'wester", "Wide-Awake", "Reed Brim", "Lamp Hood", "Sheaf Hat", "Tide Hat", "Dust Wrap", "Tiered Hat", "Bell Crown", "Net Cap"] as const;
export const JACKETS = ["Shirt Sleeves", "Frock Coat", "Tunic", "Waistcoat", "Greatcoat", "Hunting Jacket", "Cape", "Poncho", "Smoking Jacket", "Naval Reefer", "Norfolk Jacket", "Stone Smock", "Lamp Robe", "Herd Cloak", "Crepe Shawl", "Wading Smock", "Court Cloak"] as const;
export const SHIRTS = ["Plain", "Striped", "Checked", "Collarless", "Wing Collar", "Ruffled Jabot", "Work Shirt"] as const;
export const TROUSERS = ["Plain", "Striped", "Breeches", "Baggy", "Plus-Fours", "Jodhpurs", "Tropical Shorts", "Wrap Skirt"] as const;
export const BOOTS = ["Tall Riding", "Ankle", "Spats", "Hobnailed", "Puttees", "Wellingtons", "Slippers", "Spurred", "Clogs", "Reed Sandals", "Mud Pattens"] as const;
export const BELTS = ["None", "Leather", "Cummerbund", "Rope", "Ammunition Belt", "Cross Belts", "Bandolier"] as const;
export const EYEWEAR = ["None", "Monocle", "Spectacles", "Goggles", "Pince-nez", "Smoked Glasses", "Snow Goggles", "Jeweller's Loupe", "Half-Moons", "Left Monocle", "Pushed-Up Goggles", "Owl Specs", "Corded Pince-nez", "Green Visor"] as const;
export const SASHES = ["None", "Diagonal", "Waist", "Cross Sashes", "Tasselled Waist", "Order Ribbon"] as const;
export const NECKWEAR = ["None", "Cravat", "Bow Tie", "Scarf", "Ascot", "Neckerchief", "Ruff", "Fur Collar", "Muffler", "Bead Strings", "Bell Collar", "Float Cord", "Lamp Chain", "Memorial Beads"] as const;
export const PACKS = ["None", "Rucksack", "Bedroll", "Satchel", "Specimen Case", "Tin Trunk", "Rifle", "Easel", "Birdcage", "Umbrella"] as const;
export const HIP_GEAR = ["None", "Canteen", "Holster", "Watch Chain", "Field Glasses", "Sabre", "Machete", "Coiled Rope", "Pocket Watch", "Cartridge Pouches", "Small Lamp", "Herd Bell", "Tally Cord", "Net Bag"] as const;
export const GLOVES = ["None", "White Cotton", "Leather", "Fingerless", "Gauntlets", "Fur Mitts"] as const;
export const WOODEN_LEG = ["None", "Left", "Right"] as const;
export const EYEPATCH = ["None", "Left", "Right"] as const;

// ---- fields appended after the first release (batch 2). Same rule as everything here: the order of every list is the wire format. ----
export const BROWS = ["Natural", "Bushy", "Thin Arched", "Unibrow", "Heavy Flat", "Villain", "Shaved"] as const;
export const EYE_SHAPES = ["Round", "Hooded", "Sleepy", "Wide-Eyed", "Narrow", "Bagged"] as const;
export const EYE_COLORS = ["Auto", "Blue-Grey", "Green", "Brown", "Amber", "Slate"] as const;
export const EAR_SHAPES = ["Standard", "Pointed", "Cauliflower", "Jug", "Long Lobes"] as const;
export const STUBBLE = ["Clean-Shaven", "Five O'Clock", "Rough", "Unshaven"] as const;
export const GREYING = ["None", "Temples", "Streaked", "Silver"] as const;
export const COMPLEXION = ["Clear", "Freckled", "Heavily Freckled", "Ruddy Cheeks", "Sun Spots"] as const;
export const MARKS = ["None", "Beauty Spot", "Mole", "Wart", "Birthmark"] as const;
export const FACE_PAINT = ["None", "Zinc Nose", "Soot Smudges", "Rouge", "Chalk Stripes", "Sunburnt Bridge", "Soot Mask", "Lime Dabs", "Lamp Soot Line", "Grange Stripes", "Ash Brow", "Tide Lines"] as const;
export const TATTOOS = ["None", "Neck Swallows", "Hand Anchor", "Cheek Star", "Knuckle Bands", "Brow Ribbon"] as const;
export const EARRINGS = ["None", "Gold Hoop", "Stud", "Pearl Drop", "Pair of Hoops"] as const;
export const RINGS = ["None", "Signet", "Gem", "Wedding Band", "Signet and Gem"] as const;
export const EPAULETTES = ["None", "Plain", "Fringed", "Bullion", "Shoulder Cords"] as const;
export const DECORATIONS = ["None", "Ribbon Bars", "Order Star", "Regimental Badge", "Rosette"] as const;
export const COAT_TRIMS = ["None", "Frogging", "Contrast Cuffs", "Fur Trim", "Braid Piping"] as const;
export const TROUSER_TRIMS = ["None", "Knee Patches", "Patched and Mended", "Muddy Knees", "Side Stripe"] as const;
export const HAT_TRIMS = ["None", "Goggles on Brim", "Feather", "Badge", "Cockade", "Ribbon Tails"] as const;
export const HOOKS = ["None", "Left", "Right"] as const;
// ---- batch 3: fine cosmetics (the wire format only ever grows at the end; index 0 of each is the look that shipped before it existed) ----
export const MEDAL_STYLES = ["Round Medals", "Draped Ribbons", "Crosses", "Stars"] as const;
export const BUCKLES = ["Square Plate", "Round Disc", "Oval Plate", "Double Prong", "Crest Plate"] as const;
export const CUFF_DETAILS = ["Plain", "Button Row", "Gold Links", "Buckled Strap"] as const;
export const BOOT_LACES = ["Standard", "Crossed Laces", "Bowed Laces", "Buckled Straps"] as const;
export const POCKETS = ["None", "Breast Pocket", "Pocket Square", "Flap Pockets", "Pens and Pencils"] as const;
export const HAIR_ACCESSORIES = ["None", "Ribbon Bow", "Tortoiseshell Comb", "Hairpins", "Silk Flower", "Feather Pin", "Copper Rings", "Bone Pins", "Glass Beads", "Herd Tags"] as const;
export const EYEPATCH_STYLES = ["Plain", "Skull Badge", "Bandage", "Jewelled"] as const;
export const SCAR_STYLES = ["Straight", "Jagged", "Stitched", "Forked"] as const;

/** Shirt cloth: cream first (the original shirt), then linen, then the twelve cloth dyes. */
export const SHIRT_COLORS: readonly number[] = [PALETTE.material.cream, PALETTE.material.linen, ...PALETTE.cloth];
/** Boot and strap leather. */
export const LEATHER_COLORS: readonly number[] = [PALETTE.material.leather, PALETTE.material.leatherBlack, PALETTE.material.leatherTan, PALETTE.material.leatherOx, PALETTE.material.leatherGrey];
export const IRIS_COLORS = PALETTE.iris;

/** Skin tones (sRGB hex). Deliberately varied; these are caricature bodies, not ethnic types. */
export const SKIN_TONES = PALETTE.skin;
export const HAIR_COLORS = PALETTE.hair;
/** Cloth palette: muted Victorian dyes. */
export const CLOTH_COLORS = PALETTE.cloth;
export const ACCENT_COLORS = PALETTE.metal;

export const SCAR_BITS = { CHEEK: 1, BROW: 2, CHIN: 4, NECK: 8, FOREHEAD: 16, NOSE: 32, CLAWS: 64, BURN: 128 } as const;
export const TEETH_BITS = { MISSING_FRONT: 1, GOLD_FRONT: 2, MISSING_SIDE: 4, GOLD_SIDE: 8, BUCK: 16, CROOKED: 32 } as const;
