import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

const apiTarget = process.env.ORBIS_DEV_API_TARGET || "http://127.0.0.1:9202";
const proxy = {
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    ws: true,
    configure(proxy) {
      proxy.on("proxyReqWs", (proxyReq, req) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        // 只映射本地同源连接；其他来源继续交给上游校验。
        if (!host || (origin !== `http://${host}` && origin !== `https://${host}`)) return;
        proxyReq.setHeader("origin", new URL(apiTarget).origin);
      });
    },
  },
  "/public/sites": { target: apiTarget, changeOrigin: true },
  "^/s(?:/|$)": { target: apiTarget, changeOrigin: true },
  "^/robots\\.txt$": { target: apiTarget, changeOrigin: true },
} satisfies Record<string, ProxyOptions>;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: process.env.ORBIS_E2E_DIR || process.env.VITEST ? false : undefined,
  optimizeDeps: {
    entries: ["index.html"],
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          editor: [
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-code-block",
            "@tiptap/extension-underline",
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
    exclude: [...configDefaults.exclude, "tests/e2e/**", "test-results/**", "docs/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
