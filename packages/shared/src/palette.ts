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
import { SALTMARKET_PALETTE } from "./paletteSaltmarket.ts";
import { VESPER_PALETTE } from "./paletteVesper.ts";

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
    // more blooms (petals are white in the geometry; the instance colour paints them), reeds, ferns, fungi, berries
    bloomViolet: 0x9a78a8,
    bloomPink: 0xc98a94,
    fern: 0x3f7a3a,
    reed: 0x8a9a4a,
    cattail: 0x6a4a30,
    capRed: 0xa4503f,
    capSpot: 0xeee3c8,
    stemPale: 0xd8cfb4,
    berry: 0x8a2f3f,
    berryBlue: 0x4a4f8a,
    // cut wood, rock strata and lichen
    logCut: 0xc4a574,
    ringDark: 0x9a7c50,
    rockStrata: 0x9c8f78,
    lichen: 0xa6a35a,
    // paths, ruts, river banks
    dust: 0xc4a06c,
    trailWorn: 0xa8865a,
    rut: 0x5e4630,
    trampled: 0x9b9a52,
    mud: 0x6b5a43,
    sand: 0xc2b088,
    // toon water
    waterDeep: 0x4f7a94,
    waterShallow: 0x7fb0b2,
    waterFoam: 0xe9efe0,
    waterGlint: 0xcfe3dc,
    // distant wood on the hill rings
    hillTree: 0x3d5c3a,
    hillTreeLight: 0x5d7a3f,
    hillTreeDry: 0x9a7a3a,
    // the Society's abandoned Observatory of Improvement (a ruin on the hill)
    ruinPale: 0xc9bb9a,
    ruinShadow: 0x7a6c56,
    // ambient life
    pollen: 0xf1e3a0,
    firefly: 0xd6e07a,
    smoke: 0xcfc6b6,
    smokeShade: 0xa89e90,
    bird: 0x4a423a,
    moon: 0xe8ecd8,
    star: 0xf3ecd0,
    // the day cycle: morning gold, dusk plum, moonlit night (noon/afternoon is the sky/light block above). Each stop is the sun (or
    // moon) colour, sky top/mid/horizon, the horizon glow and the hemisphere's sky/ground bounce; exposure is applied in code.
    morningSun: 0xffd49a,
    morningTop: 0x5d80b8,
    morningMid: 0xd6b98f,
    morningHorizon: 0xf1ca90,
    morningGlow: 0xf0be8a,
    morningSky: 0xd8cfb8,
    morningBounce: 0x7a5a58,
    duskSun: 0xf2b98c,
    duskTop: 0x3f4380,
    duskMid: 0x9a6f96,
    duskHorizon: 0xdd9c7c,
    duskGlow: 0xdc9a76,
    duskSky: 0x9a8fb8,
    duskBounce: 0x5a4058,
    nightSun: 0xa9b8e0,
    nightTop: 0x2c3d6b,
    nightMid: 0x41558a,
    nightHorizon: 0x6b7fa8,
    nightGlow: 0x6a78a8,
    nightSky: 0x4f6294,
    nightBounce: 0x3a3f66,
    // weather: overcast and storm skies (greys with a cool cast), fog banks, dust haze, the flash of lightning, rain streaks and puddle sheen
    overcastTop: 0x8592a0,
    overcastMid: 0xa7b0b6,
    overcastHorizon: 0xbfc2bd,
    stormTop: 0x4a5463,
    stormMid: 0x656f7c,
    stormHorizon: 0x868d93,
    mist: 0xd2cfc3,
    dustHaze: 0xc9a970,
    flash: 0xdde7f3,
    rain: 0xb6c4ce,
    puddle: 0x7d9db0,
    // the Observatory's copper dome (verdigris where the weather has been at it), and its dark interior
    copper: 0xa06c45,
    copperDark: 0x6f4c36,
    verdigris: 0x5f8f80,
    verdigrisLight: 0x8fbba6,
    ruinInterior: 0x4d453d,
    // vegetation variety: birch, pine, autumn patches, hanging vines, water plants, lichen
    birchBark: 0xd8d2c0,
    birchMark: 0x4a4238,
    birchLeaf: 0xa4ad55,
    pine: 0x2f4a36,
    pineLight: 0x4d6b45,
    pineBark: 0x6a4630,
    autumnRed: 0x9a5240,
    autumnOrange: 0xa4703f,
    autumnGold: 0xb09452,
    vine: 0x4f7a3a,
    vineLight: 0x78a04a,
    lily: 0x4d7a45,
    lilyFlower: 0xe0b8c4,
    lichenOrange: 0xb08850,
    // the spawn clearing's furniture: fence, plank bridge, well, stepping stones, and the flock
    fence: 0x7d6444,
    plank: 0x9a7a52,
    plankDark: 0x6b5238,
    wellStone: 0x8f887a,
    wellWater: 0x3f6478,
    fleece: 0xe2dac8,
    fleeceShade: 0xb5a992,
    hide: 0x8a6a4a,
    hideDark: 0x5d4632,
    // HOLLOWMERE, the local village: lime-washed plaster in three washes, river-stone footings, dark framing, three roof coverings, indigo doors, teal shutters,
    // striped awnings, hay, cobbles and garden soil
    vlPlaster: 0xdcceaa,
    vlPlasterOchre: 0xcaa872,
    vlPlasterRose: 0xc9917a,
    vlPlasterShade: 0xa89880,
    vlStone: 0x8c8474,
    vlStoneDark: 0x6b6357,
    vlTimber: 0x5b4331,
    vlTimberLight: 0x8b6b49,
    vlTile: 0xa25c45,
    vlTileDark: 0x7b4433,
    vlShingle: 0x6d9088,
    vlShingleDark: 0x4b6c66,
    vlThatch: 0xb99d59,
    vlThatchDark: 0x8b7343,
    vlDoor: 0x40608a,
    vlShutter: 0x4c8a85,
    vlAwningRed: 0xa45a48,
    vlAwningCream: 0xe3d7b8,
    vlAwningBlue: 0x476c94,
    vlAwningOchre: 0xcfae6a,
    vlSoot: 0x4c4239,
    vlHay: 0xc6b070,
    vlCobble: 0x9b9485,
    vlCobbleDark: 0x777061,
    vlSoil: 0x6b4d35,
    vlLeafy: 0x80995a,
    vlGourd: 0xb58753,
    vlHeraldBlue: 0x30527b,
    vlHeraldGold: 0xc4a664,
    // ground detail: leaf litter (olive-brown, and the reds of an autumn wood), the crazing of sun-baked clay
    litter: 0x7f6b3c,
    litterRed: 0x8f5537,
    crackClay: 0x866a48,
    // the far range: snow, its shaded side, and cold rock
    snow: 0xe3e6e7,
    snowShade: 0xb3bfd0,
    peakRock: 0x8d919c,
    // the windmill on the second summit
    millCap: 0x6f5a48,
    sail: 0xd9d0b4,
    // wildlife: a roe deer's coat, belly and rump patch, antler bone; a mallard's green head, chestnut breast, grey flank and bill; the village cat
    deerCoat: 0x9c6d43,
    deerBelly: 0xd6c4a0,
    deerRump: 0xe6dcc2,
    antler: 0xc9b78f,
    mallardHead: 0x3a6a56,
    mallardBreast: 0x7d4f3c,
    mallardFlank: 0x9b9587,
    duckBill: 0xb59d5c,
    catGinger: 0xb98757,
    catCream: 0xe0cfa8,
    // dragonflies over the stream
    dragonBlue: 0x4a8296,
    dragonGreen: 0x5e9a72,
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
    // camp life: the map table, telescope, gramophone, lanterns and washing
    mapPaper: 0xe4d6b0,
    mapWash: 0xb9c8a0,
    mapSea: 0x9fb8bc,
    tableCloth: 0x6a3a3a,
    horn: 0xc0a25a,
    glass: 0x8fb0b0,
    glowLantern: 0xf2c46a,
    flameOuter: 0xd9782f,
    flameMid: 0xeaa23c,
    flameCore: 0xf6d685,
    ember: 0xb8502c,
    glow: 0xf0a04a,
  },

  /** Everyday materials shared by clothing, props and hats. */
  material: {
    wood: 0x7a5230,
    leather: 0x5a3a24,
    cream: 0xe8dcc0,
    soot: 0x241c16,
    iron: 0x5c5e62,
    bandage: 0xe6dbbd,
    bandageDirty: 0xc9bb96,
    // leathers for boots and straps (the boot colour field picks among these), plus fur, rope and rubber
    leatherBlack: 0x40352a,
    leatherTan: 0x957a58,
    leatherOx: 0x5f2c26,
    leatherGrey: 0x6c675e,
    rubber: 0x454a3c,
    fur: 0xb8a88c,
    furDark: 0x6e5c48,
    rope: 0xa8946a,
    linen: 0xd8ccb0,
    smoke: 0x3a3430,
  },

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
    // face paint, ribbons, feathers and gems
    zinc: 0xe4e0d2,
    rouge: 0xb4645c,
    featherGreen: 0x4f7a5a,
    featherBlue: 0x3f6a86,
    ribbonGreen: 0x3f6a4a,
    ribbonPurple: 0x5a3f6a,
    gemGreen: 0x2f7a5a,
    gemRed: 0xa03444,
    pearl: 0xe6e0d0,
    // stockings and puttees
    puttee: 0x7a7448,
    // fine cosmetics: medals, visors, combs, blossoms, pencils
    visorGlass: 0x4f8a5a,
    tortoise: 0x6a4a2a,
    bronze: 0xa4703a,
    blossom: 0xc4707a,
    pencil: 0xb89a4a,
  },

  /** Metalwork colours (the spec's "accent" field). */
  metal: [0xd0a94a, 0xc0c0c8, 0xb8732f, 0xd9d0b8],

  /** Skin: eight tones, light to deep, one warm hue family. Blush, shadow and lips are derived from these, never picked. */
  // (append-only: a look stores the index. D-067 appended four deeper tones: bronze, chestnut, golden umber, red-brown; every one keeps the ink, lash and tattoo lines legible)
  skin: [0xf3cfb3, 0xe8b998, 0xd29c76, 0xb07a55, 0x8f5d40, 0x6d4531, 0xecc0a6, 0xdcae8c, 0x9a6844, 0x7a4b30, 0x80603f, 0x7e4a36],

  hair: [0x1c1410, 0x3b2616, 0x6a4423, 0x9a6a2f, 0xc79a4a, 0xa64a24, 0x8a8a8a, 0xe6e2d6, 0x2a2a3a, 0x7a2a1a],

  /** Cloth dyes: muted Victorian. Twelve distinguishable hues, none garish. */
  cloth: [0x8f2d22, 0x2f4f7f, 0x3f6a3a, 0x8a6a1f, 0x5a3a5a, 0x3d3d46, 0x7a7466, 0xb8a06a, 0x5c5c3a, 0x6a2a2a, 0x3a6a68, 0xa8552f],

  iris: [0x4f7a9a, 0x5f8a4a, 0x7a5030, 0x8a6a30, 0x3a4a6a],

  /** Face-part constants. */
  face: { white: 0xf4efe2, pupil: 0x15100c, mouth: 0x5a1f1a, cavity: 0x2a0c0c, tongue: 0xc4646a, scar: 0x9a4a4a, nostril: 0x2a1418, tattoo: 0x2c3650, gum: 0xa85a5a, lash: 0x2a1c14, glint: 0xfffcf2 },

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

  /** Weapons and their furniture: browned barrels, walnut stocks, brass fittings, cavalry steel, cannon bronze. (Surfaces; the light of a discharge is `weaponFx`.) */
  weapons: {
    brass: 0xb89c5c,
    brassDark: 0x8c6a2c,
    steel: 0x9aa0a6,
    steelDark: 0x6f747a,
    barrel: 0x4a4d53,
    barrelLight: 0x676a70,
    walnut: 0x6b4428,
    walnutLight: 0x8f5d36,
    umbrella: 0x36466b,
    umbrellaRib: 0x7a746a,
    bronze: 0x9a6a34,
    bronzeDark: 0x6e4a26,
    carriage: 0x5f4229,
    ironBand: 0x3b3c40,
    fuse: 0xb59c6a,
    shell: 0x54565a,
  },

  /** What a discharge looks like: flash, smoke, sparks, splinters, dust, the streak of a ball. Light sources may be properly saturated. */
  weaponFx: {
    flashCore: 0xfff0c0,
    flashMid: 0xf6b84a,
    flashOuter: 0xd9682a,
    smokeLight: 0xcfc6b4,
    smokeDark: 0x6b625a,
    spark: 0xffd27a,
    splinter: 0xc79a5a,
    dust: 0xb59a72,
    tracer: 0xf2dca0,
    stone: 0xa39a8a,
    cloth: 0xc9bd9a,
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

  /** Kessar Reach (region 1): ochre coast, sandstone hill-fort, scrub, the Ward's heraldry and the Syndicate's. Owned by the region plan (kessar.ts). */
  kessar: {
    sand: 0xcdb587,
    sandPale: 0xe0cfa2,
    sandWet: 0xa38d68,
    ochre: 0xba9058,
    clay: 0xa8744c,
    strata: 0xc9a06a,
    strataDark: 0x94704a,
    scrub: 0x8d8c4f,
    scrubDry: 0xb3a45f,
    scrubDeep: 0x6f7a44,
    shingle: 0xa69c86,
    roadDust: 0xd2bd8e,
    roadRut: 0x9a7e56,
    stone: 0xd6bf91,
    stoneShade: 0xb89c6e,
    stoneDark: 0x93795a,
    stoneCap: 0xe4d3ab,
    roof: 0xa4653f,
    roofDark: 0x7e4330,
    timber: 0x6b4a2f,
    timberLight: 0x96703f,
    iron: 0x55504b,
    ironLight: 0x7a746a,
    lampGold: 0xd8ae48,
    wardRed: 0x9a4235,
    wardBlue: 0x2f5078,
    wardCream: 0xeadcb8,
    synGreen: 0x3f6b57,
    synStripe: 0xd9c98a,
    frond: 0x6b8a3c,
    frondDark: 0x4f6f30,
    trunkPalm: 0x8a6a45,
    hull: 0x7a5238,
    awning: 0xc4a460,
  },

  /** Highmark (region two, D-036): golden savannah, chalk-white stepped walls, verdigris roofs, the Crown's sun and stag, the Grange's wheat. Owned by the region plan (highmark.ts) and its view. */
  highmark: {
    chalk: 0xf0ebdd,
    chalkShade: 0xd4cebd,
    chalkDark: 0xa8a190,
    chalkCap: 0xf5f1e6,
    verdigris: 0x5f9a86,
    verdigrisDark: 0x3f7467,
    verdigrisLight: 0x8fb9a2,
    grassGold: 0xc4ae68,
    grassGoldDeep: 0xa28c46,
    grassGoldPale: 0xd6c785,
    grassGreen: 0x8a9348,
    grassGreenDeep: 0x6c7a3c,
    earth: 0xb98a58,
    earthDark: 0x93693f,
    roadChalk: 0xd9ccaa,
    roadRut: 0xa8946a,
    shingle: 0xaaa088,
    mud: 0x8a6d4a,
    acaciaCrown: 0x6f8240,
    acaciaTrunk: 0x6a4e34,
    termite: 0xa6764d,
    termiteDark: 0x7e5535,
    timber: 0x6a4a30,
    timberLight: 0x95703f,
    iron: 0x55504b,
    sunGold: 0xd8ae48,
    lampGlow: 0xe4b658,
    stagBrown: 0x7a4b30,
    crownBlue: 0x3a5878,
    crownRed: 0x94483a,
    crownCream: 0xeadcb8,
    grangeGreen: 0x6a8a3c,
    grangeWheat: 0xcdb468,
    synGreen: 0x3f6b57,
    synStripe: 0xd9c98a,
    bell: 0xb08a4a,
    reed: 0xa89a52,
    reedDark: 0x7e7438,
    hide: 0x9a6c46,
    hideDark: 0x6e4a32,
    hidePale: 0xc9a77a,
    hull: 0x7a5238,
    awning: 0xc4a460,
    // the skyline pass (D-037, package P): what lets the capital hold its edge against the haze
    /** The capital's roofs, deeper than `verdigris`: a dark mass against pale haze, the first value to survive distance. */
    roofDeep: 0x2d5f52,
    /** The lit tower's glass by day: slate, a dark pane in the white tower. At the harvest bell hour it is `lampGlow`. */
    lanternGlass: 0x4a5560,
  },

  /** The Society's outpost (D-035), from foundation stakes to a town: canvas, plank, palisade, stone, telegraph, the launch, road paint. Owned by outpost.ts and its views. */
  outpost: {
    stake: 0xb59a6a,
    string: 0xe3d6b4,
    canvas: 0xd9ceae,
    canvasShade: 0xb6a888,
    plank: 0x9a7448,
    plankDark: 0x6e4f32,
    thatch: 0xb59a58,
    palisade: 0x7a5a38,
    palisadeTop: 0x5e4329,
    stoneHouse: 0xcbb68c,
    stoneShade: 0xa89472,
    slate: 0x6c675f,
    clockFace: 0xe6dcc0,
    brass: 0xb89c5c,
    pole: 0x5d4a38,
    wire: 0x3f3a35,
    road: 0xc9b184,
    roadEdge: 0xa88f64,
    launchHull: 0x4e5f6a,
    launchTrim: 0xc9bd9c,
    steam: 0xdcd6cc,
    pennantSociety: 0x7a8a50,
    pennantRival: 0x3f6b57,
    sign: 0xe0cfa2,
    mud: 0x8a6d4a,
  },

  /** Vesper Gorge (region three, D-037): red-violet strata in cool shade, black crepe, the Guild's plum, lamp amber. Owned by paletteVesper.ts (package C3). */
  vesper: VESPER_PALETTE,

  /** The Saltmarket Delta (region four, D-037): silt and salt, slate water, tarred plank, indigo and coral canvas. Owned by paletteSaltmarket.ts (package D4). */
  saltmarket: SALTMARKET_PALETTE,
} as const;

/**
 * The five colours that carry each region's identity (ground, wall, roof, accent, cloth), compared across regions by `regionPalettes.test.ts` so no two regions read alike. Kessar's and Highmark's are
 * declared here (Highmark's keys may be re-pointed by whoever restyles it, never dropped); Vesper's and Saltmarket's live beside their groups.
 */
export const KESSAR_SWATCH = { ground: PALETTE.kessar.sand, wall: PALETTE.kessar.stone, roof: PALETTE.kessar.roof, accent: PALETTE.kessar.wardRed, cloth: PALETTE.kessar.wardBlue } as const;
export const HIGHMARK_SWATCH = { ground: PALETTE.highmark.grassGold, wall: PALETTE.highmark.chalk, roof: PALETTE.highmark.verdigris, accent: PALETTE.highmark.crownRed, cloth: PALETTE.highmark.crownBlue } as const;

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

