/**
 * D-085: the real-world names guard, in one place (the authored-text scans in the tests all read it).
 *
 * The Empire is London's: the owner's decision. The Society boasts of it, so the Empire's own home vocabulary (London, Britain, British, Britannia, Pall Mall, Whitehall, the
 * Union Jack) is allowed in authored text. Everything else stays out: every other real nation and people (the home nations' own peoples included), every real city and landmark
 * abroad, every religion. The peoples the Society meets abroad are invented and keep their agency; the satire's target is the Empire's own vanity, never a real people. No real
 * monarch or statesman is named either ("Her Majesty", "Whitehall", never a name).
 */
export const EMPIRE_HOME: readonly string[] = ["london", "britain", "british", "britannia", "pall mall", "whitehall", "union jack"];

/** Banned in authored text (whole words, any case). */
export const REAL_WORLD_BANNED: readonly string[] = [
  // nations, demonyms
  "england", "english", "briton", "scotland", "scottish", "scots", "welsh", "ireland", "irish", "france", "french", "germany", "german", "spain", "spanish",
  "portugal", "portuguese", "italy", "italian", "dutch", "holland", "netherlands", "belgium", "belgian", "russia", "russian", "china", "chinese", "japan", "japanese", "india", "indian",
  "persia", "persian", "ottoman", "turkey", "turkish", "arabia", "arab", "arabs", "egypt", "egyptian", "america", "american", "canada", "canadian", "australia", "australian", "zulu",
  "ashanti", "sudan", "sudanese", "africa", "african", "europe", "european", "asia", "asian", "mexico", "mexican", "brazil", "brazilian", "korea", "korean", "vietnam", "afghan", "afghanistan",
  "boer", "maori", "bedouin", "mughal", "sikh", "pashtun", "swedish", "sweden", "norway", "norwegian", "denmark", "danish", "greek", "greece", "polish", "poland", "israel", "israeli", "palestine",
  // cities, landmarks, flags
  "paris", "berlin", "rome", "madrid", "lisbon", "cairo", "delhi", "mumbai", "bombay", "calcutta", "istanbul", "constantinople", "khartoum", "lagos", "nairobi", "washington",
  "peking", "beijing", "tokyo", "kabul", "baghdad", "jerusalem", "mecca", "medina", "zanzibar", "suez", "gibraltar", "singapore", "hong kong", "new york", "cape town", "stars and stripes",
  // religions, scripture, clergy
  "christian", "christians", "christianity", "muslim", "muslims", "islam", "islamic", "jewish", "jews", "judaism", "hindu", "hindus", "hinduism", "buddhist", "buddhists", "buddhism", "catholic",
  "catholics", "protestant", "anglican", "methodist", "allah", "jesus", "christ", "muhammad", "mohammed", "buddha", "mosque", "synagogue", "temple of", "bible", "koran", "quran", "pope", "imam", "rabbi", "missionary", "missionaries",
];

/** The guard as one expression: a banned term as a whole word. */
export const REAL_WORLD_RE = new RegExp(`(?<![a-z])(?:${REAL_WORLD_BANNED.map((t) => t.replace(/ /g, "\\s+")).join("|")})(?![a-z])`, "i");
