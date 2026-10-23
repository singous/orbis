# Board frontend

The React shell, inspector and library are ordinary product UI. Konva is confined
to `renderer.ts`; persisted data, operations, templates and geometry have no Konva
identities. Styling can be replaced independently of the board format.

- `model.ts` validates the public v1 contract and uses the shared shape catalog.
- `session.ts` owns optimistic state, durable IndexedDB operations and bounded undo.
  The journal is written before transmission. Retries preserve original operation
  IDs and payloads. A stream notification is never treated as a save receipt.
  Compare-and-swap journal writes prevent another window's pending edits being
  overwritten. Unknown outcomes must be resolved before discarding a draft.
- `sync.ts` resumes committed changes over an authenticated WebSocket; bounded REST
  polling is a fallback. Connection failure does not replace the durable queue.
- `geometry.ts` provides world-space hit candidates, ports and paths.
  `transforms.ts` moves/scales descendants atomically. `mindmap.ts` owns topic
  relationships and collapsed visibility; `templates.ts` builds complete scenes.
- `renderer.ts` culls by viewport, separates scene and overlay layers, simplifies
  global overviews, and temporarily reduces DPR during motion. Pointer previews
  do not commit React scene state on every frame.
- ELK layout runs in an owned, cancellable worker with a timeout. The editor and
  worker are loaded only when needed. Ordinary embeds use authenticated SVG previews.
- Tabler icons are self-hosted, searchable and sharded; `sync-board-assets.mjs`
  verifies frontend icon bytes against the backend contract. Icon and image caches,
  image decode concurrency, pending operations and undo bytes are bounded.
- SVG/PNG export describes the active page. Editable JSON bundles carry images;
  import validates all identities/references before uploading and performs one
  board transaction. Import limits are explicit, with no truncation.
- Remix Icon 4.6.0 (Apache-2.0) is used only for interface controls. Tabler 1.2.42
  (MIT) supplies editable diagram icons. License files ship in `public/licenses/`.

Run `npm run typecheck`, `npm run test:run -- src/features/boards`, `npm run build`,
and `npm run test:e2e -- tests/e2e/boards/editor.spec.ts`.
Set `ORBIS_E2E_PRODUCTION=1` for the built app and provide the exact locally built
collaboration image via `ORBIS_TEST_COLLABORATION_IMAGE` to verify native embeds in
the real Yjs body editor.

The renderer benchmark builds with
`npx vite build --config tests/bench/boards/vite.config.ts`, serves on port 9321 via
the corresponding Vite preview config, and runs with
`BOARD_BENCH_URL=http://127.0.0.1:9321/ BOARD_BENCH_DPR=2 node tests/bench/boards/run.mjs`.
Keep results local; record device, browser, viewport and whether the build is production.
