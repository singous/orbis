import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyUsage, licensePolicy, parseSourcePins } from "../../scripts/license-core.mjs";

test("SPDX expressions are parsed before policy is applied", () => {
  assert.equal(licensePolicy("MIT OR (Apache-2.0 AND BSD-3-Clause)"), "permissive");
  assert.equal(licensePolicy("EPL-2.0 OR GPL-3.0-or-later"), "review-required");
  assert.equal(licensePolicy("MIT AND Proprietary"), "denied");
  for (const value of ["", "MIT Apache-2.0", "MIT OR", "(MIT", "MIT, Apache-2.0"]) assert.throws(() => licensePolicy(value));
});

test("workspace, optional binary and build dependencies retain their distribution scope", () => {
  const packages = {
    "": { dependencies: { "@orbis/ui": "0.0.1", "@tailwindcss/vite": "1" }, devDependencies: { storybook: "1", "@iconify-json/tabler": "1" } },
    "node_modules/@orbis/ui": { link: true, resolved: "packages/ui" },
    "packages/ui": { dependencies: { "@base-ui/react": "1" }, peerDependencies: { react: "1" } },
    "node_modules/@base-ui/react": { dependencies: { shared: "1" } },
    "node_modules/react": {},
    "node_modules/shared": {},
    "node_modules/@tailwindcss/vite": { dependencies: { lightningcss: "1" } },
    "node_modules/lightningcss": { optionalDependencies: { "lightningcss-linux-x64": "1" } },
    "node_modules/lightningcss-linux-x64": {},
    "node_modules/storybook": { dependencies: { shared: "1" } },
    "node_modules/@iconify-json/tabler": {},
  };
  const usage = dependencyUsage(packages);
  assert.deepEqual([...usage.get("node_modules/@base-ui/react")], ["runtime"]);
  assert.deepEqual([...usage.get("node_modules/shared")], ["runtime", "dev-only"]);
  assert.deepEqual([...usage.get("node_modules/lightningcss-linux-x64")], ["build-only"]);
  assert.deepEqual([...usage.get("node_modules/@iconify-json/tabler")], ["asset"]);
});

test("corresponding source pins require real immutable revisions, checksums and separate filenames", () => {
  const valid = `elkjs\t0.12.0\tsha512-abc=\t${"a".repeat(40)}\thttps://example.com/source.tar.gz\t${"b".repeat(64)}\telkjs-source.tar.gz`;
  assert.equal(parseSourcePins(valid)[0].destination, "elkjs-source.tar.gz");
  assert.deepEqual(parseSourcePins("# not approved yet\n"), []);
  assert.throws(() => parseSourcePins(valid.replace("a".repeat(40), "main")));
  assert.throws(() => parseSourcePins(valid.replace("elkjs-source.tar.gz", "../../source.tgz")));
});
