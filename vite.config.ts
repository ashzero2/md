import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error test config typing
import type { UserConfig } from "vitest/config";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const config: UserConfig = {
  plugins: [react()],
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
