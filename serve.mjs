import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT || 8974);
const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    const filepath = normalize(join(root, requested));

    if (!filepath.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filepath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filepath);
    response.writeHead(200, {
      "Content-Type": types[extname(filepath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 — fails nav atrasts");
  }
}).listen(port, () => {
  console.log(`Pixel Level Tool: http://localhost:${port}`);
});
