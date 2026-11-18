# Orbis command presentation

`CommandPopup`, `CommandInput`, `CommandList` and `CommandResult` compose the workspace search palette and the public reader search dialog. `CommandMessage` and `CommandFooter` provide their prompt, empty and keyboard hint presentation. Import these parts from `shared/ui/command`; use the application catalog at `/__ui` for a representative workspace composition.

Selected workspace secondary text uses the existing item foreground token: the original muted text measured 4.48:1 against the light selected background, below the 4.5:1 requirement. Unselected text and reader colors retain their existing tokens.

The popup establishes a presentation scope with two explicit presets. `workspace` keeps the fixed 720×480 search workspace and the 560px narrow-screen breakpoint. `reader` keeps a content-height 660px popup, the 800px breakpoint and the enclosing reader's local tokens. The scope contains only the preset: no query, result model, request, keyboard state or navigation state.

## Ownership

- The feature owns the root `Dialog`, open/close callbacks and exit lifetime. It also supplies the popup's initial/final focus, local portal container, ref and event handlers. In particular, the workspace waits for `onOpenChangeComplete`; the reader portals inside its own theme boundary.
- `CommandInput` creates the header, search icon and combobox relationship. The feature supplies `listId`, `activeId`, the accessible input name, its ref and all input/composition/keyboard handlers. It continues to decide whether Enter/Escape belongs to an input method.
- `CommandList` creates the listbox. Its ID, accessible name, busy state, ref and content remain caller-owned. The workspace can use its category layout without changing category selection behavior.
- `CommandResult` creates the selected option's icon, title, path, excerpt and optional metadata. Text conversion, query highlighting, comment prefixes and result-specific labels remain caller-owned. The reader retains a `small` path and truncated excerpt; the workspace retains a span path, optional two-line excerpt and trailing type/status.
- `CommandMessage` renders a prompt or empty state from supplied content. The feature decides when to show it and keeps loading and error decisions.
- `CommandFooter` owns the keyboard hint region's layout. Its default hints match the reader; the workspace supplies its close control and live opening status as children.

## Preserve the interactive root

Pass an explicit `element` to `CommandResult`. It clones that element to add only `role`, `aria-selected`, presentation classes and the result content. It never wraps the element, merges events or replaces its handlers, ref, attributes or native focus policy.

```tsx
<CommandResult
  selected={activeId === resultId}
  icon={FileText}
  title={title}
  path={location}
  excerpt={snippet}
  element={<Link id={resultId} to={href} tabIndex={-1} onClick={openResult} />}
/>
```

Workspace results therefore remain router links with real URLs and modifier-click behavior. Reader results remain native buttons with their existing tab order and Enter activation. The features retain selection indices, scrolling, ranking, pagination, query debounce/cache, save-before-navigation, cancellation, session checks and routing. This pattern must not acquire those responsibilities.

The existing reader/search Vitest and Playwright suites cover both real consumers, including IME Enter/Escape, selection IDs, distinct native roots/tab order, local themes, result ordering, filters/pagination, save failure/cancellation, exit completion and focus restoration. No third-party UI library types or feature query/result types cross this contract.
