import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: path.resolve(__dirname, "../dist/web"), emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:4242", changeOrigin: false } } },
});
