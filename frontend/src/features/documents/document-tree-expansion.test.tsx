import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteTreeItem } from "../../shared/api/schemas";
import { documentTreeStorageKey, useDocumentTreeExpansion } from "./document-tree-expansion";

function node(id: string, children: NoteTreeItem[] = []): NoteTreeItem {
  return { id, title: id, notebook_id: "notebook", parent_id: null, sort_order: 0, children, created_at_ms: 1, updated_at_ms: 1 } as NoteTreeItem;
}
const items = [node("root", [node("branch", [node("current")]), node("leaf")]), node("other")];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("directory expansion commands", () => {
  it("can collapse every branch even with an active descendant, then locate it without changing the other view", () => {
    const side = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items, "current", "side"));
    const main = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items, undefined, "main"));
    expect(side.result.current.allExpanded).toBe(true);
    act(() => side.result.current.collapseAll());
    expect(side.result.current.isExpanded("root")).toBe(false);
    expect(side.result.current.isExpanded("branch")).toBe(false);
    expect(side.result.current.isExpanded("leaf")).toBe(true);
    expect(main.result.current.allExpanded).toBe(true);
    act(() => side.result.current.reveal("current"));
    expect(side.result.current.allExpanded).toBe(true);
    expect(main.result.current.allExpanded).toBe(true);
  });

  it("reveals only ancestors and preserves a target branch's own collapsed preference", () => {
    const view = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items));
    act(() => view.result.current.collapseAll());
    act(() => view.result.current.reveal("branch"));
    expect(view.result.current.isExpanded("root")).toBe(true);
    expect(view.result.current.isExpanded("branch")).toBe(false);
    expect(view.result.current.allExpanded).toBe(false);
    act(() => view.result.current.expandAll());
    expect(view.result.current.allExpanded).toBe(true);
  });

  it("restores independent bulk preferences and ignores an unavailable locate target", () => {
    const main = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items, undefined, "main"));
    act(() => main.result.current.collapseAll());
    const saved = localStorage.getItem(documentTreeStorageKey("workspace", "notebook", "main"));
    expect(main.result.current.reveal("missing")).toBe(false);
    expect(localStorage.getItem(documentTreeStorageKey("workspace", "notebook", "main"))).toBe(saved);
    main.unmount();
    const restored = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items, undefined, "main"));
    expect(restored.result.current.isExpanded("root")).toBe(false);
    const side = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", items));
    expect(side.result.current.allExpanded).toBe(true);
  });

  it("disables bulk operations when the directory has no branch", () => {
    const view = renderHook(() => useDocumentTreeExpansion("workspace", "notebook", [node("leaf")]));
    expect(view.result.current.hasBranches).toBe(false);
    expect(view.result.current.allExpanded).toBe(false);
  });
});
