# shadcn copied-source provenance

The Button and Dialog registry snapshots in this directory are unchanged copies of the recorded `base-nova` JSON. Their source repository is [shadcn-ui/ui](https://github.com/shadcn-ui/ui), and their reproducible content revision is [`c257f688cf4de7ec10cc1be84cad29cd4631182c`](https://github.com/shadcn-ui/ui/commit/c257f688cf4de7ec10cc1be84cad29cd4631182c).

`sourceRevisionKind: "reproducible-content"` in [ui.registry.json](../../frontend/packages/ui/ui.registry.json) means that the upstream source at this commit generated the exact frozen JSON bytes using the upstream functions described below. It does not identify the website deployment that originally served the download. `servedRevision: null` records that the historical deployment revision is unknown. The original download time is also unknown.

The registry's existing `cliVersion: "4.23.0"` record is preserved. Its acquisition record states that the registry JSON was downloaded directly without CLI overwrite. The verified upstream commit contains the CLI source version `4.20.1`; this reproduction is separate from acquisition and does not establish which CLI commands ran during acquisition. The components remain `experimental`; this evidence does not grant an API-stability or license approval.

## Fixed upstream inputs

All links below name the same immutable commit. The downloaded files' Git blob identities were checked against the official GitHub repository before running the reproduction.

- Component source: [apps/v4/registry/bases/base/ui/button.tsx](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/bases/base/ui/button.tsx) and [apps/v4/registry/bases/base/ui/dialog.tsx](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/bases/base/ui/dialog.tsx).
- Component metadata: [apps/v4/registry/bases/base/ui/_registry.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/bases/base/ui/_registry.ts) and [apps/v4/registry/bases/base/registry.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/bases/base/registry.ts).
- Nova style map: [apps/v4/registry/styles/style-nova.css](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/styles/style-nova.css).
- Registry pipeline: [apps/v4/scripts/build-registry.mts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/scripts/build-registry.mts).
- Style functions: [packages/shadcn/src/styles/create-style-map.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/styles/create-style-map.ts), [transform.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/styles/transform.ts), and [transform-style-map.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/styles/transform-style-map.ts).
- JSON builder: [packages/shadcn/src/commands/build.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/commands/build.ts), [registry/loader.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/registry/loader.ts), and [registry/schema.ts](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/registry/schema.ts).
- Formatting configuration: [apps/v4/package.json](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/package.json). Its Tailwind formatting context uses [apps/v4/app/globals.css](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/app/globals.css), [legacy-themes.css](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/app/legacy-themes.css), and the [packages/shadcn/src/tailwind.css](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/src/tailwind.css) export.
- Dependency versions: [pnpm-lock.yaml](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/pnpm-lock.yaml) and [packages/shadcn/package.json](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/packages/shadcn/package.json).

## Verified reproduction

The bounded reproduction ran in a temporary directory with Node `22.23.3`, TypeScript `5.9.3`, and npm `10.9.9`. Its direct dependencies were pinned as follows:

| Role | Exact packages |
| --- | --- |
| Formatting | `prettier@3.6.2`, `@ianvs/prettier-plugin-sort-imports@4.6.1`, `prettier-plugin-tailwindcss@0.7.2` |
| Tailwind context and class merging | `tailwindcss@4.3.0`, `tw-animate-css@1.4.0`, `cn@0.2.4` |
| Source/style parsing and schemas | `ts-morph@26.0.0`, `postcss@8.5.6`, `postcss-selector-parser@7.1.0`, `zod@3.25.76` |
| Builder filesystem and output helpers | `commander@14.0.0`, `fs-extra@11.3.1`, `rimraf@6.0.1`, `ora@8.2.0`, `kleur@4.1.5` |

To repeat this content check, use an isolated directory, the fixed upstream files, and npm-installed pinned tools. Preserve the upstream relative paths and the formatting configuration's CSS import context. Select only Button and Dialog from the upstream metadata, then run these upstream stages:

1. `createStyleMap` reads the official Nova CSS. `transformStyle` and `transformStyleMap` expand the authored component styles.
2. `getCachedStyledContent` in the registry pipeline performs that transformation, rewrites the Base registry import path to `base-nova`, and runs the upstream Prettier configuration.
3. `buildRegistryJsonFile` builds the registry input and infers the `cn` dependency from the transformed files.
4. The CLI's `build.action` callback uses its loader and schema to read those files and write the two component JSON files.
5. Compare the generated files to the snapshots below, then remove only the isolated generated workspace and transformation cache and repeat the generation.

The verification executed the actual upstream modules and unchanged AST-extracted pipeline statements and CLI callback, rather than reimplementing their transformations. Only two registry items and `base-nova` were selected. Its error handler rethrew exceptions so an error could not become a successful comparison. The frozen Orbis snapshots were first read after generation, solely for comparison. Both the initial run and the subsequent run with the generated workspace and cache removed matched every byte:

| Frozen output | Bytes | SHA256 |
| --- | ---: | --- |
| [shadcn-button.registry.json](shadcn-button.registry.json) | 3821 | `9ba7e870178813f0552b818a913a2792fb500c779e36395740b4973e3025d427` |
| [shadcn-dialog.registry.json](shadcn-dialog.registry.json) | 5119 | `40fc321d25eb9590d07db54b00d9bc1a74274a549aa06d5915a34ba302ed8b94` |

This proves a reproducible source for these two copied artifacts. It is not a claim that a complete shadcn website build or the historical deployment was reproduced. The large temporary source capture and microharness are not part of this repository.

`ui.registry.json` defines local lifecycle timestamps separately: `addedAt` and `updatedAt` are Unix milliseconds from Git author times for first introduction and the latest direct component implementation change. They are not download or deployment timestamps. The MIT text and copyright remain in [shadcn-ui-MIT.txt](../texts/shadcn-ui-MIT.txt).
