import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const apiTarget = process.env.ORBIS_DEV_API_TARGET || "http://127.0.0.1:9201";
const proxy = {
  "/api": { target: apiTarget, changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/, "") },
  "/public/sites": { target: apiTarget, changeOrigin: true },
  "^/s(?:/|$)": { target: apiTarget, changeOrigin: true },
  "^/robots\\.txt$": { target: apiTarget, changeOrigin: true },
  "/assets/": { target: apiTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          editor: [
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-placeholder",
            "@tiptap/extension-link",
            "@tiptap/extension-task-list",
            "@tiptap/extension-task-item",
            "@tiptap/extension-table",
            "@tiptap/extension-table-row",
            "@tiptap/extension-table-cell",
            "@tiptap/extension-table-header",
            "marked",
          ],
          query: ["@tanstack/react-query", "zustand"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 9200,
    strictPort: true,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 9200,
    strictPort: true,
    proxy,
  },
  test: {
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
