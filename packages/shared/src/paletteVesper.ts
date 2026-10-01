/**
 * Vesper Gorge's colours (D-037, package C3; docs/_notes/regions34.md section 3, docs/_notes/vesper.md and docs/ART_DIRECTION.md). The gorge's identity against Kessar's ochre coast and Highmark's gold, chalk and
 * verdigris: RED-VIOLET banded strata (a canyon is a ceiling of rock, so its light is cool and low on the floor and warm on the upper walls: `strataShade`/`strataViolet` low, `strataSun`/`strataBuff` high),
 * black crepe and iron where people are, the Guild's plum, lamp amber and copper-green only as small accents, a bleached sky. Part of `PALETTE` (palette.ts spreads it as `PALETTE.vesper`); only this
 * file and the gorge's view read the keys, and every key obeys the palette rules (nothing darker than ink, nothing pure white, chroma <= 0.4 except light sources named flame / ember / glow / lamp / sun;
 * the ink outline must read on every surface colour, contrast > 1.6). The identity swatch below is what the cross-region test reads.
 */
export const VESPER_PALETTE = {
  // the strata, low and cool to high and warm: the walls are painted bands of these by height
  strataShade: 0x5b4a5c,
  strataPlum: 0x6a4656,
  strataViolet: 0x7d5c7c,
  strataRustDark: 0x70392d,
  strataRust: 0x9c4f3a,
  strataBuff: 0xbf9470,
  strataSun: 0xc79d6e,
  strataBone: 0xd9c5a6,
  shale: 0x4d3e48,
  // the floor
  dust: 0xb08468,
  bedGravel: 0xc2ad94,
  scree: 0x9b7d6c,
  spoil: 0x8f8486,
  // the seep and the copper
  seepGreen: 0x4e8670,
  seepDark: 0x34584d,
  copper: 0xa8704a,
  verdigris: 0x6fa08a,
  // people and their works
  crepe: 0x443e4c,
  crepeFold: 0x5a5361,
  iron: 0x424955,
  ironLight: 0x6d7480,
  timber: 0x675646,
  timberLight: 0x8a7459,
  plank: 0xb09a76,
  chalk: 0xe2dccb,
  // cloth and light
  guildPlum: 0x6a3f5e,
  guildSilver: 0xc9c3cf,
  companyRed: 0x9a4038,
  companyCream: 0xdcc9a2,
  synGreen: 0x2f6b52,
  synGold: 0xbea363,
  glowLamp: 0xe3a640,
} as const;

/** The five colours that carry the region's identity (ground, wall, roof, accent, cloth); `regionPalettes.test.ts` compares them with the other regions'. */
export const VESPER_SWATCH = { ground: VESPER_PALETTE.dust, wall: VESPER_PALETTE.strataRust, roof: VESPER_PALETTE.crepe, accent: VESPER_PALETTE.strataPlum, cloth: VESPER_PALETTE.glowLamp } as const;
