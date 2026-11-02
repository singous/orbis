# Third-party license materials

The frontend license inventory is derived from `frontend/package-lock.json`. It is separate from Orbis's own AGPL-3.0-only license. Run commands from `frontend/`:

```sh
npm run licenses:generate
npm run report:licenses
npm run check:licenses
ORBIS_SOURCE_REVISION="$(git rev-parse HEAD)" npm run build:release
npm run check:license-bundle
```

`licenses:generate` updates the manifest, the generated table in `THIRD_PARTY_NOTICES.md`, and public font/icon notices. It freezes texts by package name/version/integrity. Generation reads the available installed artifact's license, NOTICE and acknowledgement files, and retains the previous frozen material when an optional platform package is unavailable. Checking reads only the frozen inventory and works without node_modules. Packages whose tarballs omit their license text need an explicit entry in `supplemental-texts.json`, with a fixed upstream commit, URL and content checksum. The generator does not download or invent missing text.

`report:licenses` is an offline snapshot check. It verifies the lockfile hash, every package version/license/integrity, text checksums, public asset notices and copied-code snapshots. It reports full `inventoryComplete` separately from frontend `distributionReady`, with `distributionIssues` and `toolingIssues`. The retained `releaseReady` field is an alias for this frontend distribution readiness, not a statement that the complete tool inventory has no open items.

`check:licenses` adds the frontend distribution policy: components classified as `browser-js` or `static-assets` cannot have missing text, unknown/denied licenses, incomplete license assessments or missing required source pins. Build/test-only issues remain visible in the full inventory and tooling report; they do not represent software copied into the static frontend. The classification is a conservative declared-dependency closure, not a claim that every runtime dependency byte survives tree shaking. `licenses:bundle` runs the distribution check before creating output, then copies `LICENSE`, `THIRD_PARTY_NOTICES.md` and the full inventory, including its tooling issues. It downloads the separately pinned source archives and checks each SHA-256.

`build:release` performs the strict check, production build, license bundling and artifact verification. `ORBIS_SOURCE_REVISION` must be the full commit SHA whose complete source and build materials have been published in the Orbis repository. The generated `/licenses/` page links to that exact revision and its source archive. Use a clean checkout of that published commit for a release. The ordinary `build` command remains available for development previews.

The frontend Docker target uses the same release build. Supply `--build-arg ORBIS_SOURCE_REVISION="$(git rev-parse HEAD)"` when building it. The final nginx stage copies only `frontend/dist/`, without build/test `node_modules` or Storybook output. It carries the bundle at `/usr/share/nginx/html/licenses/`; CI extracts that directory from the built image and runs the same verifier against its files. The independent PR license gate runs offline. Distributing a build/test image or tool package is a different distribution scope and requires evaluating those components rather than reusing the static-frontend readiness result.

`check:license-bundle [directory]` verifies the shipped file hashes, dependency notices, asset notices, corresponding-source archives, source links and lockfile identity. The bundle preserves repository-relative notice links, including the copied-code provenance and public font/icon texts. Its generated `distribution.json` records every bundled file's checksum.

## Files and ownership

- `npm-manifest.json`: generated dependency records. Runtime, build-only, development and asset owners are calculated from the lockfile dependency graph, including workspace links, peers and optional binaries. This is a conservative declared-dependency classification, not a claim that every dependency byte survives tree shaking.
- `texts/npm/`: verbatim package/upstream license and NOTICE files, named by SHA-256. Copyright notices remain in the original text.
- `supplemental-texts.json`: manually recorded evidence for omitted upstream texts. The generator accepts a record only for a matching package version and declared license.
- `embedded-notices.json`: attributable notices for code bundled inside a dependency; these do not replace the enclosing package's own license.
- `material-gaps.json`: precise evidence for unresolved missing upstream notices.
- `pending-review-summary.json`: generated, lockfile-bound distribution readiness and full inventory/tooling issues. Existing material gaps and pending tooling records are retained.
- `reviews.json`: engineering assessments and actual maintainer approvals are distinct. An engineering assessment records its actor, Unix-millisecond time, selected license, conclusion and explicit source-availability decision; it does not fabricate a human approval or provide a legal guarantee. A human approval retains its actual reviewer/date fields. An OR expression may elect a declared branch; an AND expression cannot discard one of its obligations.
- `sources/packages.tsv`: assessed source-availability pins. Each non-comment row has tab-separated name, version, npm artifact integrity, source commit, source URL, source SHA-256 and bundle filename. The npm artifact remains distinct from editable source/build materials.
- `sources/elkjs-review.md` and `sources/elkjs-build.md`: the existing layout engine's official-version source availability, demonstrated build path and historical-reproduction limits.
- `copied-code/`: immutable downloaded shadcn registry snapshots. Their SHA-256 must match `frontend/packages/ui/ui.registry.json`; the MIT text is retained separately. Local component adaptations do not overwrite these source snapshots.

## Current unresolved material

`stackback` 0.0.2 and optional `@tybys/wasm-util` 0.10.2 declare permissive SPDX identifiers, but their published package/release sources do not contain an attributable full license text in the inspected locations. The inventory leaves those gaps visible instead of creating a generic MIT notice. These packages are test-only and build-only respectively, so their material issues do not block the static frontend distribution. The former `client-only` gap disappeared with the actual HeroUI dependency removal; it is not in the inventory or pending summary.

The 15 build/test MPL and CC-BY records remain pending in the tooling report; their license texts are retained. The existing unmodified runtime `elkjs` 0.12.0 has an explicit engineering assessment selecting its declared EPL-2.0 option. Three official source/build archives are pinned and made available through the public license page. Historical checkout reconstruction and byte-identical worker output remain unconfirmed and are not claimed as acceptance evidence. The distribution verifier recomputes scope readiness and checks source/archive links and bytes; it does not turn this engineering result into a legal guarantee.

The historical eastasianwidth 0.2.0 omission is resolved using the maintainer's explicit [licensing notes](https://github.com/komagata/eastasianwidth/blob/f42b1e7b2a403d2050dda1141211b4e198e50e70/LICENSE-NOTES.md), which identify the complete original MIT notice and retain its exact `Copyright komagata` line without adding a year. Its fixed source and text hash are recorded in `supplemental-texts.json`.

Bundled npm dependencies whose lock entries have no independent tarball record inherit `artifact` and `integrity` from the containing locked package, with an explicit `artifactOwner`. Their own package name/version and license remain separate. For example, optional wasm-util is inside the Tailwind WASI artifact; it is not falsely recorded as independently downloaded.
