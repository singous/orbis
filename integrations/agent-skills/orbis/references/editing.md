# Targeted edits and recovery

Inspect `orbis --json schema` for exact fields. A normal replacement request:

```json
{
  "operation_id": "00000000-0000-4000-8000-000000000001",
  "expected_version": 7,
  "operations": [{
    "type": "replace_text",
    "block_id": "the-stable-id-returned-by-read",
    "expected_block_revision": 7,
    "match": "Draft",
    "replacement": "Reviewed draft"
  }]
}
```

Submit with `orbis --json operations preview --note NOTE_ID --file operation.json`, then apply the same request for the authorized edit. Preview validates at its stated version without saving; actual application checks again. The server returns stable generated IDs for inserts, changed IDs, committed version and durability. Read the changed blocks afterward. Deleting a container requires explicit `delete_subtree=true`; do not assume shallow children are the entire subtree.

`replace_text` requires one match within a single text run. It preserves marks and link structure. If matching spans different styles, use an explicit shallow block update after reading the full block; do not flatten the text automatically.

A single operation UUID represents one business intent. Same key/same request returns its original receipt; same key/different request yields IDEMPOTENCY_KEY_REUSED. Keep the operation file when the result is uncertain. Query `orbis --json operations get OPERATION_ID`; do not generate a fresh ID to retry the same write.

NOTE_VERSION_CONFLICT/BLOCK_REVISION_CONFLICT requires rereading. TEXT_MATCH_CONFLICT requires inspecting actual content and ambiguity. INTEGRATION_PERMISSION_DENIED or NOTE_NOT_FOUND may indicate a scope restriction; do not switch to raw/private endpoints. `request` uses the same authorization and cannot widen it.

For a new document, `notes import --notebook NOTEBOOK_ID --title TITLE --file draft.md --operation-id UUID` creates one document. Read it and verify content afterward. `notes export NOTE_ID --version VERSION --format json --out file.json` records a fixed content snapshot. Inspect `losses` when using Markdown.

Large Markdown sources automatically use resumable import chunks. Keep the original source and operation ID. An interrupted upload can be continued with the same `notes import` command and ID; confirmed bytes are skipped. Scheduling is not completion. `CLI_IMPORT_PENDING` supplies an import ID: inspect `imports get`, or explicitly `imports finalize` to resume a missing backend task. Do not generate a new operation ID, restart an active codec or duplicate a new document after an observation timeout. Report a saved note only after a committed result and readback.
