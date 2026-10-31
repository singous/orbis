# elkjs 0.12.0 corresponding-source evidence

Status: pending maintainer license election and source-material confirmation. This file records source evidence; it is not an approval and does not populate `packages.tsv`.

The npm registry metadata for `elkjs@0.12.0` records source revision `ff5771d7165445c42c408bb8a090c8035272218c` and artifact integrity:

```text
sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==
```

The package declares `EPL-2.0 OR GPL-3.0-or-later`. Its npm LICENSE is retained in the dependency manifest. The published `lib/elk-worker.js` and bundled JavaScript are generated artifacts, so that tarball is not recorded as the complete corresponding source.

Verified upstream material:

- [npm release metadata](https://registry.npmjs.org/elkjs/0.12.0) provides the exact npm revision and artifact integrity.
- [build.gradle at that revision](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/build.gradle) reads source from a sibling ELK repository, including graph/core and the force, layered, mrtree, rectpacking, radial and spore algorithm plugins. It runs Java/EMF/Xtext/GWT code generation. It declares GWT 2.11.0, Xtext 2.36.0, EMF GWT 2.12.4, Guava 31.1-jre and `melk: 0.12.0-SNAPSHOT`, with Java 8–17 support.
- [the CI workflow at that revision](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/.github/workflows/ci.yml) checks out `eclipse/elk` at `master`; it does not pin the exact ELK revision used for the npm artifact.
- [the publish workflow](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/.github/workflows/publish.yml) runs `npm publish` at the release tag and does not supply the missing ELK source mapping.
- ELK's `v0.12.0` tag resolves to `323312916048544e4e594eab3303cdb0d01e2929`. Matching version numbers alone do not prove that it generated this elkjs artifact. It is a candidate for review, not an approved source pin.

Before this entry can satisfy the release gate, the maintainer must choose the license branch and confirm the applicable source availability obligations. The exact ELK source revision and required generator/build materials must then be mapped to the delivered artifact. Only verified corresponding-source archives, with immutable revisions and SHA-256, belong in `packages.tsv`.

## Release provenance follow-up

The [successful publish run for this exact elkjs revision](https://github.com/kieler/elkjs/actions/runs/29565358187) started on 2026-07-17. The public Actions API currently reports no artifacts for that run. Its checked-in workflow checks out the release ref and executes `npm publish`; the package has no prepublish build hook. This run therefore does not establish the ELK revision that produced the checked-in generated JavaScript. The source/build mapping above remains unresolved; a successful npm publication is not recorded as approval of a corresponding-source archive.
