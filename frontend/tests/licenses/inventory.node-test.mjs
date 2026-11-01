import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distributionSource, verifyLicenseBundle, writeLicenseBundleIndex } from "../../scripts/license-bundle.mjs";

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
  write("licenses/embedded-notices.json", { components: [] });
  write("licenses/sources/packages.tsv", "# no source pins\n");
  write("licenses/texts/copied.txt", "Copied code license\n");
  write("licenses/copied-code/shadcn-button.registry.json", "source snapshot");
  const registry = {
    license: "MIT", copyright: "Fixture author", licenseFile: "licenses/texts/copied.txt",
    sourceRepository: "https://github.com/example/ui",
    timestampUnit: "unix-ms",
    timestampSemantics: { addedAt: "Git author time of first local introduction", updatedAt: "Git author time of latest direct implementation change" },
    sourceRevisionSemantics: "Reproducible upstream content; servedRevision is null when the historical deployment is unknown",
    components: { button: {
      source: "https://example.com/button.json", sourceRevision: "a".repeat(40), sourceRevisionKind: "reproducible-content", servedRevision: null,
      sourceChecksum: `sha256:${createHash("sha256").update("source snapshot").digest("hex")}`,
      addedAt: 1793476336000, updatedAt: 1793482834000, modifications: "fixture", status: "experimental",
    } },
  };
  write("frontend/packages/ui/ui.registry.json", registry);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ORBIS_LICENSE_ROOT: root, ORBIS_SOURCE_REVISION: "a".repeat(40) }, encoding: "utf8" });
  return { root, write, run, registry };
}

test("copied UI provenance preserves distinct immutable revisions in a distribution bundle", t => {
  const { root, write, run, registry } = fixture(t);
  registry.components.button.sourceRevision = "b".repeat(40);
  registry.components.button.servedRevision = "c".repeat(40);
  registry.sourceRepository = "https://code.example.com/another/ui.git";
  write("frontend/packages/ui/ui.registry.json", registry);
  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  const bundled = run("--bundle", "dist/licenses");
  assert.equal(bundled.status, 0, bundled.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "frontend/dist/licenses/frontend/packages/ui/ui.registry.json"), "utf8")), registry);
});

test("copied UI provenance rejects missing or mutable upstream revision metadata offline", async t => {
  for (const [field, value] of [["sourceRevision", undefined], ["sourceRevision", "main"], ["sourceRevisionKind", undefined], ["servedRevision", undefined], ["servedRevision", "main"]]) {
    await t.test(`${field}=${value}`, t => {
      const { write, run, registry } = fixture(t);
      registry.components.button[field] = value;
      write("frontend/packages/ui/ui.registry.json", registry);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Copied UI source record is incomplete: button/);
    });
  }
});

test("copied UI provenance requires defined millisecond events and ordered integer timestamps", async t => {
  const cases = [
    ["seconds", registry => { registry.timestampUnit = "unix-seconds"; }, /Copied UI provenance semantics/],
    ["missing event", registry => { delete registry.timestampSemantics.updatedAt; }, /Copied UI provenance semantics/],
    ["missing source semantics", registry => { delete registry.sourceRevisionSemantics; }, /Copied UI provenance semantics/],
    ["missing timestamp", registry => { delete registry.components.button.addedAt; }, /Copied UI timestamps/],
    ["string timestamp", registry => { registry.components.button.addedAt = "1793476336000"; }, /Copied UI timestamps/],
    ["fractional timestamp", registry => { registry.components.button.updatedAt += 0.5; }, /Copied UI timestamps/],
    ["reversed events", registry => { registry.components.button.updatedAt = registry.components.button.addedAt - 1; }, /Copied UI timestamps/],
  ];
  for (const [name, mutate, error] of cases) {
    await t.test(name, t => {
      const { write, run, registry } = fixture(t);
      mutate(registry);
      write("frontend/packages/ui/ui.registry.json", registry);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
    });
  }
});

