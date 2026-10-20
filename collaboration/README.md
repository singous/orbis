# Orbis collaboration engine

This internal Node.js 24 process transforms the persisted Yjs `body` fragment.
The Go application owns authorization, WebSocket connections, database locks,
operation receipts and durable acknowledgments. This service has no rooms,
background saves, database access, accounts or public endpoint. A successful
transform is not a persistence acknowledgment.

```sh
npm --prefix collaboration ci
npm --prefix collaboration test
npm --prefix collaboration run build
ORBIS_COLLABORATION_KEY=<random-secret-of-at-least-32-characters> \
  npm --prefix collaboration start
```

`ORBIS_COLLABORATION_HOST` defaults to `0.0.0.0` and
`ORBIS_COLLABORATION_PORT` defaults to `9203`. Keep this listener inside the
application network. Go sends the same key using `Authorization: Bearer …`.
`GET /healthz` only reports process health. The secret never enters logs or
responses. The process exits cleanly on SIGTERM/SIGINT.

## Internal transform protocol

`POST /transform` uses JSON with all three fields present:

```json
{"state": null, "blocks": [], "update": null}
```

- `state: null, blocks: NativeBlock[]` initializes an existing native document
  exactly once. Empty native content remains an empty fragment.
- `state: base64, update: base64, blocks: null` merges browser updates into the
  persisted binary state. Duplicate updates are safe; missing causal dependencies
  are rejected until the client resynchronizes and resends the complete update.
- `state: base64, blocks: NativeBlock[], update: null` reconciles an API/CLI intent
  against that same state. Stable block IDs retain unaffected XML/text identities;
  inline edits use the Yjs ProseMirror binding. Never rebuild a live CRDT from JSON.
- `state: base64, blocks: null, update: null` reads and validates existing state.

Updates may include `targets: [{client, clock}]` (at most 20,000 entries), using
the original owning block XmlElement Item IDs before the local transaction.
These IDs are checked against persisted state before applying the delta; this
also protects delete-only updates from a move/delete committed before broadcast.
New locally inserted identities may be unknown to persisted state. The provider
captures only preexisting changed targets and retains them with the operation ID
in its binary draft until acknowledgment.
The target budget is twice the native block budget because a nested ordinary
block may have both an owning container and an editable head with distinct XML
identities. Go reserves an additional 4 MiB for transport envelope metadata.

Structural deletion, movement or type replacement also supplies
`content_hash` on the topmost removed owning block target. The shared
`collaboration-fingerprint.ts` codec computes SHA-256 over canonical XML names,
meaningful sorted attributes and text deltas, excluding internal editor caches.
The proof represents the expected server content before the buffered operation;
it is frozen with the operation ID. The engine compares it before applying a
structural deletion so a stale moved copy cannot overwrite a peer's newer text.
Missing or changed proofs return the same recoverable 409. Ordinary text edits
continue to merge without content proofs.

Whole business attributes are atomic: `orbisProps`, table-cell
`orbisCellProps`, table `columnWidths` and cell `colwidth` arrays require the same
baseline content proof, including when an incoming write would lose Yjs's map
tie-break. Cells without a block ID use the closest owning table proof.
Concurrent component properties, cell properties, widths and complete drawing
saves return a recoverable conflict so neither edit is silently acknowledged as
lost. A property operation based on an older subtree also requires recovery
after concurrent body changes; ordinary rich-text updates continue to merge.
Strokes inside a drawing are not merged as collaborative rich text.

The response is `{state, update, state_vector, changed, blocks}`. Binary fields
are standard padded base64. `update` is the delta relative to the input state;
`blocks` uses the public native Go content codec. Go must validate it and commit
both binary state and block projection, along with the operation receipt, in one
transaction before broadcasting or acknowledging the result. Go also confirms
that initializing/reconciling blocks did not change the requested native content.

Failures return `{code}` with no internal exception, schema or document dump.
Malformed requests/content return 422, size limits return 413, and overload or
worker deadlines return 503. Unauthenticated calls return 401.

## Moves, deletion and recovery

Yjs XML does not provide a native tree move: editor moves delete a subtree and
insert its copy. Concurrent text editing in the old removed subtree must not be
acknowledged as saved. The engine retains Yjs tombstone ancestry (`gc: false`) and
returns HTTP 409 `{ "code": "EDIT_TARGET_REMOVED" }` when an explicit target was
removed or a new inserted/formatted item targets such a removed ancestor. Go maps
that to the public recoverable conflict contract;
the client must preserve its binary draft, stop retries, and provide explicit
recovery/export. Ordinary concurrent insertion, removal and formatting inside a
retained paragraph remain mergeable.

Binary state is bounded at 64 MiB, native content at 7 MiB, block count at 10,000,
and native nesting at 32. Go applies a stricter 32 MiB persisted-state budget
and a 16 MiB single-update budget. Worker
execution has a 15 second deadline and at most two requests run or buffer bodies
at once; overload fails immediately. Tombstone growth requires explicit future
maintenance when approaching the binary budget; identities cannot be discarded
by an automatic JSON reseed or unsafe background compaction.

## Building

The build bundles the browser-independent content codec and Tiptap model from
`frontend/src`; browser UI widgets are never imported. The headless ProseMirror
schema consumes `api/editor-prosemirror-schema.json`, including all Orbis custom
components, tables, media and drawings. The frontend parity test compares every
persisted node/mark, content expression, attribute default and meaningful flag
against the actual collaborative Tiptap extensions. Dependencies are exact in `package.json` and
locked in `package-lock.json`; the build needs the repository layout, not a
standalone copy of this directory.

Collaborative schemas omit `orbisOriginal`, `orbisSignature` and
`orbisCellOriginal`. Conversion avoids constructing those recursive snapshots,
so a large leaf nested 32 levels does not multiply its bytes across ancestors.
Legacy cache attributes are accepted when reading old binary states but never
used as content authority. Code blocks retain only compact `orbisCodeFormat`
metadata: the literal's SHA-256 and per-run lengths/styles/links, without a copy
of the literal. It preserves existing accepted rich code representation while
the literal is unchanged; an actual code edit invalidates that representation.
The collaborative schema also supports empty native grids and every native
inline mark combination, including bold inline code. Legacy editor schemas
retain their existing behavior.

A Docker build stage can install only `collaboration/package*.json`, copy
`collaboration/`, `frontend/src/` and the shared API schema, run `npm run build`, and ship only the two
bundled `dist/*.mjs` files in a nonroot pinned Node image. No runtime npm
installation, frontend `node_modules` or writable application volume is needed.
