import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "web",
  publicDir: false,
  build: {
    emptyOutDir: true,
    outDir: "../dist/client",
  },
  server: {
    fs: { allow: [resolve(".")] },
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/static": "http://localhost:8000",
    },
  },
});
