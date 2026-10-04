# Orbis CLI

Install the independent Python package with `uv tool install /path/to/orbis/orbis-cli` or `pip install /path/to/orbis/orbis-cli`. Python 3.12 or newer is required. The resulting `orbis` command works from any directory and does not import the backend or access its database.

Create an integration token in Orbis account settings. Select a workspace, read/edit permissions, optional notebook or exact-document scope, and expiry. The token is shown once. Store it through `orbis auth login --token-stdin --base-url https://orbis.example/api --workspace WORKSPACE_UUID`; the CLI verifies it and uses the OS credential store. A secret manager may inject `ORBIS_TOKEN` instead. Do not pass tokens as command arguments. Non-secret settings can be saved with `orbis config set --base-url URL --workspace UUID`. Environment configuration uses `ORBIS_BASE_URL`, `ORBIS_WORKSPACE_ID`, `ORBIS_PROFILE`, and `ORBIS_CONFIG_DIR`. Flags override environment and profile; credentials use the environment before OS keyring. HTTP requires explicit `--allow-http` for trusted development instances.

```sh
orbis --help
orbis --json doctor
orbis --json workspaces list
orbis --json notebooks list --limit 20
orbis --json notes resolve --title 'Meeting notes'
orbis --json notes get NOTE_UUID
orbis --json notes outline NOTE_UUID --limit 32
orbis --json blocks list --note NOTE_UUID --version 7 --limit 32
orbis --json blocks get BLOCK_ID --note NOTE_UUID --version 7
orbis --json schema
orbis --json operations preview --note NOTE_UUID --file operations.json
orbis --json operations apply --note NOTE_UUID --file operations.json
orbis --json operations get OPERATION_UUID
orbis --json notes export NOTE_UUID --version 8 --format json --out document.json
orbis --json notes create --notebook NOTEBOOK_UUID --title 'Draft' --operation-id OPERATION_UUID
orbis --json notes import --notebook NOTEBOOK_UUID --title 'Draft' --file draft.md --operation-id OPERATION_UUID
```

Use a stable operation UUID for one business intent, including retries. An edit request contains `operation_id`, `expected_version`, and an `operations` array. `orbis schema` returns the exact discriminated schemas. Supported operations are `update_block`, `replace_text`, `insert_blocks`, `move_block`, `delete_block`, and `update_metadata`. Update payloads are shallow and omit `children`; deletion of containers requires `delete_subtree=true`. A text replacement must match uniquely in one rich-text run. `--file -` reads stdin; input is bounded to one MiB. Markdown import creates a new document and never implicitly replaces an existing document.

```json
{"operation_id":"00000000-0000-4000-8000-000000000001","expected_version":7,"operations":[{"type":"replace_text","block_id":"paragraph-id","expected_block_revision":7,"match":"draft","replacement":"approved draft"}]}
```

All machine-mode output is one JSON envelope: `{code,message,request_id,data}`. Server envelopes pass through, with credentials redacted; local successes use `OK` and a null request ID. Local errors use `CLI_*`. `doctor` always emits diagnostic data, including missing setup, credential source and reachability, and exits nonzero if setup fails. Lists are bounded and return `next_cursor`; repeat with the same `--version` for content pages. Child descriptors distinguish omitted subtrees and oversized unloaded payloads. Do not infer deletion from a shallow page.

Export requires an explicit version and output filename; JSON preserves native structure, while Markdown returns `losses` for components that cannot roundtrip completely. The synchronous export budget is 8 MiB; larger documents can be read page by page. Local `notes create --dry-run` shows the request and explicitly reports that server validation was not performed.

On response loss, create/apply query the original operation ID before retrying the same payload. They never generate a new key or rewrite a version on conflict. Receipts and content commit together. HTTP redirects never receive authorization. Raw `request get/post` accepts only the configured instance's `/open/v1/` paths and is subject to identical server authorization; internal endpoints are rejected. `api ls` and `schema` expose discovery.

Exit codes: 0 success (including empty lists); 2 invalid input or missing resource; 3 authentication; 4 forbidden; 5 conflict; 6 network/rate-limit/result unknown; 7 server/protocol; 8 unsupported capability; 130 interrupted. Read retries are bounded. Writes retry only via the idempotent domain commands.

The distributable skill is `integrations/agent-skills/orbis`. Copy that folder into the agent's skill directory. Keep it at the same release as the CLI. Site, knowledge-base and multidimensional-table capabilities must be checked with `capabilities`; unsupported features are never represented as successful commands.

Attachments require separate files:read/files:write permissions. `files upload --note NOTE_UUID --file report.pdf --operation-id UUID` verifies SHA-256 and returns a native `orbis-file:` block template; insert it through an explicit operation. `files get FILE_UUID --note NOTE_UUID` and `files download FILE_UUID --note NOTE_UUID --out file.pdf` enforce the same note grant and verify downloaded bytes. Uploads are bounded to 20 MiB.

Live sharing requires shares:manage and a scope covering the notebook. `shares create --notebook NOTEBOOK_UUID --root-note NOTE_UUID --acknowledge-public-scope` makes this hierarchy and future descendants public; omit root-note to share the notebook. `shares list --notebook NOTEBOOK_UUID` returns current shares and recoverable links, and `shares revoke SHARE_UUID` revokes access. These links track live online content independently of site publication. Exact-note tokens cannot authorize future descendants. Creation is an explicit non-retried action; after network uncertainty inspect shares list before trying again.

Large Markdown import uses a resumable protocol (default 32 MiB, configurable by the instance). Sources above the inline JSON budget automatically use 256 KiB chunks, independent per-chunk and complete-file SHA-256 checks, persistent progress and asynchronous finalization. `--file -` spools bounded stdin privately before using the same protocol. Uploading or scheduling is not a saved document: the CLI waits for a committed result, then returns the actual note ID/version. Codec work runs outside the API event loop, and the document becomes active atomically with its receipt.

Keep the same `--operation-id` to resume an interrupted upload; the CLI seeks the last confirmed offset and does not retransmit earlier chunks. Same offset/different bytes is a conflict. `notes import ... --wait-seconds 0` returns `CLI_IMPORT_PENDING` with its import ID when processing is unfinished. Inspect `imports get IMPORT_ID`; `imports finalize IMPORT_ID --wait-seconds 60` explicitly resumes a missing backend task or observes an already active one. A response-loss/observation timeout never starts another active codec or creates another note. Repeated successful imports/finalizations return the original note. Failed codecs or changed permissions create no partially visible document.
