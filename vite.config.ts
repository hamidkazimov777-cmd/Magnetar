import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        // Monaco is large and loaded lazily; keeping it in its own chunk means
        // the editor's ~4 MB does not sit in the same file as the rest of the
        // UI, and the app shell parses without waiting on it.
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor")) return "monaco";
        },
      },
    },
    // The Monaco chunk is deliberately large; the warning at 500 kB is noise for
    // a lazily-loaded editor, so raise it above the shell's real size.
    chunkSizeWarningLimit: 1200,
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
