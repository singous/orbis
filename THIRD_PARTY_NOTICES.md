# Third-party notices

Orbis is licensed under AGPL-3.0-only. That license does not replace the licenses of dependencies, copied code, fonts or icons.

## Inventory status

The frontend lockfile inventory is generated in [licenses/npm-manifest.json](licenses/npm-manifest.json). Each license/NOTICE text is retained verbatim in `licenses/texts/npm/` with a SHA-256 checksum; [supplemental-texts.json](licenses/supplemental-texts.json) pins attributable upstream texts when the npm artifact omits them. The manifest records package versions, npm artifact integrity and declared dependency ownership.

This inventory is **not a completed release approval**. `npm run report:licenses` validates the snapshot offline. The strict release gate also requires complete texts and actual maintainer decisions from [reviews.json](licenses/reviews.json). Runtime, static asset, build-only and development classifications describe the declared dependency closure. The build/test tools are not included by the frontend Docker final stage, which copies only the static `dist/` output.

Three omitted upstream full-text notices remain visible: `client-only` 0.0.1, `stackback` 0.0.2 and optional `@tybys/wasm-util` 0.10.2. Their SPDX metadata alone is not treated as a fabricated full text. Pending review-level licenses and source-material decisions are also reported by the release gate. See [maintenance instructions](licenses/README.md).

## New UI platform

- `@base-ui/react` 1.9.0 and `@base-ui/utils` 0.5.0: MIT; unmodified npm dependencies, used by the UI primitives. Their copyright and license texts are linked from the manifest.
- Storybook 9.1.21: MIT; component development and testing, not imported by the production application. Upstream license text: [storybook-MIT.txt](licenses/texts/storybook-MIT.txt). The exact release-source revision and checksum also appear in the manifest.
- shadcn/ui: MIT; the Base Nova registry was used as the starting reference for Button/Dialog. [ui.registry.json](frontend/packages/ui/ui.registry.json) records downloaded source URLs, content checksums and local adaptations. [License text](licenses/texts/shadcn-ui-MIT.txt). No Dify code or documentation was copied.

## Existing components requiring distribution review

- `elkjs` 0.12.0: declared `EPL-2.0 OR GPL-3.0-or-later`; used for browser board layout. The license election is pending maintainer confirmation. The npm release contains generated JavaScript; an npm tarball alone is not recorded as the complete corresponding source. [Source-material evidence](licenses/sources/elkjs-review.md) pins the elkjs revision and documents the unresolved ELK/build mapping.
- `lightningcss` and platform packages: MPL-2.0; CSS build tooling. Reachable through the Vite/Tailwind build pipeline; no application runtime import. The dependency-graph evidence is recorded, but the maintainer review is still pending.
- Inter: OFL-1.1; unchanged font assets are distributed with the frontend. [Public asset notice](frontend/public/licenses/inter-OFL-1.1.txt) retains the font copyright and reserved-name information.
- Icon assets: [asset index](frontend/public/licenses/index.json) records Inter, Lucide, Gravity UI, Tabler and Remix Icon notices with checksums. Existing board notices remain in place. Tabler icons 3.49.0 are generated from `@iconify-json/tabler` 1.2.42; the npm wrapper version and icon-set version are distinct.

The UI migration does not change Orbis's own license or remove existing third-party notices. Release bundling and the public license entry are pending the complete distribution review.

<!-- npm-inventory:start -->
## Locked npm components

Generated from the exact frontend lockfile. Runtime and asset entries are included in the frontend distribution; build-only and dev-only entries document the tools used to produce and verify it. Full texts retain their upstream copyright notices. Multiple scopes mean a package is reachable from more than one declared owner.