test("copied UI provenance validates the source URL and frozen artifact checksum offline", async t => {
  for (const sourceRepository of [undefined, "http://example.com/ui", "https://"]) {
    await t.test(`repository=${sourceRepository}`, t => {
      const { write, run, registry } = fixture(t);
      registry.sourceRepository = sourceRepository;
      write("frontend/packages/ui/ui.registry.json", registry);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Copied UI source repository must be a valid HTTPS URL/);
    });
  }
  for (const source of ["http://example.com/button.json", "https://", "licenses/copied-code/button.json"]) {
    await t.test(source, t => {
      const { write, run, registry } = fixture(t);
      registry.components.button.source = source;
      write("frontend/packages/ui/ui.registry.json", registry);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Copied UI source record is incomplete: button/);
    });
  }
  await t.test("changed snapshot", t => {
    const { write, run } = fixture(t);
    assert.equal(run().status, 0);
    write("licenses/copied-code/shadcn-button.registry.json", "changed source snapshot");
    const result = run("--check");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Copied UI source snapshot checksum mismatch: button/);
  });
});

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
  const bundle = path.join(root, "frontend/dist/licenses");
  assert.equal(verifyLicenseBundle(bundle).sourceRevision, "a".repeat(40));
  const html = readFileSync(path.join(bundle, "index.html"), "utf8");
  assert.match(html, /开源许可/);
  assert.ok(html.includes(`https://github.com/singous/orbis/archive/${"a".repeat(40)}.tar.gz`));
  assert.ok(existsSync(path.join(bundle, "frontend/public/licenses/inter-OFL-1.1.txt")));
  assert.ok(existsSync(path.join(bundle, "frontend/packages/ui/ui.registry.json")));
});

test("release source links require a full immutable commit identity", () => {
  for (const revision of [undefined, "main", "a1b2c3d", "https://example.com"]) assert.throws(() => distributionSource(revision), /ORBIS_SOURCE_REVISION/);
});

test("distribution verification detects changed and omitted files after packaging", t => {
  const { root, run } = fixture(t);
  assert.equal(run().status, 0);
  const bundled = run("--bundle", "dist/licenses");
  assert.equal(bundled.status, 0, bundled.stderr);
  const bundle = path.join(root, "frontend/dist/licenses");
  writeFileSync(path.join(bundle, "LICENSE"), "replaced project license");
  assert.throws(() => verifyLicenseBundle(bundle), /checksum mismatch: LICENSE/);
  rmSync(path.join(bundle, "LICENSE"));
  assert.throws(() => verifyLicenseBundle(bundle), /files missing: LICENSE/);
});

test("distribution notice content must match its frozen dependency identity", t => {
  const { root, run } = fixture(t);
  assert.equal(run().status, 0);
  const bundled = run("--bundle", "dist/licenses");
  assert.equal(bundled.status, 0, bundled.stderr);
  const bundle = path.join(root, "frontend/dist/licenses");
  const inventory = JSON.parse(readFileSync(path.join(bundle, "licenses/npm-manifest.json"), "utf8"));
  writeFileSync(path.join(bundle, inventory.packages[0].texts[0].file), "different upstream license");
  writeLicenseBundleIndex(bundle, distributionSource("a".repeat(40)));
  assert.throws(() => verifyLicenseBundle(bundle), /notice differs from inventory/);
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

test("retains acknowledgements that document bundled third-party code", t => {
  const { root, write, run } = fixture(t);
  write("frontend/node_modules/example/ACKNOWLEDGMENTS", "Bundled source acknowledgement\n");
  assert.equal(run().status, 0);
  const manifest = JSON.parse(readFileSync(path.join(root, "licenses/npm-manifest.json"), "utf8"));
  const example = manifest.packages.find(item => item.name === "example");
  assert.ok(example.texts.some(text => text.source === "node_modules/example/ACKNOWLEDGMENTS"));
  assert.equal(run("--check").status, 0);
});
