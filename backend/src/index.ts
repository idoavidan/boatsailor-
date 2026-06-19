import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer } from "ws";
import { GameServer } from "./GameServer";

const PORT = Number(process.env.PORT ?? 8080);

// Built three.js client. The backend serves it so the whole game ships as a
// single service — which also keeps the WebSocket same-origin in production.
const CLIENT_DIR =
  process.env.CLIENT_DIR ?? join(__dirname, "../../frontend/dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const game = new GameServer();

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...game.stats }));
    return;
  }
  serveClient(req, res);
});

/**
 * Serve the built client as static files, falling back to index.html so the
 * app loads at any path. If the client hasn't been built, return a hint.
 */
function serveClient(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const resolved = normalize(join(CLIENT_DIR, urlPath));

  // Guard against path traversal, then prefer a real file; otherwise fall back
  // to index.html (single-page entry).
  const withinRoot = resolved === CLIENT_DIR || resolved.startsWith(CLIENT_DIR + sep);
  const isFile = withinRoot && existsSync(resolved) && statSync(resolved).isFile();
  const filePath = isFile ? resolved : join(CLIENT_DIR, "index.html");

  if (!existsSync(filePath)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("⛵ Sail server running. Build the frontend to serve the game here.");
    return;
  }

  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const wss = new WebSocketServer({ server: http });
game.attach(wss);

http.listen(PORT, () => {
  console.log(`⛵ Sail server listening on http://localhost:${PORT}`);
  console.log(`   WebSocket endpoint:  ws://localhost:${PORT}`);
  console.log(`   Serving client from: ${CLIENT_DIR}`);
});
