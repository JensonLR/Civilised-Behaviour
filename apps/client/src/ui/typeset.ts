/**
 * Printer's quotes for authored copy (D-040). The game's period faces draw a straight `"` as a closing curl, so the playtest's paper read ”Business is business.”
 * The copy stays plain ASCII in the source (easy to write, easy to scan); the DOM gets the right marks: a double quote that opens (after the start, a space or an
 * opening bracket or dash) is “ and any other is ”; an apostrophe after a letter or digit is ’, one that opens is ‘, any other ’. Pure, no allocation beyond the result.
 */
const OPENS = /[\s([{—–-]/;

export function typeset(s: string): string {
  if (s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== '"' && ch !== "'") {
      out += ch;
      continue;
    }
    const prev = i === 0 ? " " : s[i - 1]!;
    const opening = OPENS.test(prev);
    if (ch === '"') out += opening ? "“" : "”";
    else out += /[A-Za-z0-9]/.test(prev) ? "’" : opening ? "‘" : "’";
  }
  return out;
}
