import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE, cssHex, faviconSvg, paletteCssVars } from "@cb/shared";

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

describe("the tab icon", () => {
  // the live page logged a 404 for /favicon.ico on every load: a page with no <link rel="icon"> makes the browser ask the server for one
  it("the page declares an icon link, so the browser never requests /favicon.ico", () => {
    expect(html).toMatch(/<link rel="icon" href="data:,"/);
  });

  it("the seal is an SVG drawn only in palette colours", () => {
    const svg = faviconSvg();
    expect(svg.startsWith("<svg ")).toBe(true);
    const used = svg.match(/#[0-9a-f]{6}/gi) ?? [];
    const allowed = new Set(Object.values(PALETTE.ui).map((n) => cssHex(n)));
    expect(used.length).toBeGreaterThan(0);
    for (const hex of used) expect(allowed.has(hex.toLowerCase()), `${hex} from PALETTE.ui`).toBe(true);
  });
});

describe("the page itself carries no colour (D-049)", () => {
  it("index.html names no colour: the theme colour and the icon are set from the palette at start-up", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).toMatch(/<meta name="theme-color" content="" \/>/);
  });
});
