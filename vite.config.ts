import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error test config typing
import type { UserConfig } from "vitest/config";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const config: UserConfig = {
  plugins: [react()],
  build: {
    // CodeMirror 6 core (state + view + language + autocomplete) totals ~1.7 MB
    // minified. This is an accepted size for a desktop editor — the bundle is
    // loaded from disk, not the network. Language support files are already
    // split into separate dynamic chunks by @codemirror/language-data.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // Split large vendor chunks so the main bundle stays under 500 kB.
        // Tauri loads these from disk so the split is about parse/eval time,
        // not network latency.
        manualChunks(id: string) {
          if (
            id.includes("@uiw/react-codemirror") ||
            id.includes("@codemirror/") ||
            id.includes("@lezer/")
          ) {
            return "codemirror";
          }
          if (
            id.includes("unified") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("mdast") ||
            id.includes("hast") ||
            id.includes("unist")
          ) {
            return "markdown";
          }
          if (id.includes("highlight.js")) {
            return "highlight";
          }
          if (id.includes("katex")) {
            return "katex-vendor";
          }
          if (id.includes("react-dom") || (id.includes("react") && !id.includes("react-markdown"))) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
};

export default defineConfig(async () => config);
