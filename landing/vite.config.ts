import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// Куда dev/preview-сервер проксирует /api/*. В проде этим занимается
// Cloudflare Pages Function (functions/api/[[path]].js) с тем же префиксом
// пути, поэтому локальный сценарий и продовый не расходятся.
const presaleApiTarget = process.env.PRESALE_API_ORIGIN || "http://127.0.0.1:8080";

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
    proxy: {
      "/api": { target: presaleApiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    // Тот же список, что и для dev: preview-сервер иначе отклоняет
    // прокси-хост по Host-заголовку.
    allowedHosts: true,
    proxy: {
      "/api": { target: presaleApiTarget, changeOrigin: true },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
  build: {
    target: "es2020",
    // §2.3: source maps publish readable game/economy source. Off in every
    // environment, stated explicitly so an upgrade cannot default it back on.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep independently cacheable, high-fanout vendors out of the app
        // entry chunk without weakening Vite's default size warning threshold.
        manualChunks: {
          react: ["react", "react-dom"],
          motion: ["framer-motion", "lenis"],
          solana: ["@solana/web3.js", "@solana/spl-token", "@solana/buffer-layout-utils"],
          locales: ["en.ts", "es-419.ts", "id.ts", "pt-BR.ts", "tl.ts", "vi.ts"].map((file) =>
            resolve(projectRoot, "i18n/strings", file),
          ),
        },
      },
    },
  },
});
