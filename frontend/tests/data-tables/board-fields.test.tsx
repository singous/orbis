import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TableBoard } from "../../src/features/data-tables/TableBoard";
import type { TablePage } from "../../src/features/data-tables/model";

const mocks = vi.hoisted(() => ({ readTable: vi.fn() }));
vi.mock("../../src/features/data-tables/api", () => mocks);
afterEach(cleanup);

it.each([
  { fieldIds: [], label: "Alpha task 状态 待办" },
  { fieldIds: ["state", "title"], label: "待办 标题 Alpha task" },
])("respects the view field selection $fieldIds", async ({ fieldIds, label }) => {
  const definition: TablePage["definition"] = {
    title: "Tasks", fields: [
      { id: "title", name: "标题", kind: "text", options: [] },
      { id: "state", name: "状态", kind: "select", options: [{ id: "todo", label: "待办", color: "gray" }] },
    ],
    views: [], public_view_id: "board", public_field_ids: [],
  };
  const view = { id: "board", name: "看板", kind: "kanban" as const, field_ids: fieldIds, group_field_id: "state", filters: [], sorts: [], widths: {} };
  const page: TablePage = { table_id: "table", block_id: "block", revision: 1, content_version: 1, definition, view_id: "board", records: [], total: 1, offset: 0, next_offset: 1, has_more: false, groups: [{ id: "todo", name: "待办", count: 1 }] };
  mocks.readTable.mockResolvedValue({ ...page, records: [{ id: "row", values: { title: "Alpha task", state: "todo" } }] });
  render(<TableBoard host={{ noteId: "note", draftScope: "", readOnly: true, auth: null }} page={page} definition={definition} view={view} onMove={() => {}} onRecord={() => {}} />);
  expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
});
