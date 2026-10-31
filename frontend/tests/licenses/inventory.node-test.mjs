import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/license-inventory.mjs", import.meta.url));
function fixture(t, license = "MIT") {
  const root = mkdtempSync(path.join(tmpdir(), "orbis-license-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content)); };
  const assets = ["@fontsource-variable/inter", "lucide-react", "@gravity-ui/icons", "@iconify-json/tabler", "@remixicon/react"];
  const packages = Object.fromEntries(["example", ...assets].map(name => [`node_modules/${name}`, { version: "1.0.0", license: name === "example" ? license : "MIT", integrity: "sha512-Zml4dHVyZQ==", resolved: `https://example.com/${name}.tgz` }]));
  write("frontend/package-lock.json", { packages: { "": { dependencies: Object.fromEntries(["example", ...assets].map(name => [name, "1.0.0"])) }, ...packages } });
  for (const [location, entry] of Object.entries(packages)) { write(`frontend/${location}/package.json`, entry); write(`frontend/${location}/LICENSE`, "Fixture license and copyright\n"); }
  write("LICENSE", "Project license\n");
  write("THIRD_PARTY_NOTICES.md", "# Notices\n");
  write("licenses/supplemental-texts.json", { packages: {} });
  write("licenses/reviews.json", { packages: {} });
  write("licenses/material-gaps.json", { packages: {} });
  write("licenses/sources/packages.tsv", "# no source pins\n");
  write("licenses/texts/copied.txt", "Copied code license\n");
  write("licenses/copied-code/shadcn-button.registry.json", "source snapshot");
  write("frontend/packages/ui/ui.registry.json", { license: "MIT", copyright: "Fixture author", licenseFile: "licenses/texts/copied.txt", components: { button: { source: "https://example.com/button.json", sourceChecksum: `sha256:${createHash("sha256").update("source snapshot").digest("hex")}`, modifications: "fixture" } } });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ORBIS_LICENSE_ROOT: root }, encoding: "utf8" });
  return { root, write, run };
}

test("offline checking uses frozen license text and verifies the lockfile, notice and hashes", t => {
  const { root, write, run } = fixture(t);
  assert.equal(run().status, 0);
  rmSync(path.join(root, "frontend/node_modules"), { recursive: true });
  assert.equal(run("--check", "--release").status, 0);
  write("THIRD_PARTY_NOTICES.md", "# stale\n");
  const result = run("--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notice inventory is stale/);
});

test("pending reviews block bundling before any distribution output is written", t => {
  const { root, run } = fixture(t, "MPL-2.0");
  assert.equal(run().status, 0);
  assert.equal(run("--check").status, 0);
  const result = run("--bundle", "dist/licenses");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Maintainer review pending: example@1.0.0/);
  assert.equal(existsSync(path.join(root, "frontend/dist/licenses")), false);
});

test("an approved permissive inventory produces a readable distribution bundle", t => {
  const { root, run } = fixture(t);
  assert.equal(run().status, 0);
  assert.equal(run("--bundle", "dist/licenses").status, 0);
  assert.equal(readFileSync(path.join(root, "frontend/dist/licenses/LICENSE"), "utf8"), "Project license\n");
  assert.ok(readFileSync(path.join(root, "frontend/dist/licenses/THIRD_PARTY_NOTICES.md"), "utf8").includes("Locked npm components"));
  assert.ok(JSON.parse(readFileSync(path.join(root, "frontend/dist/licenses/licenses/npm-manifest.json"), "utf8")).packages.length > 0);
  assert.equal(JSON.parse(readFileSync(path.join(root, "frontend/dist/licenses/index.json"), "utf8")).assets.length, 5);
});

test("tampering with frozen upstream license text is rejected offline", t => {
  const { root, write, run } = fixture(t);
  assert.equal(run().status, 0);
  const manifest = JSON.parse(readFileSync(path.join(root, "licenses/npm-manifest.json"), "utf8"));
  write(manifest.packages[0].texts[0].file, "changed license");
  assert.match(run("--check").stderr, /checksum mismatch/);
});

test("review records cannot omit a corresponding-source decision", t => {
  const { write, run } = fixture(t, "MPL-2.0");
  assert.equal(run().status, 0);
  write("licenses/reviews.json", { packages: { "example@1.0.0": { status: "approved", approvedBy: "fixture maintainer", approvedAt: "2026-11-01", selectedLicense: "MPL-2.0", conclusion: "fixture decision" } } });
  assert.match(run("--check", "--release").stderr, /Maintainer review pending/);
});
