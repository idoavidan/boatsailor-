import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: true, // expose on the LAN so others can join from another device
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
