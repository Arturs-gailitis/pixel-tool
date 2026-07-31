import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { gradeWithGame } from "./game-difficulty.js";
import { generateLevelImage } from "./image-generation.js";

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
  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/api/difficulty" && request.method === "POST") {
      const body = await readJsonBody(request);
      const report = gradeWithGame(body.level || body, {
        randomRuns: body.randomRuns,
        maxTicks: body.maxTicks
      });
      sendJson(response, 200, report);
      return;
    }
    if (pathname === "/api/generate-image" && request.method === "POST") {
      const body = await readJsonBody(request);
      const image = await generateLevelImage(body.prompt, {
        accountId: body.accountId,
        apiToken: body.apiToken
      });
      sendJson(response, 200, image);
      return;
    }
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
  } catch (error) {
    if (pathname.startsWith("/api/")) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
      sendJson(response, status, { error: String(error.message || error) });
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 — fails nav atrasts");
  }
}).listen(port, () => {
  console.log(`Pixel Level Tool: http://localhost:${port}`);
});

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("Pieprasījums ir pārāk liels");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}
