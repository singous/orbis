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


## Isolated source-build experiment

An isolated experiment built the missing metadata compiler and one PRETTY worker from fixed upstream sources. It did not modify Orbis's dependency, delivered JavaScript, license decision or source pins. The results below describe an experimental candidate; the historical release environment and complete corresponding-source assessment remain unconfirmed.

| Input | Immutable upstream revision | Downloaded source archive SHA256 |
| --- | --- | --- |
| elkjs wrapper and build | [`ff5771d7165445c42c408bb8a090c8035272218c`](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c) | `2871a717524de81a0f928708722092d54e531d46313b32a4594508434400d421` |
| ELK algorithms | [`323312916048544e4e594eab3303cdb0d01e2929`](https://github.com/eclipse-elk/elk/tree/323312916048544e4e594eab3303cdb0d01e2929) | `ff68d72187dfda4697c63b2a684bd2febaa471bdb3d8e9fcd800a75463aaadba` |
| ELK metadata compiler | [`0c51a28df40d0334b41b94c05b9fa9a07f3752ba`](https://github.com/eclipse-elk/elk/tree/0c51a28df40d0334b41b94c05b9fa9a07f3752ba) | `cabba47f40e99f1a4bef62f735f238f2742ce2ad910e7f2b3249b598db98903d` |

The metadata candidate retains `0.12.0-SNAPSHOT`; it is not the release `0.12.0` JAR renamed to satisfy a dependency. The [official `elk-meta` profile](https://github.com/eclipse-elk/elk/blob/0c51a28df40d0334b41b94c05b9fa9a07f3752ba/build/pom.xml) selects graph and core.meta, as described in the [upstream build instructions](https://github.com/eclipse-elk/elk/blob/323312916048544e4e594eab3303cdb0d01e2929/docs/content/documentation/contributors/buildingelk.md). From the upstream `build/` directory, the experiment ran `mvn -P elk-meta -Dmaven.repo.local=<isolated-directory> clean install` with Maven 3.9.16 and Microsoft OpenJDK 17.0.16. Tycho 4.0.12 and Eclipse Compiler for Java 3.40.0.v20241112-0530 were resolved.

The first attempt failed because an existing user-level `mirrorOf=*` redirected the POM's Eclipse Dash repository to a mirror without the requested plugin. The unchanged [Dash 1.1.0 plugin POM](https://repo.eclipse.org/content/repositories/dash-licenses-releases/org/eclipse/dash/license-tool-plugin/1.1.0/license-tool-plugin-1.1.0.pom) was available from the already-declared repository, SHA256 `e9c29e30f23252b34a4ddd667e3faf5b36e44c666759738cac84e5c474e2fa10`. One retry used an isolated user-settings file without the mirror. No source, version, goal or build check was bypassed; that attempt succeeded.

| Generated metadata artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `org.eclipse.elk.graph:0.12.0-SNAPSHOT` | 95352 | `b01e2da7e6c29d864fc1d3a44c6ec3bf3433e641c2cdddc21ff623f317e6cae0` |
| `org.eclipse.elk.core.meta:0.12.0-SNAPSHOT` | 481802 | `2359f39d733a12f0eb76d50d1dab75f167a7f381846c02c304c9733655069d83` |

Target and installed JARs matched byte for byte. Their Bundle-Version was `0.12.0.202611011116`, and sampled classes had Java major version 61. These hashes identify this experiment's generated artifacts, not original release-time snapshot binaries; the build qualifier is run-specific.

### Worker generation and comparison

The original [Gradle 7.2 wrapper](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/gradle/wrapper/gradle-wrapper.properties) ran on Java 17 with `--no-daemon`. The 114352742-byte distribution ZIP matched the [published SHA256](https://services.gradle.org/distributions/gradle-7.2-bin.zip.sha256), `f581709a9c35e9cb92e16f585d2c4bc99b2b1a5f85d2badbd3dc6bff59e1e6dd`.

The experiment explicitly set `elkRepo` to the fixed algorithm tree. A temporary repository init script restricted `org.eclipse.elk` artifacts to the newly built isolated Maven repository. Actual Gradle execution history recorded those JAR paths; their hashes were unchanged. Committed `lib/`, build outputs and generation caches were absent before running the upstream `copyElk`/`copyEmul`, Xtext generation, Java compilation, GWT PRETTY and `copyPretty` chain. The unmodified upstream build completed successfully.

| Worker | Bytes | SHA256 |
| --- | ---: | --- |
| Experiment | 4788967 | `0b21b7e1086c13bf62d6f56d9d78a6fc873d2c3d99c8ef62588e1f92dc70687e` |
| Locked npm / [committed upstream reference](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/lib/elk-worker.js) | 4788969 | `f7617e622f565748e1c88a9f45d97b458bc9c3f4299c0fdc6ed778a92ef30683` |

The outputs **do not match byte for byte**. Their lengths differ by two bytes, but the raw diff contains 100 hunks with 185 added and 185 removed lines. One additional fresh generation workspace reran all generation tasks, verified the same 654 algorithm source hashes, two metadata JAR hashes and 341 dependency identities, and produced the exact same experimental worker. Dependency downloads were cached; generated workspace/GWT output caches and committed `lib/` were not reused. This is observed two-run repeatability for this configuration, not proof of the historical environment or universal determinism.

### Bounded analysis of the mismatch

A TypeScript checker-based audit used explicit bidirectional symbol correspondence, rather than stripping numeric suffixes. It covered 16054 top-level statements and 6289 functions, with 6715 declaration mappings: 63 changed function bindings, seven class-literal bindings and 13 local binder renames. After declaration/registration alignment, ordinary numeric/string literals, operators, property names and external identifiers matched. All 100 hunks had corresponding binding evidence. Six actual single-point mutations were rejected: property, numeric constant, operator, ordinary class name, incorrect existing binding and incorrect synthetic class name.

Seven synthetic Java class-name strings really differ across four hunks: two LPort and five PortListSorter names. They feed `initializeNames`, `typeName`, `canonicalName` and `simpleName`. Consequently, this audit **does not establish complete observable equivalence**, and the experimental worker does not replace the delivered artifact.

A bounded history check of the fixed [LPort](https://github.com/eclipse-elk/elk/blob/323312916048544e4e594eab3303cdb0d01e2929/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/graph/LPort.java) and [PortListSorter](https://github.com/eclipse-elk/elk/blob/323312916048544e4e594eab3303cdb0d01e2929/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/intermediate/PortListSorter.java) paths found no declaration-order-only candidate. The API returned 13 and 12 entries with no next page; renamed paths before the earliest returned 2016 entries were not followed. Relevant changes include the [2020 anonymous-class conversion](https://github.com/eclipse-elk/elk/commit/a73c32fb9e8d45dce2673db50a2632b2d2683617) and [2018 sorting refactor](https://github.com/eclipse-elk/elk/commit/3b86f2bff1751ca33e8936a93ace7ecb9a49cc66); both include implementation changes. No JDK/compiler cause is inferred from commit dates.

No minified-worker or npm-bundle rebuild was performed. No published-worker byte match, source-pin approval, EPL/GPL election or maintainer approval was established. The release gate remains pending.
