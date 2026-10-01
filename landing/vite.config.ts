import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Превью-хосты Arena: {port}-{sandboxId}.e2b.app
    allowedHosts: true,
  },
  preview: {
    host: true,
    // Тот же список, что и для dev: preview-сервер иначе отклоняет
    // прокси-хост по Host-заголовку.
    allowedHosts: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
  build: {
    target: "es2020",
    // §2.3: source maps publish readable game/economy source. Off in every
    // environment, stated explicitly so an upgrade cannot default it back on.
    sourcemap: false,
  },
});
