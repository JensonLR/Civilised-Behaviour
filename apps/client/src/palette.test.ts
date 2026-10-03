import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PALETTE, cssHex, emblemSvg, paletteCssVars } from "@cb/shared";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("interface colours come from the shared palette", () => {
  it("the :root fallbacks in style.css equal the palette (they are only for the first frame)", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
    for (const [name, value] of Object.entries(paletteCssVars())) {
      const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
      expect(m, `${name} declared in :root`).not.toBeNull();
      expect(m![1]!.toLowerCase(), name).toBe(value);
    }
  });

  it("style.css has no hard-coded palette colours outside :root (use the variables)", () => {
    const outside = css.replace(/:root\s*\{[^}]*\}/, "");
    const uiHexes = Object.values(PALETTE.ui).map((n) => cssHex(n));
    for (const hex of uiHexes) expect(outside.toLowerCase(), `${hex} used literally`).not.toContain(hex);
  });
});

describe("the tab icon and the home-screen icon (D-053: the Society's seal)", () => {
  // the live page logged a 404 for /favicon.ico when it had no icon link; then Safari's favourites showed a bare "C": an icon set by script is invisible to the
  // tile and the home screen, which read static links. Every icon is now a file, generated from the palette by scripts/icons.mts
  const pub = (f: string): string => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
  it("the page declares the SVG and PNG icons, the touch icon and the manifest, and every file is there", () => {
    for (const re of [/<link rel="icon" href="\/favicon.svg" type="image\/svg\+xml"/, /<link rel="icon" href="\/favicon-32.png"/, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png"/, /<link rel="manifest" href="\/manifest.webmanifest"/]) expect(html).toMatch(re);
    for (const f of ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "manifest.webmanifest"]) expect(existsSync(pub(f)), f).toBe(true);
  });

  it("each PNG is the size its name and the manifest promise (read from the file's own header)", () => {
    const size = (f: string): [number, number] => {
      const b = readFileSync(pub(f));
      expect(b.subarray(1, 4).toString("latin1"), f).toBe("PNG");
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(size("favicon-32.png")).toEqual([32, 32]);
    expect(size("apple-touch-icon.png")).toEqual([180, 180]);
    expect(size("icon-192.png")).toEqual([192, 192]);
    expect(size("icon-512.png")).toEqual([512, 512]);
    expect(size("icon-maskable-512.png")).toEqual([512, 512]);
    const m = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8")) as { icons: { src: string; sizes: string; purpose?: string }[]; background_color: string; theme_color: string };
    for (const i of m.icons) expect(existsSync(pub(i.src)), i.src).toBe(true);
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(m.background_color).toBe(cssHex(PALETTE.ui.backdrop));
  });

  it("the committed favicon is the generator's (regenerate with `npx tsx scripts/icons.mts` after a palette change), drawn only in palette colours", () => {
    const svg = emblemSvg({ detail: "small" });
    expect(readFileSync(pub("favicon.svg"), "utf8")).toBe(svg);
    for (const s of [svg, emblemSvg({}), emblemSvg({ tile: true })]) {
      const used = s.match(/#[0-9a-f]{6}/gi) ?? [];
      const allowed = new Set(Object.values(PALETTE.ui).map((n) => cssHex(n)));
      expect(used.length).toBeGreaterThan(0);
      for (const hex of used) expect(allowed.has(hex.toLowerCase()), `${hex} from PALETTE.ui`).toBe(true);
    }
  });
});

describe("the page itself carries no colour (D-049)", () => {
  it("index.html names no colour: the theme colour and the icon are set from the palette at start-up", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).toMatch(/<meta name="theme-color" content="" \/>/); // (the theme colour is set at start-up; the icons are palette-generated files)
  });
});
