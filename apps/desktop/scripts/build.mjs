// Bundles the shell: src/entry.ts -> dist/main.cjs (Node, `electron` external) and src/preload.ts -> dist/preload.cjs (sandboxed preload: only `electron` may be required).
// `@cb/shared` is TypeScript source and is inlined. CB_SERVER_URL / CB_WISHLIST_URL at BUILD time become the packaged app's defaults (validated; an invalid value is dropped).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const https = (v) => {
  try {
    const u = new URL(v ?? "");
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
};
const server = (v) => {
  try {
    const u = new URL((v ?? "").trim().replace(/^ws(s?):/i, "http$1:"));
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password ? u.origin : "";
  } catch {
    return "";
  }
};

export async function buildDesktop({ outdir = join(root, "dist"), env = process.env, logLevel = "info" } = {}) {
  const define = {
    __CB_SERVER_URL__: JSON.stringify(server(env.CB_SERVER_URL)),
    __CB_WISHLIST_URL__: JSON.stringify(https(env.CB_WISHLIST_URL)),
  };
  const common = { bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: false, minify: false, external: ["electron"], define, logLevel, absWorkingDir: root };
  await build({ ...common, entryPoints: ["src/entry.ts"], outfile: join(outdir, "main.cjs") });
  // the preload is not Node: it runs in the sandbox with a tiny `require` (electron only)
  await build({ ...common, entryPoints: ["src/preload.ts"], outfile: join(outdir, "preload.cjs"), platform: "browser", mainFields: ["module", "main"], conditions: ["module"], define: { ...define, "process.env.NODE_ENV": '"production"' } });
  return outdir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildDesktop();
