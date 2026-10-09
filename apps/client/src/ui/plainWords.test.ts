import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-099, plain words, for the client's own copy (the menus, the sheets, the HUD's prompts and notices): the same rule as packages/shared/src/plainWords.test.ts. No line runs past
 * MAX_CHARS and no sentence past MAX_WORDS. Markup and shader source are not copy (a literal holding "<" or a GLSL word is skipped).
 */
const MAX_CHARS = 190;
const MAX_WORDS = 26;
const SRC = join(process.cwd().endsWith("client") ? process.cwd() : join(process.cwd(), "apps/client"), "src");
const DIRS = ["ui", "game", "platform", "input", "net", "audio"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : n.endsWith(".ts") && !n.endsWith(".test.ts") ? [p] : [];
  });
}

const notCopy = (t: string): boolean => /[<>]|\b(?:uniform|varying|void|vec[234])\b|^[MmLlHhVvCcQqTtAaZz0-9 .,-]+$/.test(t);

describe("plain words in the client (D-099)", () => {
  it(`no line of copy runs past ${MAX_CHARS} characters, and no sentence past ${MAX_WORDS} words`, () => {
    const problems: string[] = [];
    for (const d of DIRS) {
      for (const f of files(join(SRC, d))) {
        const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
        const re = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const text = m[1] ?? m[2] ?? "";
          if ((text.match(/ /g) ?? []).length < 3 || notCopy(text)) continue;
          const at = `${relative(SRC, f)}:${src.slice(0, m.index).split("\n").length}`;
          if (text.length > MAX_CHARS) problems.push(`${at} ${text.length} chars: ${text.slice(0, 70)}...`);
          for (const s of text.split(/(?<=[.!?:;])\s+/)) if (s.split(/\s+/).filter(Boolean).length > MAX_WORDS) problems.push(`${at} long sentence: ${s.slice(0, 70)}...`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
