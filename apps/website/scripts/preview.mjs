// Serves dist/ on http://127.0.0.1:5190 for a look (GET only, files under dist/ only). Not part of any build.
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const port = Number(process.env.PORT ?? 5190);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const base = await realpath(dist);
    const file = await realpath(join(base, rel));
    if (!file.startsWith(base + sep)) throw new Error("outside");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`[website] http://127.0.0.1:${port}`));
