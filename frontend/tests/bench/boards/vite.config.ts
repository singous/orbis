import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  build: {
    outDir: fileURLToPath(
      new URL("../../../../.dev/board-benchmark/dist", import.meta.url),
    ),
    emptyOutDir: true,
  },
  preview: { host: "127.0.0.1", port: 9321, strictPort: true },
});
