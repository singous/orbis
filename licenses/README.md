# Third-party license materials

The frontend license inventory is derived from `frontend/package-lock.json`. It is separate from Orbis's own AGPL-3.0-only license. Run commands from `frontend/`:

```sh
npm run licenses:generate
npm run report:licenses
npm run check:licenses
npm run licenses:bundle -- dist/licenses
```

`licenses:generate` updates the manifest, the generated table in `THIRD_PARTY_NOTICES.md`, and public font/icon notices. It retains frozen text for an unchanged name/version/integrity instead of depending on which optional platform binary happens to be installed. New packages read their own installed license/NOTICE files. Packages whose tarballs omit their license text need an explicit entry in `supplemental-texts.json`, with a fixed upstream commit, URL and content checksum. The generator does not download or invent missing text.

`report:licenses` is an offline snapshot check. It verifies the lockfile hash, every package version/license/integrity, text checksums, public asset notices and copied-code snapshots. It reports unresolved items without treating them as approved.

`check:licenses` adds the release policy: no missing text, unknown/denied licenses, pending review or missing approved corresponding-source pin. It intentionally fails for the unresolved items in the current inventory. `licenses:bundle` runs that strict check before creating output, then copies `LICENSE`, `THIRD_PARTY_NOTICES.md` and this directory and downloads only the separately pinned, approved corresponding-source archives. Each archive is checked against its SHA-256.

## Files and ownership

- `npm-manifest.json`: generated dependency records. Runtime, build-only, development and asset owners are calculated from the lockfile dependency graph, including workspace links, peers and optional binaries. This is a conservative declared-dependency classification, not a claim that every dependency byte survives tree shaking.
- `texts/npm/`: verbatim package/upstream license and NOTICE files, named by SHA-256. Copyright notices remain in the original text.
- `supplemental-texts.json`: manually recorded evidence for omitted upstream texts. The generator accepts a record only for a matching package version and declared license.
- `material-gaps.json`: precise evidence for unresolved missing upstream notices.
- `pending-review-summary.json`: generated, lockfile-bound list of remaining material gaps and requested maintainer decisions.
- `reviews.json`: maintainer decisions. Pending evidence is not an approval. Approval needs an actual reviewer, date, selected license, conclusion and explicit corresponding-source decision. An OR expression may elect a declared branch; an AND expression cannot discard one of its obligations.
- `sources/packages.tsv`: approved corresponding-source pins. Each non-comment row has tab-separated name, version, npm artifact integrity, source commit, source URL, source SHA-256 and bundle filename. The npm artifact remains distinct from corresponding source.
- `sources/elkjs-review.md`: source-material evidence and the unresolved mapping for the existing layout engine.
- `copied-code/`: immutable downloaded shadcn registry snapshots. Their SHA-256 must match `frontend/packages/ui/ui.registry.json`; the MIT text is retained separately. Local component adaptations do not overwrite these source snapshots.

## Current unresolved material

`client-only` 0.0.1, `stackback` 0.0.2 and optional `@tybys/wasm-util` 0.10.2 declare permissive SPDX identifiers, but their published package/release sources do not contain an attributable full license text in the inspected locations. The inventory leaves those gaps visible instead of creating a generic MIT notice. `client-only` is currently a transitive HeroUI dependency and should disappear when that migration completes. The other packages are build/test dependencies; their presence still remains visible to the strict inventory policy.

The runtime elkjs election and source-material mapping, plus build/test MPL and CC-BY reviews, require maintainer confirmation. No approval is inferred from the general UI implementation request.

The historical eastasianwidth 0.2.0 omission is resolved using the maintainer's explicit [licensing notes](https://github.com/komagata/eastasianwidth/blob/f42b1e7b2a403d2050dda1141211b4e198e50e70/LICENSE-NOTES.md), which identify the complete original MIT notice and retain its exact `Copyright komagata` line without adding a year. Its fixed source and text hash are recorded in `supplemental-texts.json`.