| Component | Version | Declared license | Use | Text / copyright |
| --- | --- | --- | --- | --- |
| `@adobe/css-tools` | 4.5.0 | MIT | dev-only | [1](licenses/texts/npm/326ff3850062286003ff4cbdaa8f61764e128f9a6532431bccf97e4e2bd75059.txt) |
| `@adobe/react-spectrum-ui` | 1.2.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30.txt) |
| `@adobe/react-spectrum-workflow` | 2.3.5 | Apache-2.0 | runtime | [1](licenses/texts/npm/cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30.txt) |
| `@adobe/react-spectrum` | 3.47.5 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@asamuzakjp/css-color` | 3.2.0 | MIT | dev-only | [1](licenses/texts/npm/1156c4bf9aa3982ff6157a4a8615906f225e4f46126dc41bf14df9aa7d74601b.txt) |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | dev-only | [1](licenses/texts/npm/812e9d96e900a093ae4d1d3f22c5f82f568a0a0461c3007a99d00573d41c5461.txt) |
| `@babel/code-frame` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/compat-data` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/core` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/generator` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-compilation-targets` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-globals` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-module-imports` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-module-transforms` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT | build-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-string-parser` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helper-validator-option` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/helpers` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/4be9d87b56a306293223b490c0d0b245e9e94f39884147bf051a6c7b825aeb30.txt) |
| `@babel/parser` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/2e97627cb278aa7556fb9e8817368302301a595b6c7582512b8d74c57b773652.txt) |
| `@babel/plugin-transform-react-jsx-self` | 7.29.7 | MIT | build-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/plugin-transform-react-jsx-source` | 7.29.7 | MIT | build-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/runtime` | 7.29.7 | MIT | dev-only, runtime | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/template` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/traverse` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@babel/types` | 7.29.7 | MIT | build-only, dev-only | [1](licenses/texts/npm/117da2af0d4ce0fe1c8e19b5cff9dcd806adf973d328d27b11d4448c4ff24f76.txt) |
| `@base-ui/react` | 1.9.0 | MIT | runtime | [1](licenses/texts/npm/07fc1b39d69d14bc7d40482a628f47226258eb01265db68ae684944b916beb2a.txt) |
| `@base-ui/utils` | 0.5.0 | MIT | runtime | [1](licenses/texts/npm/07fc1b39d69d14bc7d40482a628f47226258eb01265db68ae684944b916beb2a.txt) |
| `@csstools/color-helpers` | 5.1.0 | MIT-0 | dev-only | [1](licenses/texts/npm/947e32047a166cd05f04e45938d172b412c07cbee0b9735afd14bae30e02c2f6.txt) |
| `@csstools/css-calc` | 2.1.4 | MIT | dev-only | [1](licenses/texts/npm/d00d032f517721b45c56c70c46bf904ebb71ad313df4d4db7722266b38069665.txt) |
| `@csstools/css-color-parser` | 3.1.0 | MIT | dev-only | [1](licenses/texts/npm/d00d032f517721b45c56c70c46bf904ebb71ad313df4d4db7722266b38069665.txt) |
| `@csstools/css-parser-algorithms` | 3.0.5 | MIT | dev-only | [1](licenses/texts/npm/d00d032f517721b45c56c70c46bf904ebb71ad313df4d4db7722266b38069665.txt) |
| `@csstools/css-tokenizer` | 3.0.4 | MIT | dev-only | [1](licenses/texts/npm/d00d032f517721b45c56c70c46bf904ebb71ad313df4d4db7722266b38069665.txt) |
| `@dnd-kit/abstract` | 0.5.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@dnd-kit/collision` | 0.5.0 | MIT | runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@dnd-kit/dom` | 0.5.0 | MIT | runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@dnd-kit/geometry` | 0.5.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@dnd-kit/react` | 0.5.0 | MIT | runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@dnd-kit/state` | 0.5.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/537607e3f1533ad2c5b12978967f5ab27f34ffb7e626e321017a7ccca6cc24ff.txt) |
| `@emnapi/core` | 1.10.0 | MIT | build-only | [1](licenses/texts/npm/2088f55c6731498410b20c95ebd345ed4a4a800bf74c0fba4d282fd2a021daaa.txt) |
| `@emnapi/runtime` | 1.10.0 | MIT | build-only | [1](licenses/texts/npm/2088f55c6731498410b20c95ebd345ed4a4a800bf74c0fba4d282fd2a021daaa.txt) |
| `@emnapi/wasi-threads` | 1.2.1 | MIT | build-only | [1](licenses/texts/npm/2088f55c6731498410b20c95ebd345ed4a4a800bf74c0fba4d282fd2a021daaa.txt) |
| `@esbuild/aix-ppc64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/android-arm` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/android-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/android-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/darwin-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/darwin-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/freebsd-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/freebsd-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-arm` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-ia32` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-loong64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-mips64el` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-ppc64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-riscv64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-s390x` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/linux-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/netbsd-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/netbsd-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/openbsd-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/openbsd-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/openharmony-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/sunos-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/win32-arm64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/win32-ia32` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@esbuild/win32-x64` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `@floating-ui/core` | 1.8.0 | MIT | runtime | [1](licenses/texts/npm/0e4c9a9b6c71019cbbea3bdc20b01223110a9035700f9c960c8fcbf78c2325ce.txt) |
| `@floating-ui/dom` | 1.8.0 | MIT | runtime | [1](licenses/texts/npm/0e4c9a9b6c71019cbbea3bdc20b01223110a9035700f9c960c8fcbf78c2325ce.txt) |
| `@floating-ui/react-dom` | 2.1.9 | MIT | runtime | [1](licenses/texts/npm/0e4c9a9b6c71019cbbea3bdc20b01223110a9035700f9c960c8fcbf78c2325ce.txt) |
| `@floating-ui/utils` | 0.2.12 | MIT | runtime | [1](licenses/texts/npm/0e4c9a9b6c71019cbbea3bdc20b01223110a9035700f9c960c8fcbf78c2325ce.txt) |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | asset | [1](licenses/texts/npm/3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345.txt) |
| `@gravity-ui/icons` | 2.23.0 | MIT | runtime | [1](licenses/texts/npm/6c509237a13194071fcd99cfaae017e514204ba9493291ab6f87dec58dc2662b.txt) |
| `@heroui/react` | 3.2.6 | MIT | runtime | [1](licenses/texts/npm/bd087c1ebd511adbab74705ec2b31d63d175e8d422f58c1af54754da02b1d329.txt) |
| `@heroui/styles` | 3.2.6 | MIT | runtime | [1](licenses/texts/npm/bd087c1ebd511adbab74705ec2b31d63d175e8d422f58c1af54754da02b1d329.txt) |
| `@iconify-json/tabler` | 1.2.42 | MIT | asset | [1](licenses/texts/npm/b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db.txt) |
| `@iconify/types` | 2.0.0 | MIT | asset | [1](licenses/texts/npm/045ce74712fc613fdd74d1c55f5140a08d623836ff2aca44132b38d68fbc67ad.txt) |
| `@internationalized/date` | 3.12.4 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@internationalized/number` | 3.6.8 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@internationalized/string` | 3.2.10 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@isaacs/cliui` | 8.0.2 | ISC | dev-only | [1](licenses/texts/npm/2dc0465729366c3a7890dfa9e972a1ba7048a26c02116fb8b419a6a1ac110149.txt) |
| `@joshwooding/vite-plugin-react-docgen-typescript` | 0.6.1 | MIT | dev-only | [1](licenses/texts/npm/36c0a6c416faedf94efe2011d9618442049e3ccd414c40068e3fe16c8f70f3a2.txt) |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT | build-only, dev-only | [1](licenses/texts/npm/769d154fbde32a915af110b1123650bc79f4cbe675acc66e005265bf069c6c6c.txt) |
| `@jridgewell/remapping` | 2.3.5 | MIT | build-only, dev-only | [1](licenses/texts/npm/769d154fbde32a915af110b1123650bc79f4cbe675acc66e005265bf069c6c6c.txt) |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/b8778b155bfde5a28b023a558753c0fa058a52bb9de35c343c250be1bbcdedab.txt) |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | build-only, dev-only | [1](licenses/texts/npm/769d154fbde32a915af110b1123650bc79f4cbe675acc66e005265bf069c6c6c.txt) |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | build-only, dev-only | [1](licenses/texts/npm/769d154fbde32a915af110b1123650bc79f4cbe675acc66e005265bf069c6c6c.txt) |
| `@mdx-js/react` | 3.1.1 | MIT | dev-only | [1](licenses/texts/npm/c274d2be30a4def0f9344506f3fe6d15668890a8e6d3e3d6bea732b44af9e124.txt) |
| `@napi-rs/wasm-runtime` | 1.1.4 | MIT | build-only | [1](licenses/texts/npm/3f1ce66533302df3a32edbfdfc0b78f0dd34659e4c1f5817162e5ea3c2297215.txt) |
| `@pkgjs/parseargs` | 0.11.0 | MIT | dev-only | [1](licenses/texts/npm/c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.txt) |
| `@playwright/test` | 1.63.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb.txt) [2](licenses/texts/npm/6d602191187b35b9b01d2cffa01c8469c2c8d9de8a96f1bf868e0f264f51c81d.txt) |
| `@polka/url` | 1.0.0-next.29 | MIT | dev-only | [1](licenses/texts/npm/ba573393f24555ac0528612ad39665fab5bdcc80330a61096024bbf5f736526d.txt) |
| `@popperjs/core` | 2.11.8 | MIT | runtime | [1](licenses/texts/npm/bf67e2c9b7974543bb18ced3a0b37f53729aaff953b442dd89a3adaf90fd93e8.txt) |
| `@preact/signals-core` | 1.14.4 | MIT | dev-only, runtime | [1](licenses/texts/npm/a11fc89e4c6b118854c7a667734a0b2e6bf2af5e45c6686de31adbccc8f3ae8d.txt) |
| `@radix-ui/primitive` | 1.1.7 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-avatar` | 1.2.6 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-compose-refs` | 1.1.5 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-context` | 1.2.2 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-primitive` | 2.1.10 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-slot` | 1.3.3 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-use-callback-ref` | 1.1.4 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-use-is-hydrated` | 0.1.3 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@radix-ui/react-use-layout-effect` | 1.1.4 | MIT | runtime | [1](licenses/texts/npm/0e80a2d229d2fd4fc7e8636142ec5d0ff0bc031f14c15b682e2ac01dfd5b5138.txt) |
| `@react-aria/color` | 3.2.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-aria/ssr` | 3.10.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-aria/utils` | 3.34.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-spectrum/color` | 3.2.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-spectrum/provider` | 3.11.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-stately/color` | 3.10.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-stately/utils` | 3.12.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-types/color` | 3.2.0 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@react-types/shared` | 3.36.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@remirror/core-constants` | 3.0.0 | MIT | runtime | [1](licenses/texts/npm/2a3b698d8ae82cbc7b34e85ee7d4eb06910f48a0544346c765f91600b86dc34b.txt) |
| `@remixicon/react` | 4.6.0 | Apache-2.0 | runtime | [1](licenses/texts/npm/c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.txt) |
| `@rolldown/pluginutils` | 1.0.0-beta.27 | MIT | build-only | [1](licenses/texts/npm/23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734.txt) |
| `@rollup/pluginutils` | 5.5.1 | MIT | dev-only | [1](licenses/texts/npm/7b8136f76c483d03597500bfa991aae9be68d4629e1121cbf9b93aa727efe305.txt) |
| `@rollup/rollup-android-arm-eabi` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-android-arm64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-darwin-arm64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-darwin-x64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-freebsd-arm64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-freebsd-x64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-arm-gnueabihf` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-arm-musleabihf` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-arm64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-arm64-musl` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-loong64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-loong64-musl` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-ppc64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-ppc64-musl` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-riscv64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-riscv64-musl` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-s390x-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-x64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-linux-x64-musl` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-openbsd-x64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-openharmony-arm64` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-win32-arm64-msvc` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-win32-ia32-msvc` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-win32-x64-gnu` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@rollup/rollup-win32-x64-msvc` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `@spectrum-icons/ui` | 3.7.2 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@spectrum-icons/workflow` | 4.3.2 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `@storybook/addon-a11y` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/addon-docs` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/addon-vitest` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/builder-vite` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/csf-plugin` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/global` | 5.0.0 | MIT | dev-only | [1](licenses/texts/npm/576f0541c45448ed6594d9d16bbae024a8bc4db400b33492e66cb3b7156bfad1.txt) |
| `@storybook/icons` | 1.6.0 | MIT | dev-only | [1](licenses/texts/npm/a884e287f0e37d3e478c02746a86b8a80eaadd79f917f09cef02cbab33261ff9.txt) |
| `@storybook/react-dom-shim` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/react-vite` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@storybook/react` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `@swc/helpers` | 0.5.23 | Apache-2.0 | runtime | [1](licenses/texts/npm/d96eba1f1881334d50ffc144276dfa98e147a415e7c591ecdfcb81680361dc91.txt) |
| `@tailwindcss/node` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-android-arm64` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-darwin-arm64` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-darwin-x64` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-freebsd-x64` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-linux-arm-gnueabihf` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-linux-arm64-gnu` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-linux-arm64-musl` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-linux-x64-gnu` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-linux-x64-musl` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-wasm32-wasi` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-win32-arm64-msvc` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide-win32-x64-msvc` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/oxide` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tailwindcss/vite` | 4.3.1 | MIT | build-only | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `@tanstack/query-core` | 5.101.1 | MIT | runtime | [1](licenses/texts/npm/a405ee70c632bb938acb7ac5f210e814409b3760ea9d2329d8ed8ffcfd11a0e7.txt) |
| `@tanstack/react-query` | 5.101.1 | MIT | runtime | [1](licenses/texts/npm/a405ee70c632bb938acb7ac5f210e814409b3760ea9d2329d8ed8ffcfd11a0e7.txt) |
| `@tanstack/react-store` | 0.11.2 | MIT | runtime | [1](licenses/texts/npm/cb4a7917af22bd56340e877f10a5c5aa4fded7af2459162630ff7fcb48bb45c7.txt) |
| `@tanstack/react-table` | 9.2.6 | MIT | runtime | [1](licenses/texts/npm/9db3f8ddd7031ab264b99bec49c221155d0c8649b53dd4aa007f2041d36cdf5f.txt) |
| `@tanstack/react-virtual` | 3.14.13 | MIT | runtime | [1](licenses/texts/npm/a405ee70c632bb938acb7ac5f210e814409b3760ea9d2329d8ed8ffcfd11a0e7.txt) |
| `@tanstack/store` | 0.11.2 | MIT | runtime | [1](licenses/texts/npm/cb4a7917af22bd56340e877f10a5c5aa4fded7af2459162630ff7fcb48bb45c7.txt) |
| `@tanstack/table-core` | 9.2.6 | MIT | runtime | [1](licenses/texts/npm/9db3f8ddd7031ab264b99bec49c221155d0c8649b53dd4aa007f2041d36cdf5f.txt) |
| `@tanstack/virtual-core` | 3.17.11 | MIT | runtime | [1](licenses/texts/npm/a405ee70c632bb938acb7ac5f210e814409b3760ea9d2329d8ed8ffcfd11a0e7.txt) |
| `@testing-library/dom` | 10.4.1 | MIT | dev-only | [1](licenses/texts/npm/bf8fd38056b7606deccfcadb4d8ca1c210082d8ef5513426d2650daedc30bed3.txt) |
| `@testing-library/jest-dom` | 6.9.1 | MIT | dev-only | [1](licenses/texts/npm/bf8fd38056b7606deccfcadb4d8ca1c210082d8ef5513426d2650daedc30bed3.txt) |
| `@testing-library/react` | 16.3.2 | MIT | dev-only | [1](licenses/texts/npm/9680978280d509520d2a7b51e93ffbf7d9ec2b9de4411a6989daba5b659048e0.txt) |
| `@testing-library/user-event` | 14.6.1 | MIT | dev-only | [1](licenses/texts/npm/b5a4028c49c48f820831421de69c8ea83d621a062914bf16739fd0703c7c9fba.txt) |
| `@tiptap/core` | 2.27.3 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-blockquote` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-bold` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-bubble-menu` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-bullet-list` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-code-block` | 2.27.3 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-code` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-collaboration` | 2.27.3 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-document` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-dropcursor` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-floating-menu` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-gapcursor` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-hard-break` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-heading` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-history` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-horizontal-rule` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-italic` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-link` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-list-item` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-ordered-list` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-paragraph` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-placeholder` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-strike` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-table-cell` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-table-header` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-table-row` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-table` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-task-item` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-task-list` | 2.26.1 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-text-style` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-text` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/extension-underline` | 2.27.3 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/pm` | 2.27.3 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/react` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tiptap/starter-kit` | 2.27.2 | MIT | runtime | [1](licenses/texts/npm/c96e5ecb55ac593157ad1d21d1f44a611187f494a0f04c235a1ae692c88d6ba9.txt) |
| `@tybys/wasm-util` | 0.10.2 | MIT | build-only | Missing upstream text |
| `@types/aria-query` | 5.0.4 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/babel__core` | 7.20.5 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/babel__generator` | 7.27.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/babel__template` | 7.4.4 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/babel__traverse` | 7.28.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/chai` | 5.2.3 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/deep-eql` | 4.0.2 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/doctrine` | 0.0.9 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/estree` | 1.0.9 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/linkify-it` | 5.0.0 | MIT | runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/markdown-it` | 14.1.2 | MIT | runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/mdurl` | 2.0.0 | MIT | runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/mdx` | 2.0.14 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/node` | 22.20.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/qrcode` | 1.5.5 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/react-dom` | 19.2.3 | MIT | dev-only, runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/react` | 19.2.17 | MIT | dev-only, runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/resolve` | 1.20.6 | MIT | dev-only | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@types/use-sync-external-store` | 0.0.6 | MIT | runtime | [1](licenses/texts/npm/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| `@vitejs/plugin-react` | 4.7.0 | MIT | build-only | [1](licenses/texts/npm/29b68325fe026047d13e187b44c33b2acacf7dc647dec4583702e59f235e13b5.txt) |
| `@vitest/browser` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/expect` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/expect` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/mocker` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/mocker` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/pretty-format` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/pretty-format` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/runner` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/snapshot` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/spy` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/spy` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/utils` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `@vitest/utils` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `acorn` | 8.19.0 | MIT | dev-only | [1](licenses/texts/npm/76a876cf886ff9be2a8b5e2e86514fed06223c8c9f0c1e9ee9606e93841e00b7.txt) |
| `agent-base` | 7.1.4 | MIT | dev-only | [1](licenses/texts/npm/8d8c55319c7729d57be811c747452636688d54f19701ee0752b6b15ad3771d9a.txt) |
| `ansi-regex` | 5.0.1 | MIT | dev-only, runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `ansi-regex` | 6.5.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `ansi-styles` | 4.3.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `ansi-styles` | 5.2.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `ansi-styles` | 6.2.3 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `argparse` | 2.0.1 | Python-2.0 | runtime | [1](licenses/texts/npm/de4d1f2d2ad5ad0cfd1657a106476b31cb5db5ef9d1ff842b237c0c81f0c8a23.txt) |
| `aria-hidden` | 1.2.6 | MIT | runtime | [1](licenses/texts/npm/30f0cfddf483d1128e3610205020f2041a6c5e837aa999e0aa82e5576187d4a9.txt) |
| `aria-query` | 5.3.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/c8df456c7ccba74b959087dff494d4ac2a12dfb0400c08b46b2494a08a000567.txt) |
| `assertion-error` | 2.0.1 | MIT | dev-only | [1](licenses/texts/npm/2130216d5ab4c02134f8247f32999feda0abe1eaf028218baeac445c19ce4cea.txt) |
| `ast-types` | 0.16.3 | MIT | dev-only | [1](licenses/texts/npm/a374b737c41b30b1ec04c5fcc17d1b853f008f217cc43a9dbea441abd9afde70.txt) |
| `axe-core` | 4.14.0 | MPL-2.0 | dev-only | [1](licenses/texts/npm/af175b9d96ee93c21a036152e1b905b0b95304d4ae8c2c921c7609100ba8df7e.txt) [2](licenses/texts/npm/4f8563870d0fca38bbc3e00b6f670cb7fa9f380ba9f26a7f7d1184a6b18b1653.txt) |
| `balanced-match` | 1.0.2 | MIT | dev-only | [1](licenses/texts/npm/a1bd5deadb6a06dd74efa852c1b8b23f63b67f2214fbe9c8bd591da51da69268.txt) |
| `baseline-browser-mapping` | 2.10.38 | Apache-2.0 | build-only, dev-only | [1](licenses/texts/npm/c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.txt) |
| `better-opn` | 3.0.2 | MIT | dev-only | [1](licenses/texts/npm/914d1872727809314c403a449c6bfed8aa7de72679ced2477bac51999dd65258.txt) |
| `brace-expansion` | 2.1.7 | MIT | dev-only | [1](licenses/texts/npm/68f12f6e2c33688699249c01d8f9623c534da20aa71989c57b061b7bc1676d14.txt) |
| `browserslist` | 4.28.4 | MIT | build-only, dev-only | [1](licenses/texts/npm/21c2679a63d7699c0e644409e2f17d0adbc7a965003feb06b3ff4b833d21f722.txt) |
| `cac` | 6.7.14 | MIT | dev-only | [1](licenses/texts/npm/709131d7af352b81204ada2a3d812e245a83576e327b364f92ba24c578ba9408.txt) |
| `camelcase` | 5.3.1 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `caniuse-lite` | 1.0.30001799 | CC-BY-4.0 | build-only, dev-only | [1](licenses/texts/npm/fd3a263fe19ed8faa9068b43abaebafc02c77897b0c6fc09abc04bb592e5f16e.txt) |
| `chai` | 5.3.3 | MIT | dev-only | [1](licenses/texts/npm/b181da80336ff9dd1043fc8be1a764d7382363433319aa872e4d2cb5ce2a3066.txt) |
| `check-error` | 2.1.3 | MIT | dev-only | [1](licenses/texts/npm/e5aee0714b6ecc416454b968d1017570ef609f20d8722ab84b07acd550b78198.txt) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/0ccbf956cffc8dcf515809433cb5242ee67c94513d46e48c261d68d0880de406.txt) |
| `client-only` | 0.0.1 | MIT | runtime | Missing upstream text |
| `cliui` | 6.0.0 | ISC | runtime | [1](licenses/texts/npm/2dc0465729366c3a7890dfa9e972a1ba7048a26c02116fb8b419a6a1ac110149.txt) |
| `clsx` | 2.1.1 | MIT | runtime | [1](licenses/texts/npm/9a9edad7baae52622bddf3c15b2ef8a33d2c89f2d25408ad13e8a7481c6b0c97.txt) |
| `color-convert` | 2.0.1 | MIT | dev-only, runtime | [1](licenses/texts/npm/693866fc419c6f61c8570438ec00659d156ec2b4d4a4d04091711f5f11a365d4.txt) |
| `color-name` | 1.1.4 | MIT | dev-only, runtime | [1](licenses/texts/npm/c064f7a3e353bc1bc977f3c897941c75ef763f44f41677e0a15370ca0853d6e2.txt) |
| `convert-source-map` | 2.0.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/1fa6ee8bb95a81ae3d73a5bd074a3ac380ffec13697051063ca1a601921b91db.txt) |
| `cookie` | 1.1.1 | MIT | runtime | [1](licenses/texts/npm/c02110eedc16c7114f1a9bdc026c65626ce1d9c7e27fd51a8e0feee8a48a6858.txt) |
| `crelt` | 1.0.6 | MIT | runtime | [1](licenses/texts/npm/23852ebf6aef7fadffc92514b3c5df163a8651f2c3ed0dbb494cb49d93bd5de5.txt) |
| `cross-spawn` | 7.0.6 | MIT | dev-only | [1](licenses/texts/npm/aaa78451b6fecd1b9c4594c796c133c0e90cad100372ff8bc6de615e9ef9adf1.txt) |
| `css.escape` | 1.5.1 | MIT | dev-only | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `cssstyle` | 4.6.0 | MIT | dev-only | [1](licenses/texts/npm/768faff9f6908c78d848b18770b2a93e3361d6e2ee35edf45c6a5ddf1f7cb185.txt) |
| `csstype` | 3.2.3 | MIT | dev-only, runtime | [1](licenses/texts/npm/11d55bd4541c75ee7879547ac49089c489163dae49551389713c3d026cab383e.txt) |
| `data-urls` | 5.0.0 | MIT | dev-only | [1](licenses/texts/npm/528eec83cb836a0adda9f8fc3d6a2a70a710d6cc0be9a155f92212c8df28acfa.txt) |
| `debug` | 4.4.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/3a61c6c96caf5c1d9b623fb9b04c822b783dfcb78aa7e49c76a3f643e6ed7f95.txt) |
| `decamelize` | 1.2.0 | MIT | runtime | [1](licenses/texts/npm/6fb9754611c20f6649f68805e8c990e83261f29316e29de9e6cedae607b8634c.txt) |
| `decimal.js` | 10.6.0 | MIT | dev-only | [1](licenses/texts/npm/3108b546bcff5d346923a82f48b2d252ca722f9088076db6d145f6b67757ad6c.txt) |
| `deep-eql` | 5.0.2 | MIT | dev-only | [1](licenses/texts/npm/e5aee0714b6ecc416454b968d1017570ef609f20d8722ab84b07acd550b78198.txt) |
| `define-lazy-prop` | 2.0.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `dequal` | 2.0.3 | MIT | dev-only | [1](licenses/texts/npm/306fa513e39b23a6e8747520de761809d206b99800ef41907b530226574c59ae.txt) |
| `detect-libc` | 2.1.2 | Apache-2.0 | build-only, dev-only | [1](licenses/texts/npm/b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1.txt) |
| `dijkstrajs` | 1.0.3 | MIT | runtime | [1](licenses/texts/npm/c46324e45a005413535a6fb7a97e9eacd3cc6bf30335b7d5c10b8ee3af9e60c2.txt) |
| `doctrine` | 3.0.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/5c272e206669b79ee20fa89fa8fa888d5b56186f16c55a5614753ad3412e2ae9.txt) [2](licenses/texts/npm/cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30.txt) [3](licenses/texts/npm/0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1.txt) |
| `dom-accessibility-api` | 0.5.16 | MIT | dev-only | [1](licenses/texts/npm/0ffe67fe630169de46df2d29dc18f5857b4c98f0f95b0cd9e3c21fef51f9a9b8.txt) |
| `dom-accessibility-api` | 0.6.3 | MIT | dev-only | [1](licenses/texts/npm/0ffe67fe630169de46df2d29dc18f5857b4c98f0f95b0cd9e3c21fef51f9a9b8.txt) |
| `dom-helpers` | 5.2.1 | MIT | runtime | [1](licenses/texts/npm/1b0a9ba95a67bc484e028b13c61b83fc5aa1ca7957d1e2d43c2b0f70d9e9dd45.txt) |
| `eastasianwidth` | 0.2.0 | MIT | dev-only | [1](licenses/texts/npm/94aa6016fb9d436508366433e9caba061443ca58f4c7eb515caec7badf90ae5a.txt) |
| `electron-to-chromium` | 1.5.377 | ISC | build-only, dev-only | [1](licenses/texts/npm/25ba5c59dad3e0dd8f9540beaa0f0a86a10e3aec35af5fdc8e88c5f6a5c0d8c6.txt) |
| `elkjs` | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | runtime | [1](licenses/texts/npm/637e81f4a1b6b4079535c499fca05e238cf7605c1ff5b76d60d7da7ce96700c9.txt) |
| `emoji-regex` | 8.0.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `emoji-regex` | 9.2.2 | MIT | dev-only | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `enhanced-resolve` | 5.21.6 | MIT | build-only | [1](licenses/texts/npm/9068a8782d2fb4c6e432cfa25334efa56f722822180570802bf86e71b6003b1e.txt) |
| `entities` | 4.5.0 | BSD-2-Clause | runtime | [1](licenses/texts/npm/cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164.txt) |
| `entities` | 6.0.1 | BSD-2-Clause | dev-only | [1](licenses/texts/npm/cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164.txt) |
| `es-errors` | 1.3.0 | MIT | dev-only | [1](licenses/texts/npm/5e325595b4ea8cfec3802f545b1def5d7b73e4a5b8e9ba63e32a320f67732292.txt) |
| `es-module-lexer` | 1.7.0 | MIT | dev-only | [1](licenses/texts/npm/fecc38b5e10d889686b3862e7ade17e8b3e5c94b24b7256b05a354d8524b3274.txt) |
| `esbuild-register` | 3.6.0 | MIT | dev-only | [1](licenses/texts/npm/4a6ab1f41bbf070dcf47104128d101d444f4a6767af8169e2c44430473285b5c.txt) |
| `esbuild` | 0.25.12 | MIT | build-only, dev-only | [1](licenses/texts/npm/b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681.txt) |
| `escalade` | 3.2.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/9a9edad7baae52622bddf3c15b2ef8a33d2c89f2d25408ad13e8a7481c6b0c97.txt) |
| `escape-string-regexp` | 4.0.0 | MIT | runtime | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `esprima` | 4.0.1 | BSD-2-Clause | dev-only | [1](licenses/texts/npm/94bcb9959136723aa4fb36e1a6c4d5c662a2369978cfae344dabfb83ae619e79.txt) |
| `estree-walker` | 2.0.2 | MIT | dev-only | [1](licenses/texts/npm/8a6dcbabe7179f9c8489c08a7d874d0f1e093ae7449e03756ccf87cb9d0e296e.txt) |
| `estree-walker` | 3.0.3 | MIT | dev-only | [1](licenses/texts/npm/8a6dcbabe7179f9c8489c08a7d874d0f1e093ae7449e03756ccf87cb9d0e296e.txt) |
| `esutils` | 2.0.3 | BSD-2-Clause | dev-only | [1](licenses/texts/npm/0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1.txt) |
| `expect-type` | 1.3.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/7c6cc83c84eaa249a85bf12fe3eedd831bb50c696e8890b5248223ae68c7b408.txt) |
| `fake-indexeddb` | 6.2.6 | Apache-2.0 | dev-only | [1](licenses/texts/npm/0c2e77addd3045b932ae0de86b7cf66aa1eeed4248d4dab37e851f9e5499d85e.txt) |
| `fast-deep-equal` | 3.1.3 | MIT | runtime | [1](licenses/texts/npm/7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a.txt) |
| `fdir` | 6.5.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/9a39f2aadab11a3697edd668ff2d8ad885b649737b7ab4d3bf12b34e5ada0c86.txt) |
| `find-up` | 4.1.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `find-up` | 7.0.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `foreground-child` | 3.3.1 | ISC | dev-only | [1](licenses/texts/npm/93f5d82a8d59442fe3275383453a255fef761647fb28265644010ba799806148.txt) |
| `fsevents` | 2.3.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/2a8a5d6197bb97a018b8a190dd3ed853d750ca87c8e80c17aad41d6c6ff448e1.txt) |
| `function-bind` | 1.1.2 | MIT | dev-only | [1](licenses/texts/npm/773e131a7684726005a7e4688a80b4620033bc08499bc1404dd1a1eb3bca725e.txt) |
| `gensync` | 1.0.0-beta.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/e3a956681ee067f971ac413994171b3d90ca801ec6324e76c9c55366cfe31cb0.txt) |
| `get-caller-file` | 2.0.5 | ISC | runtime | [1](licenses/texts/npm/902dbb4154679fb2b8d7c33878183f45b268d01eae5e5033dddaa8852d45f213.txt) |
| `glob` | 10.4.5 | ISC | dev-only | [1](licenses/texts/npm/cdbc258d13806538e727964c2436a8806e6e2496ccd616224aace6f7bf98dbc1.txt) |
| `graceful-fs` | 4.2.11 | ISC | build-only | [1](licenses/texts/npm/f65c5d9f22a317b2a10803bd1868461ce6499c2ed7217bc80c0cc772a748789c.txt) |
| `hasown` | 2.0.4 | MIT | dev-only | [1](licenses/texts/npm/bf9b0d665be2a689851eea667ca9f42066ea1d903b38349c51e6a44b2577680a.txt) |
| `highlight.js` | 11.12.0 | BSD-3-Clause | runtime | [1](licenses/texts/npm/6c081431591d9df696c82dc598fe1423765b8a299b200ed00b281afd0f64c490.txt) |
| `html-encoding-sniffer` | 4.0.0 | MIT | dev-only | [1](licenses/texts/npm/528eec83cb836a0adda9f8fc3d6a2a70a710d6cc0be9a155f92212c8df28acfa.txt) |
| `http-proxy-agent` | 7.0.2 | MIT | dev-only | [1](licenses/texts/npm/71368fd0f5b4129191e9afcd1e1ef2dc89a9090d3e4d80bbab92dafd032b3bef.txt) |
| `https-proxy-agent` | 7.0.6 | MIT | dev-only | [1](licenses/texts/npm/8d8c55319c7729d57be811c747452636688d54f19701ee0752b6b15ad3771d9a.txt) |
| `iconv-lite` | 0.6.3 | MIT | dev-only | [1](licenses/texts/npm/ac779f7314c74f232ef847ea86e714abe25cf6eeb5cc97b69451b74e2af6492d.txt) |
| `indent-string` | 4.0.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `input-otp` | 1.5.0 | MIT | runtime | [1](licenses/texts/npm/079031192fea535a245aa64a637d8433c406b82a14f91c3606b1d63e41c00152.txt) |
| `is-core-module` | 2.17.0 | MIT | dev-only | [1](licenses/texts/npm/5c496ce5ae47eb8e5ddcaa5e29c27c446a3855b19e3a66991b52f361bed22b28.txt) |
| `is-docker` | 2.2.1 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `is-fullwidth-code-point` | 3.0.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `is-potential-custom-element-name` | 1.0.1 | MIT | dev-only | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `is-wsl` | 2.2.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `isexe` | 2.0.0 | ISC | dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `isomorphic.js` | 0.2.5 | MIT | runtime | [1](licenses/texts/npm/dd6488c9c1a4ce2dc978ecee067e5b6a725b52e6057a450b24f1a23bc373b057.txt) |
| `jackspeak` | 3.4.3 | BlueOak-1.0.0 | dev-only | [1](licenses/texts/npm/2c7c5d22ed5a8ee968c64757710979afcd77438c48b4a265b94e615babd8a901.txt) |
| `jiti` | 2.7.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/46231df5a7733c3f52f11b71f3df61813007745b62b09031acfb45fb42d75082.txt) |
| `js-tokens` | 4.0.0 | MIT | build-only, dev-only, runtime | [1](licenses/texts/npm/2213d91c606205c71eb051a199478cdc2adde945893404d7f1421436dd6d5cc1.txt) |
| `js-tokens` | 9.0.1 | MIT | dev-only | [1](licenses/texts/npm/33038d552d766f4501d8da25b66053ed217c61274ffce1c6bee413bb037c259c.txt) |
| `jsdom` | 26.1.0 | MIT | dev-only | [1](licenses/texts/npm/242d37e7cab25cbafc36cc973ee88f9345fddf066afe4f72b7ac3d9ad4e24cce.txt) |
| `jsesc` | 3.1.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `json5` | 2.2.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/53e59feb13058722d977c699eb0407c7bce2f93c949b681bbd2ff31698535927.txt) |
| `kleur` | 3.0.3 | MIT | dev-only | [1](licenses/texts/npm/306fa513e39b23a6e8747520de761809d206b99800ef41907b530226574c59ae.txt) |
| `konva` | 10.9.0 | MIT | runtime | [1](licenses/texts/npm/7190132c82df30243dc2ba512c9509ea3b629329b4266e9f2c3b5dbd04029613.txt) |
| `lib0` | 0.2.119 | MIT | runtime | [1](licenses/texts/npm/5446db1e43fe52faf3faab7e9959fe3762ac11bdc61c0945934c498affd52d73.txt) |
| `lightningcss-android-arm64` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-darwin-arm64` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-darwin-x64` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-freebsd-x64` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-linux-arm-gnueabihf` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-linux-arm64-gnu` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-linux-arm64-musl` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-linux-x64-gnu` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-linux-x64-musl` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-win32-arm64-msvc` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss-win32-x64-msvc` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `lightningcss` | 1.32.0 | MPL-2.0 | build-only, dev-only | [1](licenses/texts/npm/5eba353fe5076ac3432177f8ab1cf75e3afcd0584251e37c3bfead5f447d040e.txt) |
| `linkify-it` | 5.0.1 | MIT | runtime | [1](licenses/texts/npm/95e3f7f0e81e9b4940cdfaa1956aaff5e4dfd2fb1565041e7c78eb9a606f23e3.txt) |
| `linkifyjs` | 4.3.3 | MIT | runtime | [1](licenses/texts/npm/58e6f3677452cca096ce5328ebf7de37a1406bbeeb2f263c1b2ededc8c7d0228.txt) |
| `locate-path` | 5.0.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `locate-path` | 7.2.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `loose-envify` | 1.4.0 | MIT | runtime | [1](licenses/texts/npm/4eb7543b08d955a6d23fcc224601d43ff566e775be918805e26210d7f6eb4893.txt) |
| `loupe` | 3.2.1 | MIT | dev-only | [1](licenses/texts/npm/592141f7b861426ceeff937d85ad04ada5f66e386c5a8696ed1bd680f2cdb552.txt) |
| `lru-cache` | 10.4.3 | ISC | dev-only | [1](licenses/texts/npm/451ec07eeb9c4e1b86de9abdaa426462a8be48f887ec7421cf0bbb9c769555ab.txt) |
| `lru-cache` | 5.1.1 | ISC | build-only, dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `lucide-react` | 0.468.0 | ISC | runtime | [1](licenses/texts/npm/1e7290b35280a048667bbf0ebabac1c7fd52a75300e8b2946ac165715997f2bc.txt) |
| `lz-string` | 1.5.0 | MIT | dev-only | [1](licenses/texts/npm/433fc9dfe659dbfb1e91eed8351f13651e97bfa3ac6d03394c3d63f61d4bbc80.txt) |
| `magic-string` | 0.30.21 | MIT | build-only, dev-only | [1](licenses/texts/npm/1cbe51b907662f6cb1492b16c359384a595180bf0e4d101603ed525e75c4e484.txt) |
| `markdown-it` | 14.2.0 | MIT | runtime | [1](licenses/texts/npm/792c48c5a849a15fdf9e37e8bcf9e6d1dd13b32b46c642a748a0a46a9919d473.txt) |
| `marked` | 18.0.5 | MIT | runtime | [1](licenses/texts/npm/8e3a3f82f59a60958f56ca08f445647c32a4733dc7ca6c2c46f6eb898471ab9c.txt) |
| `mdurl` | 2.0.0 | MIT | runtime | [1](licenses/texts/npm/6b6a356c4337e2446841f30f3cdf7e7023af8c5260b5e347c0f987b9f6aa2644.txt) |
| `min-indent` | 1.0.1 | MIT | dev-only | [1](licenses/texts/npm/9638fa87f845af6cecc56fab498c1f74f4a98522d3b53377bedcbdb44b5a8dcc.txt) |
| `minimatch` | 9.0.9 | ISC | dev-only | [1](licenses/texts/npm/d11323827fa4edeaafc437cc5b91b6971b335f0127efeeb42bf5122fe8657e8f.txt) |
| `minimist` | 1.2.8 | MIT | dev-only | [1](licenses/texts/npm/435a6722c786b0a56fbe7387028f1d9d3f3a2d0fb615bb8fee118727c3f59b7b.txt) |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | dev-only | [1](licenses/texts/npm/8a1af140fdfbf5afd3df27f7e662f989c5b963a300020dfafce42033cae9e004.txt) |
| `mrmime` | 2.0.1 | MIT | dev-only | [1](licenses/texts/npm/ba573393f24555ac0528612ad39665fab5bdcc80330a61096024bbf5f736526d.txt) |
| `ms` | 2.1.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/1662fae9b5314d11cf51284e2dcd1f006a354f7343f08712a730fcff9a359801.txt) |
| `nanoid` | 3.3.15 | MIT | build-only, dev-only | [1](licenses/texts/npm/da4db1480d9beea3483a2eda5c53b22238d0827d57da162b48f122e04d2d9987.txt) |
| `node-releases` | 2.0.48 | MIT | build-only, dev-only | [1](licenses/texts/npm/3706296ed611888111ceccc1dff4712844dea4bde0b185c82d718c3b69895abe.txt) |
| `nwsapi` | 2.2.24 | MIT | dev-only | [1](licenses/texts/npm/2aebdf8ae67777ccb2fa66b32066c1a16bd71085011bb4085dc7408e2947d2c2.txt) |
| `object-assign` | 4.1.1 | MIT | runtime | [1](licenses/texts/npm/6fb9754611c20f6649f68805e8c990e83261f29316e29de9e6cedae607b8634c.txt) |
| `open` | 8.4.2 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `orderedmap` | 2.1.1 | MIT | runtime | [1](licenses/texts/npm/869c30f368eb08735e779027b9f4bc9fea2f39624351856aebe42741f0bc0884.txt) |
| `p-limit` | 2.3.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `p-limit` | 4.0.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `p-locate` | 4.1.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `p-locate` | 6.0.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `p-try` | 2.2.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | dev-only | [1](licenses/texts/npm/a49c9ba464796f65b59fca3f1e6ca40912df1e859f575383223f7ec6c5baae09.txt) |
| `parse5` | 7.3.0 | MIT | dev-only | [1](licenses/texts/npm/8c535800331e1e4439835555b3f9edc7fe9dee2fab0d8bbbd5a982e8b8343d4d.txt) |
| `path-exists` | 4.0.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `path-exists` | 5.0.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `path-key` | 3.1.1 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `path-parse` | 1.0.7 | MIT | dev-only | [1](licenses/texts/npm/3f4609137f65070541b9214300ea0d640af8192857de0eeb2b03403003d9228a.txt) |
| `path-scurry` | 1.11.1 | BlueOak-1.0.0 | dev-only | [1](licenses/texts/npm/8a1af140fdfbf5afd3df27f7e662f989c5b963a300020dfafce42033cae9e004.txt) |
| `pathe` | 2.0.3 | MIT | dev-only | [1](licenses/texts/npm/52e92576851154bad7737e90cc72818936f43665cb0e3f7428ed8edc8cc5709b.txt) |
| `pathval` | 2.0.1 | MIT | dev-only | [1](licenses/texts/npm/5d45910e7ed82fecc3e29b40a5b3a17ceb609fda19f860aa2ec180d87f4f9d4a.txt) |
| `picocolors` | 1.1.1 | ISC | build-only, dev-only | [1](licenses/texts/npm/6582629e2979466878f6014313dcc2f3756c9616148682227ce3063dde310750.txt) |
| `picomatch` | 4.0.4 | MIT | build-only, dev-only | [1](licenses/texts/npm/d0cd141b0c322fded5dfad1d4645bb2fedfc05b7321fe1009469638190d59ef9.txt) |
| `playwright-core` | 1.63.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb.txt) [2](licenses/texts/npm/6d602191187b35b9b01d2cffa01c8469c2c8d9de8a96f1bf868e0f264f51c81d.txt) |
| `playwright` | 1.63.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb.txt) [2](licenses/texts/npm/6d602191187b35b9b01d2cffa01c8469c2c8d9de8a96f1bf868e0f264f51c81d.txt) |
| `pngjs` | 5.0.0 | MIT | runtime | [1](licenses/texts/npm/176b07a18c0bb3836aaeb61088fd0bf11a38f66e6f15e3fbda85faa225250d6e.txt) |
| `postcss` | 8.5.15 | MIT | build-only, dev-only | [1](licenses/texts/npm/5be1f3465bba68a626777f984878814aaf35e7ef8e9fd314d469bcf887050fb8.txt) |
| `pretty-format` | 27.5.1 | MIT | dev-only | [1](licenses/texts/npm/52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85.txt) |
| `prompts` | 2.4.2 | MIT | dev-only | [1](licenses/texts/npm/ade66f698fd417addc4d948a85ef33e8abb302daff6453feda18b191d250e54d.txt) |
| `prop-types` | 15.8.1 | MIT | runtime | [1](licenses/texts/npm/f657f99d3fb9647db92628e96007aabb46e5f04f33e49999075aab8e250ca7ce.txt) |
| `prosemirror-changeset` | 2.4.1 | MIT | runtime | [1](licenses/texts/npm/7543dfe82fa61d5bb2478c78cbd9dfb2cbd500b6ac2893b24ed925773b67fb70.txt) |
| `prosemirror-collab` | 1.3.1 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-commands` | 1.7.1 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-dropcursor` | 1.8.2 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-gapcursor` | 1.4.1 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-history` | 1.5.0 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-inputrules` | 1.5.1 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-keymap` | 1.2.3 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-markdown` | 1.13.4 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-menu` | 1.3.2 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-model` | 1.25.12 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-schema-basic` | 1.2.4 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-schema-list` | 1.5.1 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-state` | 1.4.4 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-tables` | 1.8.5 | MIT | runtime | [1](licenses/texts/npm/d1d2046ebbe6362f9ad8fd4d62e9074f2553f289c0e1de895a650f10ba5f4239.txt) |
| `prosemirror-trailing-node` | 3.0.0 | MIT | runtime | [1](licenses/texts/npm/2a3b698d8ae82cbc7b34e85ee7d4eb06910f48a0544346c765f91600b86dc34b.txt) |
| `prosemirror-transform` | 1.12.0 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `prosemirror-view` | 1.42.6 | MIT | runtime | [1](licenses/texts/npm/ef0b452ced6304db2ce78ca66de1fc7b97bab05bc1750c95df359ed3fe1d65c8.txt) |
| `punycode.js` | 2.3.1 | MIT | runtime | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `punycode` | 2.3.1 | MIT | dev-only | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `qrcode` | 1.5.4 | MIT | runtime | [1](licenses/texts/npm/8df47c6ad9ac2c41eb9b2a72def9908959da0ede8dadd56c7b249c1bdb0c5ce6.txt) |
| `react-aria-components` | 1.21.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `react-aria` | 3.52.1 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `react-docgen-typescript` | 2.4.0 | MIT | dev-only | [1](licenses/texts/npm/a61b261379cbd8e1856fc16892d4c5202500af07d44bf0de58facaa0abe76afe.txt) |
| `react-docgen` | 8.0.4 | MIT | dev-only | [1](licenses/texts/npm/52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85.txt) |
| `react-dom` | 19.2.7 | MIT | dev-only, runtime | [1](licenses/texts/npm/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| `react-is` | 16.13.1 | MIT | runtime | [1](licenses/texts/npm/52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85.txt) |
| `react-is` | 17.0.2 | MIT | dev-only | [1](licenses/texts/npm/52412d7bc7ce4157ea628bbaacb8829e0a9cb3c58f57f99176126bc8cf2bfc85.txt) |
| `react-refresh` | 0.17.0 | MIT | build-only | [1](licenses/texts/npm/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| `react-router-dom` | 7.18.0 | MIT | runtime | [1](licenses/texts/npm/77c9ee6a9c5d5782fb0c50b50d101189116314c14f7df0a1b0d385fc96a7ba49.txt) |
| `react-router` | 7.18.0 | MIT | runtime | [1](licenses/texts/npm/77c9ee6a9c5d5782fb0c50b50d101189116314c14f7df0a1b0d385fc96a7ba49.txt) |
| `react-stately` | 3.50.0 | Apache-2.0 | runtime | [1](licenses/texts/npm/7dfe6526888bac51759c99f9a51262ba2711a8c12a067f2181609dd9a4066b84.txt) |
| `react-transition-group` | 4.4.5 | BSD-3-Clause | runtime | [1](licenses/texts/npm/b9adc17ad75a847d8743be2843935f0842a0ea4f45e7b0c7e17ed0be98614b9b.txt) |
| `react` | 19.2.7 | MIT | dev-only, runtime | [1](licenses/texts/npm/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| `recast` | 0.23.21 | MIT | dev-only | [1](licenses/texts/npm/6ca87d1dce5b82873603e566fd83dabe8771fb169013337d4a14bb9bbf794687.txt) |
| `redent` | 3.0.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `require-directory` | 2.1.1 | MIT | runtime | [1](licenses/texts/npm/a92e52eb1fa7cd746e3827bf01d3a3589bbc8e1e51348b1da042aad165525ad1.txt) |
| `require-main-filename` | 2.0.0 | ISC | runtime | [1](licenses/texts/npm/365496ca1f56da40b23c9815fc40fa9005847b2f8f8fd1c1a4929ef25ec8cd1d.txt) |
| `reselect` | 5.3.0 | MIT | runtime | [1](licenses/texts/npm/e98047a5dee068b33f82e8c4b7a63037b5108c93393198efd4097753004af5dd.txt) |
| `resolve` | 1.22.13 | MIT | dev-only | [1](licenses/texts/npm/60acd7711e6c138e6041836e32d922705254cc1568a30fdf16aa8f59bb87aeaa.txt) |
| `rollup` | 4.62.2 | MIT | build-only, dev-only | [1](licenses/texts/npm/fa1bd040c5bdeefe65b3821cebf474f2733ce65df13089bd151dda1778e62fe8.txt) |
| `rope-sequence` | 1.3.4 | MIT | runtime | [1](licenses/texts/npm/530424aebdd0e73f53238d1f89df250057bc8d8ce090cf5954197fadce5bf226.txt) |
| `rrweb-cssom` | 0.8.0 | MIT | dev-only | [1](licenses/texts/npm/e539937c489c4928ad7461669ec017f4d916fb3565fc26f5b8a0ce816d2ed23c.txt) |
| `safer-buffer` | 2.1.2 | MIT | dev-only | [1](licenses/texts/npm/4bc935e71be198c67ddf3c2b5fddb195f6edc182bfc155a96a6db61b44b494b9.txt) |
| `saxes` | 6.0.0 | ISC | dev-only | [1](licenses/texts/npm/0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e.txt) |
| `scheduler` | 0.27.0 | MIT | dev-only, runtime | [1](licenses/texts/npm/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| `semver` | 6.3.1 | ISC | build-only, dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `semver` | 7.8.5 | ISC | dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `set-blocking` | 2.0.0 | ISC | runtime | [1](licenses/texts/npm/365496ca1f56da40b23c9815fc40fa9005847b2f8f8fd1c1a4929ef25ec8cd1d.txt) |
| `set-cookie-parser` | 2.7.2 | MIT | runtime | [1](licenses/texts/npm/c5c6c5183a789d122f267c405f685037efb87e27fcde28ab1dd7378a2d2f5962.txt) |
| `shebang-command` | 2.0.0 | MIT | dev-only | [1](licenses/texts/npm/69dee148a2cc470554dfa7142e830662062394d0fe67cddd379aba90dc60d6b3.txt) |
| `shebang-regex` | 3.0.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `siginfo` | 2.0.0 | ISC | dev-only | [1](licenses/texts/npm/3bdddf0b9b08aaa2fe4365b803fc958ed32c0597ca0bd727be8d9fcb8b248d18.txt) |
| `signal-exit` | 4.1.0 | ISC | dev-only | [1](licenses/texts/npm/b173e19b9a78df305577ace0e52ef45a4bcc915ea28b47b256dc3b68dcb1f7e7.txt) |
| `sirv` | 3.0.2 | MIT | dev-only | [1](licenses/texts/npm/ba573393f24555ac0528612ad39665fab5bdcc80330a61096024bbf5f736526d.txt) |
| `sisteransi` | 1.0.5 | MIT | dev-only | [1](licenses/texts/npm/ade66f698fd417addc4d948a85ef33e8abb302daff6453feda18b191d250e54d.txt) |
| `source-map-js` | 1.2.1 | BSD-3-Clause | build-only, dev-only | [1](licenses/texts/npm/6cb0631f71c7749763fd3dd1d5bee52dd1070ec17f2edc1710079ad070bd2fbd.txt) |
| `source-map` | 0.6.1 | BSD-3-Clause | dev-only | [1](licenses/texts/npm/6cb0631f71c7749763fd3dd1d5bee52dd1070ec17f2edc1710079ad070bd2fbd.txt) |
| `stackback` | 0.0.2 | MIT | dev-only | Missing upstream text |
| `std-env` | 3.10.0 | MIT | dev-only | [1](licenses/texts/npm/a6f36438e46fb911859f3b9c4cad045ba64e1af3d8f4512c60258fa2d7552d28.txt) |
| `storybook` | 9.1.21 | MIT | dev-only | [1](licenses/texts/npm/bc90586179d44dcb313a9a289d687a2f26226303b2066bd21dbefd2378e894e5.txt) |
| `string-width-cjs` | 4.2.3 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `string-width` | 4.2.3 | MIT | dev-only, runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `string-width` | 5.1.2 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `strip-ansi-cjs` | 6.0.1 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `strip-ansi` | 6.0.1 | MIT | dev-only, runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `strip-ansi` | 7.2.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `strip-bom` | 3.0.0 | MIT | dev-only | [1](licenses/texts/npm/6fb9754611c20f6649f68805e8c990e83261f29316e29de9e6cedae607b8634c.txt) |
| `strip-indent` | 3.0.0 | MIT | dev-only | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `strip-indent` | 4.1.1 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `strip-literal` | 3.1.0 | MIT | dev-only | [1](licenses/texts/npm/af32efdd008a371c77b13eef5010c81d6c5c2f67c054b6bb74317e13ac38c171.txt) |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT | dev-only | [1](licenses/texts/npm/0f0ca96f50793990031ebc488a38f7292ff70bce8ab6a8e5eeda674abc32ccdf.txt) |
| `symbol-tree` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/9ea1eccdabe469767a9edb9249a840b2461cf91b2434bf8a3e2fc1f414311cb1.txt) |
| `tailwind-merge` | 3.6.0 | MIT | runtime | [1](licenses/texts/npm/d4c70c7ce38cea8778f0aed3fc0bef0a9dbd27f13bd8b6773cbd6d37941971e5.txt) |
| `tailwind-variants` | 3.3.1 | MIT | runtime | [1](licenses/texts/npm/f3f8984c684106a9ffb50c44ff5dd6f2082526d78a820235a6592423d376d650.txt) |
| `tailwindcss` | 4.3.1 | MIT | build-only, runtime | [1](licenses/texts/npm/60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985.txt) |
| `tapable` | 2.3.3 | MIT | build-only | [1](licenses/texts/npm/824ef6c33ae5ecbbab65d37f2b37da2bfc81d76cf7676ec0f59d00a0a38bdb75.txt) |
| `tiny-invariant` | 1.3.3 | MIT | dev-only | [1](licenses/texts/npm/b1c501095de70182748cb8e8d97ac5577701a4ef3b755ba30d59fd87b24bdb0f.txt) |
| `tinybench` | 2.9.0 | MIT | dev-only | [1](licenses/texts/npm/cebc084d54e6dd99e53292ddb4bc1cdb63d9bfcd9ce438fe3aa6eb106d79e2ea.txt) |
| `tinyexec` | 0.3.2 | MIT | dev-only | [1](licenses/texts/npm/f95f668fe64081ddb4153b322e34fdd719b991285ed08177d5ad7133b7988d92.txt) |
| `tinyglobby` | 0.2.17 | MIT | build-only, dev-only | [1](licenses/texts/npm/22c68811e174cbbfb3813d4135918df4f540959c14d872e601d9abe83d3cde8f.txt) |
| `tinypool` | 1.1.1 | MIT | dev-only | [1](licenses/texts/npm/0d506ca1b2adc4ee63a9e2384a85d6cf9f014b4cf3d00c162cd60216450324fa.txt) |
| `tinyrainbow` | 2.0.0 | MIT | dev-only | [1](licenses/texts/npm/cebc084d54e6dd99e53292ddb4bc1cdb63d9bfcd9ce438fe3aa6eb106d79e2ea.txt) |
| `tinyspy` | 4.0.6 | MIT | dev-only | [1](licenses/texts/npm/cebc084d54e6dd99e53292ddb4bc1cdb63d9bfcd9ce438fe3aa6eb106d79e2ea.txt) |
| `tippy.js` | 6.3.7 | MIT | runtime | [1](licenses/texts/npm/7f4929c55f525ae510a77c361496c5a86a092434a3681c95a4dc89e951c67e98.txt) |
| `tldts-core` | 6.1.86 | MIT | dev-only | [1](licenses/texts/npm/c64182d48160db948b6aa97a984f1a32974ce4d2053900361264cd33853796cb.txt) |
| `tldts` | 6.1.86 | MIT | dev-only | [1](licenses/texts/npm/c64182d48160db948b6aa97a984f1a32974ce4d2053900361264cd33853796cb.txt) |
| `totalist` | 3.0.1 | MIT | dev-only | [1](licenses/texts/npm/306fa513e39b23a6e8747520de761809d206b99800ef41907b530226574c59ae.txt) |
| `tough-cookie` | 5.1.2 | BSD-3-Clause | dev-only | [1](licenses/texts/npm/22ec6791c91ba42c0516a05f4cbdde019aae4687f8a38c5ca7e8a69ee68f851d.txt) |
| `tr46` | 5.1.1 | MIT | dev-only | [1](licenses/texts/npm/499d6d466d064e0460427967a344e2a32fcb86ea8c6cd1a285ec4f1fa03fba67.txt) |
| `ts-dedent` | 2.3.0 | MIT | dev-only | [1](licenses/texts/npm/eff13095d9d762c3bd9dda74370c81e2130c28f2691bc455603abf973bac25b9.txt) |
| `tsconfig-paths` | 4.2.0 | MIT | dev-only | [1](licenses/texts/npm/8850a2d4828514113042db6ec97237b7ca6cb1599734874e5817d521f8f84e1c.txt) |
| `tslib` | 2.8.1 | 0BSD | build-only, dev-only, runtime | [1](licenses/texts/npm/210b19e543130388c68654b7497e967119ce17145f66ab7d85688fbd70f08751.txt) |
| `tw-animate-css` | 1.4.0 | MIT | runtime | [1](licenses/texts/npm/039184dfa0a822397b3f45a435b5b1e538721587fbade96b9fa80f86cb354109.txt) |
| `typescript` | 5.9.3 | Apache-2.0 | dev-only | [1](licenses/texts/npm/a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47.txt) |
| `uc.micro` | 2.1.0 | MIT | runtime | [1](licenses/texts/npm/483acb265f182907d1caf6cff9c16c96f31325ed23792832cc5d8b12d5f88c8a.txt) |
| `undici-types` | 6.21.0 | MIT | build-only, dev-only | [1](licenses/texts/npm/a6db8096b2707bc0102d256917d4d33f298ba36d8c3f25de067a2b5bb379db27.txt) |
| `unicorn-magic` | 0.1.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `unplugin` | 1.16.1 | MIT | dev-only | [1](licenses/texts/npm/2ef2cbeeb84d5e7a92d208426ef4f841b5447ae0a9e661ffb0983e8985a9f469.txt) |
| `update-browserslist-db` | 1.2.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/c414dde36704bd9c8a76c7aa2921b19270ff9abeb478ea0050250d16cf29b0f6.txt) |
| `use-sync-external-store` | 1.7.0 | MIT | runtime | [1](licenses/texts/npm/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| `vite-node` | 3.2.4 | MIT | dev-only | [1](licenses/texts/npm/ddc110f3b89cc397cee99d3d64c4f746928b7a3bac02fed15101eb4d367079f6.txt) |
| `vite` | 6.4.3 | MIT | build-only, dev-only | [1](licenses/texts/npm/008938a3441801ca3960f8e3ccb4c0738e7996442a53063141d57d3769a7344d.txt) |
| `vitest` | 3.2.6 | MIT | dev-only | [1](licenses/texts/npm/6b861d7554fbc8488a08ee59e613bd488785a2e27bd87b80142e5125abec6f4c.txt) |
| `w3c-keyname` | 2.2.8 | MIT | runtime | [1](licenses/texts/npm/869c30f368eb08735e779027b9f4bc9fea2f39624351856aebe42741f0bc0884.txt) |
| `w3c-xmlserializer` | 5.0.0 | MIT | dev-only | [1](licenses/texts/npm/ab654de803cdaa9e2819ab2e934bdf7f757e308649ec231d78e80e92425cdc34.txt) |
| `webidl-conversions` | 7.0.0 | BSD-2-Clause | dev-only | [1](licenses/texts/npm/a889cc4dbee2ae172c179856b25d75b0b7a5a136e1b97109b9b590b2ff1a879c.txt) |
| `webpack-virtual-modules` | 0.6.2 | MIT | dev-only | [1](licenses/texts/npm/aa523c5b0d9c02231b3837555ddfab2e4d7208158c52c1cead8920f032aab6b3.txt) |
| `whatwg-encoding` | 3.1.1 | MIT | dev-only | [1](licenses/texts/npm/528eec83cb836a0adda9f8fc3d6a2a70a710d6cc0be9a155f92212c8df28acfa.txt) |
| `whatwg-mimetype` | 4.0.0 | MIT | dev-only | [1](licenses/texts/npm/528eec83cb836a0adda9f8fc3d6a2a70a710d6cc0be9a155f92212c8df28acfa.txt) |
| `whatwg-url` | 14.2.0 | MIT | dev-only | [1](licenses/texts/npm/db480f236292a093e77a83c35431a8496624e1e664a3547768a9ce2bdde39877.txt) |
| `which-module` | 2.0.1 | ISC | runtime | [1](licenses/texts/npm/852bf81203aa93aa89afc9f881ebb035322dc7334aaceff435c557634c94a815.txt) |
| `which` | 2.0.2 | ISC | dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `why-is-node-running` | 2.3.0 | MIT | dev-only | [1](licenses/texts/npm/6a134e51aa31496c15a741592fc5d782b2dbf8d8b6b8524e15c8520ae0cd6374.txt) |
| `wrap-ansi-cjs` | 7.0.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `wrap-ansi` | 6.2.0 | MIT | runtime | [1](licenses/texts/npm/48da2f39e100d4085767e94966b43f4fa95ff6a0698fba57ed460914e35f94a0.txt) |
| `wrap-ansi` | 8.1.0 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `ws` | 8.21.0 | MIT | dev-only | [1](licenses/texts/npm/2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef.txt) |
| `xml-name-validator` | 5.0.0 | Apache-2.0 | dev-only | [1](licenses/texts/npm/a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9.txt) |
| `xmlchars` | 2.2.0 | MIT | dev-only | [1](licenses/texts/npm/45d196313c2647d313cc65ca9b093d2d6974b64d35ee7346f2c60c9d518dff2c.txt) |
| `y-prosemirror` | 1.3.7 | MIT | runtime | [1](licenses/texts/npm/5446db1e43fe52faf3faab7e9959fe3762ac11bdc61c0945934c498affd52d73.txt) |
| `y-protocols` | 1.0.7 | MIT | runtime | [1](licenses/texts/npm/5446db1e43fe52faf3faab7e9959fe3762ac11bdc61c0945934c498affd52d73.txt) |
| `y18n` | 4.0.3 | ISC | runtime | [1](licenses/texts/npm/2034cce3b6fafcddd642c4175e01d3ddfc332a53b9f20fdc46b1466dc89ac469.txt) |
| `yallist` | 3.1.1 | ISC | build-only, dev-only | [1](licenses/texts/npm/4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b.txt) |
| `yargs-parser` | 18.1.3 | ISC | runtime | [1](licenses/texts/npm/365496ca1f56da40b23c9815fc40fa9005847b2f8f8fd1c1a4929ef25ec8cd1d.txt) |
| `yargs` | 15.4.1 | MIT | runtime | [1](licenses/texts/npm/2f1a503bfab84b3ba7393627308b3274501e459e3b5185bbb56bbf16cb1602d4.txt) |
| `yjs` | 13.6.33 | MIT | runtime | [1](licenses/texts/npm/341baa53605ed85d6f95782322854cca56c655ebc7fd4712649b8e7afc6020ff.txt) |
| `yocto-queue` | 1.2.2 | MIT | dev-only | [1](licenses/texts/npm/5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3.txt) |
| `zod` | 3.25.76 | MIT | runtime | [1](licenses/texts/npm/3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8.txt) |
| `zustand` | 5.0.14 | MIT | runtime | [1](licenses/texts/npm/c1e6e266563517467b1bf874817d23e426f3149252bd7d42758cd697514b8417.txt) |
<!-- npm-inventory:end -->
