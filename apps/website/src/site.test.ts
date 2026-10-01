import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PALETTE, contrast, paletteCssVars } from "@cb/shared";
import { CONTRAST_PAIRS, MIN_CONTRAST, buildSite, makeTokens } from "../scripts/build.mjs";
import { disclosureFrom, parseRegister, parseTypes } from "../scripts/claims.mjs";

const REGISTER_PATH = new URL("../../../docs/AI_CONTENT_REGISTER.md", import.meta.url).pathname;
const REGISTER = readFileSync(REGISTER_PATH, "utf8");
let out: string;
let built: Awaited<ReturnType<typeof buildSite>>;
const read = (f: string): string => readFileSync(join(out, f), "utf8");
const PAGES = ["index.html", "press.html"] as const;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "cb-site-"));
  built = await buildSite({ outdir: out });
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const strip = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "");

describe("build output", () => {
  it("writes both pages, the stylesheet, GENERATED tokens, the press kit and the bundled fonts", () => {
    for (const f of ["index.html", "press.html", "style.css", "tokens.css", "presskit.json"]) expect(existsSync(join(out, f)), f).toBe(true);
    const fonts = readdirSync(join(out, "fonts")).filter((f) => f.endsWith(".woff2"));
    expect(fonts.length).toBe(4);
    for (const f of fonts) expect(read("style.css")).toContain(`fonts/${f}`);
    for (const p of PAGES) expect(read(p)).not.toContain("<!--@");
  });

  it("tokens.css is the shared palette's interface colours, exactly, and says it is generated", () => {
    const tokens = read("tokens.css");
    expect(tokens).toMatch(/^\/\* GENERATED/);
    const got = Object.fromEntries([...tokens.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
    expect(got).toEqual(paletteCssVars());
    expect(built.tokens.css).toBe(tokens);
  });

  it("every colour variable the pages and stylesheet use exists, and there is no colour literal in them", () => {
    const defined = new Set([...Object.keys(paletteCssVars()), "--display", "--serif", "--type", "--leather", "--measure"]);
    const css = read("style.css");
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) expect(defined.has(m[1]!), m[1]).toBe(true);
    for (const f of ["style.css", ...PAGES]) {
      expect(strip(read(f)), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\(|hsla?\(/);
    }
    // the only colour keywords allowed are none: no named colour in a colour property
    expect(css).not.toMatch(/(color|background|border[a-z-]*)\s*:\s*(red|blue|green|black|white|gray|grey|yellow|orange|purple)\b/i);
  });

  it("generated token contrast: every pair the stylesheet uses reaches AA (4.5:1), and so does text on the leather mix", async () => {
    const t = await makeTokens();
    for (const [a, b] of CONTRAST_PAIRS) expect(t.contrast[`${a}/${b}`], `${a}/${b}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    const mix = (a: number, b: number, w: number): number => {
      const c = (s: number): number => Math.round(((a >> s) & 255) * w + ((b >> s) & 255) * (1 - w));
      return (c(16) << 16) | (c(8) << 8) | c(0);
    };
    const leather = mix(PALETTE.ui.stampDark, PALETTE.ui.scrim, 0.55);
    expect(contrast(PALETTE.ui.text, leather)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrast(PALETTE.ui.paper, leather)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe("no external request of any kind", () => {
  const targets = (html: string): string[] => [...strip(html).matchAll(/\b(?:href|src|action|poster|data|srcset)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]!);

  it("every link and resource in the pages is relative, an in-page anchor, or https; never http:, never protocol-relative", () => {
    for (const p of PAGES) {
      const list = targets(read(p));
      expect(list.length, p).toBeGreaterThan(3);
      for (const t of list) {
        expect(t, `${p}: ${t}`).not.toMatch(/^http:/i);
        expect(t, `${p}: ${t}`).not.toMatch(/^\/\//);
        expect(t, `${p}: ${t}`).not.toMatch(/^(javascript|data|file|ftp):/i);
        expect(/^(https:|#|[a-z0-9._-]+(\/[a-z0-9._-]+)*(#[a-z0-9-]+)?$)/i.test(t), `${p}: ${t}`).toBe(true);
      }
      // today the site links to nothing outside itself at all
      expect(list.filter((t) => /^https:/i.test(t)), p).toEqual([]);
    }
  });

  it("relative targets exist in the build, and every in-page anchor has an id", () => {
    for (const p of PAGES) {
      const html = strip(read(p));
      for (const t of targets(html)) {
        if (t.startsWith("#")) expect(html, `${p} ${t}`).toContain(`id="${t.slice(1)}"`);
        else if (!/^https:/.test(t)) expect(existsSync(join(out, t.split("#")[0]!)), `${p} -> ${t}`).toBe(true);
      }
    }
  });

  it("no script tag at all (so none to another origin), no inline handlers, no forms, no frames, no @import, no remote url()", () => {
    for (const p of PAGES) {
      const html = strip(read(p));
      expect(html, p).not.toMatch(/<script|<form|<iframe|<object|<embed|<link[^>]+rel="(?:preload|prefetch|preconnect|dns-prefetch)"/i);
      expect(html, p).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html, p).not.toMatch(/http:\/\//i);
    }
    for (const f of ["style.css", "tokens.css"]) {
      const css = read(f);
      expect(css).not.toMatch(/@import/i);
      for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) expect(m[1], `${f} url()`).toMatch(/^fonts\/[a-z0-9.-]+\.woff2$/);
    }
    for (const file of walk(out).filter((f) => /\.(html|css|json)$/.test(f))) expect(readFileSync(file, "utf8"), file).not.toMatch(/\bhttp:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("sets no cookie and reads no storage (there is no script to do it)", () => {
    for (const p of PAGES) expect(read(p)).not.toMatch(/document\.cookie|localStorage|sessionStorage|navigator\.sendBeacon|<meta[^>]+http-equiv="set-cookie"/i);
  });
});

describe("accessibility", () => {
  it("lang on <html>, a title, a viewport, one h1 and heading levels that never skip", () => {
    for (const p of PAGES) {
      const html = strip(read(p));
      expect(html).toMatch(/^<!doctype html>\s*<html lang="en">/i);
      expect(html).toMatch(/<title>[^<]{4,}<\/title>/);
      expect(html).toMatch(/<meta name="viewport"/);
      const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      expect(levels.filter((l) => l === 1), p).toHaveLength(1);
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `${p} heading ${i}`).toBeLessThanOrEqual(1);
    }
  });
  it("every image has alt text, every svg is hidden or labelled, a skip link and a main landmark exist, tables have headers", () => {
    for (const p of PAGES) {
      const html = strip(read(p));
      for (const m of html.matchAll(/<img\b[^>]*>/gi)) expect(m[0], p).toMatch(/\balt="/);
      for (const m of html.matchAll(/<svg\b[^>]*>/gi)) expect(m[0], p).toMatch(/aria-hidden="true"|aria-label=/);
      expect(html).toMatch(/<a class="skip" href="#main">/);
      expect(html).toMatch(/<main id="main">/);
      expect(html).toMatch(/<nav aria-label="[^"]+">/);
      for (const t of html.matchAll(/<table[\s\S]*?<\/table>/g)) expect(t[0]).toMatch(/<th scope="row">/);
    }
  });
  it("respects reduced motion (the only transition sits behind no-preference) and print", () => {
    const css = read("style.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*transition/);
    expect(css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\}\s*\}/, "")).not.toMatch(/transition|animation/);
  });
});

describe("the claims", () => {
  it("the register's Type column is read and every type is covered by a disclosure line", () => {
    const rows = parseRegister(REGISTER);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const types = new Set(rows.flatMap((r) => parseTypes(r.type).map((t) => t.kind)));
    expect(types.has("text")).toBe(true);
    expect(types.has("sound")).toBe(true);
    const d = disclosureFrom(REGISTER);
    expect(d.entries).toBe(rows.length);
    for (const t of types) expect(d.lines.some((l) => l.label.toLowerCase().startsWith(t === "sound" ? "audio" : t.slice(0, 4))), t).toBe(true);
    expect(d.pending).toBeGreaterThan(0);
    expect(d.nothingModelGenerated).toBe(true);
    const press = read("press.html");
    for (const l of d.lines) expect(press).toContain(l.line.replace(/&/g, "&amp;"));
    expect(press).toContain("pending developer review");
    expect(press).toContain(`${d.pending} are marked`);
    expect(press).toMatch(/No audio and no image in the game was generated by an AI model/);
  });

  it("MUTATION: a register row of a kind the page has no line for FAILS the build", async () => {
    const extra = `${REGISTER.trimEnd()}\n| 2026-10-02 | A hologram of the Chairman | hologram | some model | none | yes |\n`;
    await expect(buildSite({ outdir: join(out, "x1"), registerText: extra })).rejects.toThrow(/no disclosure line/);
    // an empty type cell is not "covered" either
    await expect(buildSite({ outdir: join(out, "x2"), registerText: `${REGISTER.trimEnd()}\n| 2026-10-02 | Something | | model | none | yes |\n` })).rejects.toThrow();
    // the unmutated register still builds
    await expect(buildSite({ outdir: join(out, "x3") })).resolves.toBeDefined();
  });

  it("MUTATION: a model-generated image or voice REMOVES the 'nothing model-generated' sentence and says so instead", async () => {
    for (const row of ["| 2026-10-02 | Key art | art | an image model | none | yes |", "| 2026-10-02 | Narrator | voice | a voice model | none | yes |"]) {
      const r = await buildSite({ outdir: join(out, "x4"), registerText: `${REGISTER.trimEnd()}\n${row}\n` });
      expect(r.disclosure.nothingModelGenerated).toBe(false);
      const press = readFileSync(join(r.outdir, "press.html"), "utf8");
      expect(press).not.toContain("No audio and no image in the game was generated by an AI model");
      expect(press).toContain("were generated by an AI model");
      const kit = JSON.parse(readFileSync(join(r.outdir, "presskit.json"), "utf8"));
      expect(kit.aiContent.nothingModelGeneratedInAudioOrImages).toBe(false);
    }
    // procedural art written with a model's help is NOT model-generated
    const ok = await buildSite({ outdir: join(out, "x5"), registerText: `${REGISTER.trimEnd()}\n| 2026-10-02 | Characters | art (procedural code) | AI assistant | none | yes |\n` });
    expect(ok.disclosure.nothingModelGenerated).toBe(true);
  });

  it("rows that do not ship are not claimed, and a text-only register still builds", async () => {
    const r = await buildSite({ outdir: join(out, "x6"), registerText: "| Date | Item | Type | Tool | Human edit | Ships? |\n|---|---|---|---|---|---|\n| 2026-01-01 | Words | text | AI | reviewed | yes |\n| 2026-01-01 | Cut | voice | AI | none | no |\n" });
    expect(r.disclosure.lines.map((l) => l.label)).toEqual(["Text"]);
    expect(r.disclosure.pending).toBe(0);
    expect(readFileSync(join(r.outdir, "press.html"), "utf8")).toContain("have been reviewed by the developer");
  });
});

describe("honesty: pre-alpha, no price, no date, no store, no invented contact", () => {
  const text = (): string => PAGES.map((p) => strip(read(p))).join("\n") + read("presskit.json");
  it("says what the state is, and carries no price, date, store link or address", () => {
    const all = text();
    expect(read("index.html")).toMatch(/Pre-alpha/);
    expect(read("index.html")).toMatch(/Release date<\/th><td>None/);
    expect(read("index.html")).toMatch(/Price<\/th><td>None announced/);
    expect(read("index.html")).toMatch(/Store page<\/th><td>None yet/);
    expect(all).toMatch(/Contact<\/th><td>Not yet set up/);
    expect(all).not.toMatch(/[£$€]\s?\d|\d+\s?(GBP|USD|EUR)\b/);
    expect(all).not.toMatch(/store\.steampowered|steamcommunity|itch\.io|epicgames|gog\.com|apps\.apple|play\.google/i);
    expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(all).not.toMatch(/\b(wishlist now|buy now|pre-?order|out now|available now|coming (?:in|on) \d)/i);
    expect(all).not.toMatch(/\b20[2-9]\d-\d\d-\d\d\b/);
  });
  it("the press page's content disclosure is the accurate one", () => {
    const press = read("press.html");
    for (const t of [/heavy, cartoonish and bloody/, /profanity/, /Full, Reduced, Off/, /dismemberment can be switched off/, /gambling, advertising, loot boxes/]) expect(press).toMatch(t);
  });
  it("presskit.json is valid, nulls where there is nothing, and agrees with the disclosure", () => {
    const kit = JSON.parse(read("presskit.json"));
    for (const k of ["releaseDate", "price", "storeUrl", "demo"]) expect(kit[k], k).toBeNull();
    expect(kit.contact).toBe("not yet set up");
    expect(kit.stage).toBe("pre-alpha");
    expect(kit.platforms.published).toEqual([]);
    expect(kit.web).toEqual({ cookies: false, scripts: false, analytics: false, externalRequests: false });
    expect(kit.matureContent.goreSettings).toEqual(["Full", "Reduced", "Off"]);
    expect(kit.monetisation).toMatchObject({ ads: false, lootBoxes: false, payToWin: false, gambling: false, energyTimers: false });
    expect(kit.aiContent.lines.length).toBe(built.disclosure.lines.length);
    expect(kit.aiContent.register.entries).toBe(built.disclosure.entries);
    expect(kit.aiContent.nothingModelGeneratedInAudioOrImages).toBe(true);
  });
  it("the Society's world stays fictional: no real nation, people, faith or place in the copy", () => {
    const BANNED = ["england", "english", "britain", "british", "france", "french", "germany", "german", "spain", "spanish", "russia", "russian", "china", "chinese", "japan", "japanese", "india", "indian", "africa", "african", "europe", "european", "asia", "asian", "america", "american", "arab", "egypt", "london", "paris", "berlin", "rome", "cairo", "delhi", "christian", "muslim", "islam", "jewish", "hindu", "buddhist", "catholic", "mosque", "church", "bible", "koran", "pope", "empire of", "british empire"];
    const re = new RegExp(`(?<![a-z])(?:${BANNED.join("|")})(?![a-z])`, "i");
    for (const p of PAGES) {
      const lines = strip(read(p)).replace(/<[^>]+>/g, " ").split("\n");
      lines.forEach((l, i) => expect(re.test(l), `${p}:${i + 1} ${l.trim().slice(0, 80)}`).toBe(false));
    }
  });
});
