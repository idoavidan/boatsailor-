import { ClientMessage, ServerMessage } from "../protocol";

type Handler = (msg: ServerMessage) => void;

const DEFAULT_URL = import.meta.env.VITE_SERVER_URL ?? defaultServerUrl();

/**
 * Where to reach the game backend when VITE_SERVER_URL isn't set.
 * In dev, Vite serves the client separately from the backend (which listens on
 * :8080). In production the backend serves this page too, so the socket is
 * same-origin — and must use `wss://` when the page is loaded over HTTPS.
 */
function defaultServerUrl(): string {
  if (import.meta.env.DEV) {
    return `ws://${location.hostname}:8080`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

/**
 * Thin typed wrapper around the game WebSocket. Buffers outgoing messages
 * until the socket opens and dispatches incoming messages to a handler.
 */
export class Network {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private handler: Handler | null = null;

  onMessage(handler: Handler): void {
    this.handler = handler;
  }

  connect(url = DEFAULT_URL): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        for (const m of this.queue) socket.send(JSON.stringify(m));
        this.queue = [];
        resolve();
      });

      socket.addEventListener("message", (ev) => {
        if (!this.handler) return;
        try {
          this.handler(JSON.parse(ev.data) as ServerMessage);
        } catch {
          /* ignore malformed frame */
        }
      });

      socket.addEventListener("error", () => reject(new Error("connection failed")));
      socket.addEventListener("close", () => {
        this.socket = null;
      });
    });
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.queue.push(message);
    }
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
