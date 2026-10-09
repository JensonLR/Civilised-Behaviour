import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-099, plain words. The owner's report: "shit loads of ugly bulky paragraphs with odd wording that makes it hard for the majority of players to understand / follow". Every
 * line of copy the game shows (talk, orders, hints, endings, papers) is a string literal in this package; none may run past MAX_CHARS, and no sentence in one past MAX_WORDS.
 * A line that needs more is two lines, or less said. The satire stays; it says what happens first, plainly, and the joke after.
 */
export const MAX_CHARS = 190;
export const MAX_WORDS = 26;

/** Not shown to players (the level audit's own reports to the developer). */
const NOT_COPY = new Set(["levelAudit.ts", "levelAuditAdapters.ts", "realWorld.ts"]);

const SRC = join(process.cwd().endsWith("shared") ? process.cwd() : join(process.cwd(), "packages/shared"), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : n.endsWith(".ts") && !n.endsWith(".test.ts") ? [p] : [];
  });
}

/** Every prose string literal (three spaces or more: words, not ids) with the line it starts on, comments removed first. */
export function proseLiterals(source: string): { text: string; line: number }[] {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
  const out: { text: string; line: number }[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (let m = re.exec(blanked); m; m = re.exec(blanked)) {
    const text = m[1] ?? m[2] ?? "";
    if ((text.match(/ /g) ?? []).length < 3) continue;
    out.push({ text, line: blanked.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("plain words (D-099)", () => {
  it(`no line of copy runs past ${MAX_CHARS} characters, and no sentence past ${MAX_WORDS} words`, () => {
    const problems: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      if (NOT_COPY.has(rel)) continue;
      for (const { text, line } of proseLiterals(readFileSync(f, "utf8"))) {
        if (text.length > MAX_CHARS) problems.push(`${rel}:${line} ${text.length} chars: ${text.slice(0, 70)}...`);
        for (const s of text.split(/(?<=[.!?:;])\s+/)) {
          const words = s.split(/\s+/).filter(Boolean).length;
          if (words > MAX_WORDS) problems.push(`${rel}:${line} a ${words}-word sentence: ${s.slice(0, 70)}...`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("the scanner finds prose and skips code and comments", () => {
    const src = `// a comment with "a long quoted thing in it here"\nconst a = "id"; const b = "Pay the toll and walk on, sir.";\n/* "another quoted thing in a block comment" */\nconst c = \`Cross the \${x} bridge, or do not.\`;`;
    expect(proseLiterals(src).map((p) => [p.text, p.line])).toEqual([["Pay the toll and walk on, sir.", 2], ["Cross the ${x} bridge, or do not.", 4]]);
  });
});
