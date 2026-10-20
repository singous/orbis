import { build } from "esbuild";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));
const dependencies = { name: "shared-codec-dependencies", setup(builder) {
  builder.onResolve({ filter: /^(@tiptap\/pm(?:\/.*)?|zod|prosemirror-[a-z-]+|yjs|lib0\/hash\/sha256)$/ }, ({ path }) => ({ path: require.resolve(path) }));
} };
const common = {
  bundle: true, platform: "node", target: "node24", format: "esm", plugins: [dependencies], logLevel: "info",
  banner: { js: "import { createRequire as orbisCreateRequire } from 'node:module'; const require = orbisCreateRequire(import.meta.url);" },
};
await build({ ...common, entryPoints: [resolve(root, "src/server.ts"), resolve(root, "src/worker.ts")], outdir: resolve(root, "dist"), outExtension: { ".js": ".mjs" } });
if (process.argv.includes("--tests")) {
  const files = (await readdir(resolve(root, "tests"))).filter(file => file.endsWith(".test.ts"));
  await build({ ...common, entryPoints: files.map(file => resolve(root, "tests", file)), outdir: resolve(root, "dist-tests"), outExtension: { ".js": ".mjs" } });
}
