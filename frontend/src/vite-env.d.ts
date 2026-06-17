/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the game backend, e.g. ws://localhost:8080 */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
