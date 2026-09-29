import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE, cssHex, paletteCssVars } from "@cb/shared";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

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
