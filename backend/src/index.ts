import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { GameServer } from "./GameServer";

const PORT = Number(process.env.PORT ?? 8080);

const game = new GameServer();

// A tiny HTTP server alongside the WebSocket server so health checks / the
// browser can confirm the backend is up.
const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...game.stats }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("⛵ Sail server running. Connect over WebSocket.");
});

const wss = new WebSocketServer({ server: http });
game.attach(wss);

http.listen(PORT, () => {
  console.log(`⛵ Sail server listening on http://localhost:${PORT}`);
  console.log(`   WebSocket endpoint:  ws://localhost:${PORT}`);
});
