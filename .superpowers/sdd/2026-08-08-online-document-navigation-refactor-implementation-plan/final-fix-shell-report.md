# Workspace shell final-fix report

## Scope

- Decoupled the generic workspace shell from document navigation by adding section title and menu slots.
- Moved the document function menu into the documents feature and injected it from `DocumentShell`.
- Kept Home and Account Settings on the generic shell, with no document-function column.
- Added explicit workspace content mutation and member-management capabilities. Content mutation is denied when the workspace is absent or the role is `normal`.
- Replaced all former `role !== "normal"` document write guards with the content mutation capability.

## TDD evidence

- RED: focused workspace/document tests failed because the generic shell still rendered document functions and a null workspace still exposed document mutations.
- GREEN: focused suites passed: 62 tests in 4 files.

## Verification

- `npm run test:run` — 14 files, 85 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.
- Frontend audit found no remaining production `role !== "normal"` or `role === "normal"` checks.

## Boundary checks

- `WorkspaceShell` does not query document data and no longer owns document menu content.
- Document routes retain five function-menu links.
- The desktop document-menu column is only enabled by the `has-section-menu` layout contract; generic workspace pages use the business rail plus workspace grid.
- Existing context hidden-mounting and dual-drawer tests remain green.
