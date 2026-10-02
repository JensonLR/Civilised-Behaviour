import { describe, expect, it } from "vitest";
import { typeset } from "./typeset.ts";

describe("printer's quotes (D-040)", () => {
  it("opens and closes double quotes by context, and curls apostrophes", () => {
    expect(typeset('Lamp-Warden Ysolde Hask said: "Business is business. We do it on a bridge."')).toBe("Lamp-Warden Ysolde Hask said: “Business is business. We do it on a bridge.”");
    expect(typeset("The Society's programme is \"fully costed\", apart from the costs.")).toBe("The Society’s programme is “fully costed”, apart from the costs.");
    expect(typeset("an 'enhancement'.")).toBe("an ‘enhancement’.");
    expect(typeset('("quoted")')).toBe("(“quoted”)");
    expect(typeset('"Start" of a line')).toBe("“Start” of a line");
    expect(typeset("plain text")).toBe("plain text");
  });
});
