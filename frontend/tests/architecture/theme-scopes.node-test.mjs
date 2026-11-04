import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { compile, optimize } from "@tailwindcss/node";
import { resolveConfig } from "vite";
import { themeScopes } from "../../scripts/theme-scopes.ts";

let plugins;
let generated;

before(async () => {
  const config = await resolveConfig({ configFile: false, plugins: [themeScopes()], logLevel: "silent" }, "serve");
  assert.equal(typeof config.css.postcss, "object");
  plugins = config.css.postcss.plugins;
  const entry = fileURLToPath(new URL("../../src/styles/globals.css", import.meta.url));
  const compiler = await compile(readFileSync(entry, "utf8"), { base: fileURLToPath(new URL("../../src/styles/", import.meta.url)), onDependency() {} });
  generated = compiler.build(["dark:bg-input/30", "dark:hover:bg-input/50", "dark:aria-invalid:border-destructive/50", "hover:dark:text-muted-foreground", "md:dark:bg-input/30"]);
});

test("real Tailwind theme scopes retain the utility selector, root and state conditions", async () => {
  const result = await postcss(plugins).process(generated, { from: undefined });
  const scopes = [];
  result.root.walkAtRules("scope", scope => {
    for (let parent = scope.parent; parent; parent = parent.parent) assert.notEqual(parent.type, "rule");
    scopes.push(scope.toString());
  });
  assert.equal(scopes.length, 5);
  assert.ok(result.css.includes(":scope:is(.dark\\:bg-input\\/30)"));
  assert.ok(result.css.includes("&:hover"));
  assert.ok(result.css.includes("[aria-invalid"));
});

test("production optimization retains plain and compound dark utility gates", async () => {
  const result = await postcss(plugins).process(generated, { from: undefined });
  const built = optimize(result.css, { minify: true }).code;
  for (const gate of [".dark\\:bg-input", ".dark\\:hover\\:bg-input", ".dark\\:aria-invalid\\:border-destructive", ".hover\\:dark\\:text-muted-foreground", ".md\\:dark\\:bg-input"]) assert.ok(built.includes(gate), gate);
});

test("ordinary authored scopes stay intact and merged Vite plugins do not scope utilities twice", async () => {
  const authored = '.card { @scope (.section) to (.limit) { color: inherit; } }';
  assert.equal((await postcss(plugins).process(authored, { from: undefined })).css, authored);
  const once = (await postcss(plugins).process(generated, { from: undefined })).css;
  const twice = (await postcss(plugins).process(once, { from: undefined })).css;
  assert.equal(twice, once);
});
