/**
 * The Saltmarket Delta's colours (D-037, package D4; docs/_notes/regions34.md section 4, docs/_notes/saltmarket.md and docs/ART_DIRECTION.md). The delta's identity against Kessar's ochre coast, Highmark's gold, chalk and
 * verdigris and Vesper's red-violet rock: SILT AND SALT, cool and horizontal. Slate-blue water, grey-fawn silt and grey-brown mud, tarred plank and silvered piling for the houses, indigo and brick-coral canvas for
 * the roofs and awnings, salt-white only in small amounts, reeds in straw and drab, lantern light at dusk. Part of `PALETTE` (palette.ts spreads it as `PALETTE.saltmarket`); only this file and the delta's view
 * read the keys, and every key obeys the palette rules (nothing darker than ink, nothing pure white, chroma <= 0.4 except light sources named flame / ember / glow / lamp / sun; the ink outline must read on
 * every surface colour, contrast > 1.6). The identity swatch below is what the cross-region test reads.
 */
export const SALTMARKET_PALETTE = {
  // water, from the shallows to the cuts
  siltWater: 0x6a8090,
  siltWaterDeep: 0x435a6a,
  siltWaterPale: 0x9bb0b8,
  // the plain and the mud
  silt: 0x928f86,
  siltDark: 0x76746c,
  siltPale: 0xaeaa9e,
  mud: 0x6a5c52,
  mudDark: 0x4a3f38,
  mudPale: 0x9a8a78,
  // salt, in small amounts
  salt: 0xe8e0d0,
  saltShade: 0xc2bcae,
  // reeds
  reed: 0xb4a45c,
  reedDark: 0x7a7444,
  reedGreen: 0x8a8c4c,
  seedHead: 0x7a5a3c,
  // wood: tarred plank, silvered piling
  tarPlank: 0x5a463a,
  tarPlankDark: 0x4a3a30,
  tarPlankLight: 0x7a6250,
  piling: 0x8a8a80,
  pilingDark: 0x5e5f5a,
  pilingLight: 0xa6a69a,
  // canvas: indigo and brick-coral, and thatch
  indigoCanvas: 0x3e4a70,
  indigoDark: 0x343e5e,
  indigoLight: 0x5a688c,
  coralCanvas: 0xb8645a,
  coralDark: 0x8e4a44,
  coralLight: 0xd08a78,
  thatch: 0xa08850,
  thatchDark: 0x6e5c38,
  // metal and rope
  iron: 0x3e4248,
  brass: 0xa88e52,
  rope: 0x9a8460,
  // the Syndicate's banner at the Exchange's rail
  synGreen: 0x4a6a4c,
  synStripe: 0xb09c56,
  // light
  glowLantern: 0xe8b050,
  glowWindow: 0xf0c870,
} as const;

/** The five colours that carry the region's identity (ground, wall, roof, accent, cloth); `regionPalettes.test.ts` compares them with the other regions'. */
export const SALTMARKET_SWATCH = { ground: SALTMARKET_PALETTE.mud, wall: SALTMARKET_PALETTE.tarPlank, roof: SALTMARKET_PALETTE.indigoCanvas, accent: SALTMARKET_PALETTE.coralCanvas, cloth: SALTMARKET_PALETTE.salt } as const;
