import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 14320,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 14321,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
      // Sources are edited over an sshfs mount, which doesn't emit FSEvents, so
      // the default native watcher never sees the change and HMR shows stale UI.
      // Poll mtimes instead so edits hot-reload reliably.
      usePolling: true,
      interval: 300,
    },
  },
}));
