import { describe, expect, it } from "vitest";
import { codeTag } from "./log.ts";

describe("join codes never reach the log", () => {
  it("a room is named in the log by a one-way tag: stable for a code, eight hex characters, not the code", () => {
    expect(codeTag("SUDFS")).toBe(codeTag("SUDFS"));
    expect(codeTag("SUDFS")).not.toBe(codeTag("SUDFT"));
    expect(codeTag("SUDFS")).toMatch(/^[0-9a-f]{8}$/);
    expect(codeTag("SUDFS").toUpperCase()).not.toContain("SUDFS");
  });
});
