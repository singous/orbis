import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const web = resolve(root, "../../..");
const frozenStyles = process.env.ORBIS_BENCH_STYLES;
const conversionSource = process.env.ORBIS_BENCH_MODEL;
export default defineConfig({
  root,
  plugins: [
    {
      name: "benchmark-source-adapters",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "benchmark:draft") return "\0benchmark:draft";
        if (conversionSource && importer && source.endsWith("tiptap-model")) return conversionSource;
        if (frozenStyles && importer && source.endsWith(".css")) {
          const original = resolve(dirname(importer), source);
          const prefix = resolve(web, "src/styles") + "/";
          if (original.startsWith(prefix)) return resolve(frozenStyles, original.slice(prefix.length));
        }
      },
      load(id) {
        if (id !== "\0benchmark:draft") return;
        const implementation = resolve(web, "src/features/documents/editor-draft.ts");
        return existsSync(implementation)
          ? `export { createEditorDraftFingerprint } from ${JSON.stringify(implementation)};`
          : "export const createEditorDraftFingerprint = () => draft => JSON.stringify([draft.title.trim(), draft.blocks]);";
      },
    },
    react(), tailwindcss(),
  ],
  build: { outDir: process.env.ORBIS_BENCH_DIST || resolve(web, "test-results/editor-benchmark"), emptyOutDir: true },
});
