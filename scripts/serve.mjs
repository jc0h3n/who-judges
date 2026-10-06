// Tiny static server for local preview: node scripts/serve.mjs  ->  http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../site/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = +process.env.PORT || 8080;

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if (path.startsWith("..")) { res.writeHead(403).end(); return; }
  try {
    const file = join(root, path || "index.html");
    const body = await readFile(file.endsWith("\\") || file.endsWith("/") ? join(file, "index.html") : file);
    res.writeHead(200, { "Content-Type": (types[extname(file)] || "application/octet-stream") + "; charset=utf-8" }).end(body);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Serving site/ at http://localhost:${port}`));
