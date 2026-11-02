# elkjs 0.12.0 corresponding-source evidence

Status: engineering-assessed source availability for the existing unmodified `elkjs` 0.12.0 distribution, using its declared EPL-2.0 option. The actor, Unix-millisecond assessment time, conclusion and limitations are recorded in [`../reviews.json`](../reviews.json). This is not a human maintainer approval or a legal guarantee.

The official elkjs release tree, official ELK 0.12.0 algorithm tree and metadata-compiler tree below are now pinned in [`packages.tsv`](packages.tsv). Their full archives were downloaded again and their recorded SHA-256 values matched before inclusion. The public license bundle provides the archives and [`elkjs-build.md`](elkjs-build.md), which describes the demonstrated source-build path.

The assessment distinguishes available editable source/build materials from historical build reproduction. EPL-2.0 defines source as the form preferred for modification and requires a source-availability statement and acquisition method on distribution; it does not prescribe byte-for-byte reconstruction of an upstream release. The available official-version sources and successful generation evidence support this engineering source-availability assessment. The exact historical upstream checkout and complete observable equivalence remain unconfirmed; none of the mismatch evidence below is withdrawn. See the [official EPL-2.0 text](https://www.eclipse.org/org/documents/epl-2.0/EPL-2.0.html), sections 1 and 3.

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
- ELK's `v0.12.0` tag resolves to `323312916048544e4e594eab3303cdb0d01e2929`. Matching version numbers alone do not prove that it generated this elkjs artifact. At that stage it was a candidate for review, not an approved source pin; the engineering source-availability assessment at the beginning of this record was made later.

The selected license remains separate from the original dual-license declaration. The pinned archives identify the official-version sources and generator/build inputs used in the demonstrated build; they are not represented as proof of the unrecorded upstream publication checkout. The distribution gate verifies the recorded assessment, valid license selection, immutable pins and actual archive checksums.

## Release provenance follow-up

The [successful publish run for this exact elkjs revision](https://github.com/kieler/elkjs/actions/runs/29565358187) started on 2026-07-17. The public Actions API currently reports no artifacts for that run. Its checked-in workflow checks out the release ref and executes `npm publish`; the package has no prepublish build hook. This run therefore does not establish the ELK revision that produced the checked-in generated JavaScript. The historical checkout remains unresolved; a successful npm publication alone is not treated as the source-availability assessment recorded above.


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

During the PRETTY experiment and bounded analysis above, no minified-worker or npm-bundle rebuild was performed. No published-worker byte match, source-pin approval, EPL/GPL election or maintainer approval was established. At that stage the release gate remained pending; the current engineering assessment is stated at the beginning of this record.

### Follow-up: delivered minified worker

Orbis's [board layout worker](../../frontend/src/features/boards/layout.worker.ts) imports `elkjs/lib/elk-api` and supplies the URL imported from `elkjs/lib/elk-worker.min.js?url` as `workerUrl`. Its delivered worker is therefore the minified artifact, rather than the PRETTY reference compared above.

One follow-up experiment ran the unmodified upstream [`copyMinified` dependency chain](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/build.gradle) on 2026-11-01. It retained elkjs `ff5771d7165445c42c408bb8a090c8035272218c`, ELK algorithm source `323312916048544e4e594eab3303cdb0d01e2929`, and the two metadata JARs built from `0c51a28df40d0334b41b94c05b9fa9a07f3752ba` with the hashes recorded above. The original Gradle 7.2 wrapper ran on Microsoft OpenJDK 17.0.16 with `--no-daemon`, the fixed `elkRepo` path and the same temporary exclusive Maven repository configuration.

Before this stage, `build/distMinified`, `build/js/elk-worker.min.js` and committed `lib/` were absent. The official `gwtcMinified` and `copyMinified` tasks both executed; six prerequisite copy/Xtext/Java tasks were `UP-TO-DATE`. The build exited successfully after 11.888 seconds and reported `8 actionable tasks: 2 executed, 6 up-to-date`. Verification before and after the stage retained the hashes of 55 official elkjs non-`lib` files, 654 algorithm source files, 341 dependency files, 1679 generated Java/class inputs and both metadata JARs. The actual GWT command and classpath matched the PRETTY invocation except for the official output path/style arguments.

| Minified worker | Bytes | SHA256 |
| --- | ---: | --- |
| Locked npm / [committed upstream reference](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/lib/elk-worker.min.js) | 1595334 | `e4f5c51c6f2fd564bb64e52e81c4a85a316ef2f24f8b90e1db5eb886c765b030` |
| Follow-up experiment | 1595334 | `462be0b4b1194c3b53e814474947f8cad779e740da70e971a09bf73ceac875e1` |

The official and locked npm references were byte-identical, with Git blob `222acf852bd29216c1fe6cbd29968c3d7ec3bdeb`. The experimental worker **does not match them byte for byte**, despite having the same length. Both inputs are ASCII; direct comparison found 610 unequal byte positions in 34 contiguous mismatch ranges, represented by eight unified-diff hunks. The recorded ranges concern synthetic-constructor names, predicate/comparator helper declarations and references, singleton constructor references, and the LPort/PortListSorter lambda registration blocks with their associated method bodies and type IDs. This is a descriptive raw-source classification, not a further binding or semantic-equivalence proof.

Minification retained all seven relevant class-name literals, using lowercase `lambda`: `LPort/lambda$0$Type`, `LPort/lambda$1$Type`, and `PortListSorter/lambda$0$Type` through `PortListSorter/lambda$4$Type`. Their registration metadata associates them with different type IDs and method bodies across the two artifacts. Their presence does not establish complete observable equivalence.

This follow-up did not run `npmjs`, replace the delivered worker, alter source pins, elect EPL/GPL or grant maintainer approval. It preserved the previous PRETTY/A-A/AST evidence. Exact reproduction of the delivered worker, the historical toolchain and checkout, and the complete corresponding-source mapping remain unconfirmed; the gate was still pending at the conclusion of that experiment. The current engineering assessment is stated at the beginning of this record.
