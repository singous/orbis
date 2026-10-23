# Native boards

The board aggregate owns typed elements, page identities, group versions, durable
operations and temporal revisions. It does not store Konva or Excalidraw objects.
The owner document supplies directory placement and current visibility; its primary
board block is a reference. Legacy drawing blocks keep their existing behavior.

## Boundaries

- `api/board-catalog.json` is the versioned shape/path contract. Shape v1 geometry
  and `api/board-icons.json` (Tabler 1.2.42) remain immutable dependencies of schema v1.
  New shapes are additive. Changing existing geometry requires an explicit version
  dispatch/migration, preserving historical renderability.
- `Service` validates commands before persistence. The Postgres adapter locks
  membership, directory and board in that order, then atomically commits current
  elements, temporal elements, revision and operation receipt.
- Geometry/style/text/structure have separate expected versions. Geometry also
  depends on structure; structural changes depend on geometry and text. A conflict
  rolls back the complete batch. Deletion cascades to descendants and incident
  edges; restoration is explicit and advances versions.
- Agent adapters reuse the same service in the token transaction. Token receipts
  and business writes commit together. Images remain scoped to the owning document,
  including history; a reference in another document does not grant asset access.
- The WebSocket transport streams only committed changes and resumes from the last
  applied revision. HTTP mutations/receipts remain authoritative. Access is checked
  on every bounded poll. The application owns connection limits and shutdown.
- Public delivery projects a selected page/frame into server-generated SVG and text.
  Publication stores that projection and copies its assets; later draft changes
  cannot alter the published result. Live shares never widen through a cross-document
  reference. Preview rendering is limited to four concurrent jobs.

## Budgets and extension

Limits are named in `board.go`: 10,000 elements/page, 50,000/board, 20 pages,
500 touched elements/command batch, 1 MiB input, 4 MiB mutation receipt, 20 MiB
normalized page content and 32 MiB complete snapshot. Element cursors and incremental
reads also enforce byte budgets, independently of count limits. PNG generation is
client-side and bounded by pixel count; a server SVG preview embeds at most 8 MiB
of managed raster bytes and produces at most 16 MiB of SVG.

Ordinary imports are atomic and bounded. Large imports/copies, queued export jobs,
presence cursors, anchored element comments and legacy conversion are separate
extensions; there is no partially successful large import or automatic conversion
of an existing drawing. The existing document comment panel remains available.
Historical whole-board files can be exported and reimported as independent pages.

Migration 25 is additive. Its down migration refuses to remove board data or board
integration receipts. Application rollback must preserve the schema and data.
No migration or service switch is implied by building this branch.

## Verification

- `sh scripts/go.sh test ./...`, `sh scripts/go.sh vet ./...`, `sh scripts/go.sh build ./...`
- `sh scripts/testenv.sh integration --package ./tests/board -race -v`
  with an explicitly selected CI image containing the required Go toolchain and gcc.
- Frontend board unit tests, production Playwright journeys, and the independent CLI
  checks cover persistence, uncertain responses, immutable snapshots, scope, media,
  imports, undo/redo, field ports and reference embedding.
- `frontend/tests/bench/boards/` contains a reproducible mixed-scene renderer harness.
  It measures the rendering layer, not server loading, concurrent-network latency
  or a 30-minute complete-product memory test.

Embedding is limited to 32 board blocks per document. Sharing/publication deduplicate
identical reference scopes within each request; a site supports up to 200 distinct
board views and retains its aggregate 32 MiB snapshot budget.
