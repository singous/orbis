import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ViewDialog } from "./TableSettings";
import type { TableDefinition } from "./model";

it("saves datetime filters as UTC+8 milliseconds and checkbox filters as booleans", () => {
  const definition: TableDefinition = {
    title: "Types",
    fields: [
      { id: "date", name: "日期", kind: "datetime", options: [] },
      { id: "done", name: "完成", kind: "checkbox", options: [] },
    ],
    views: [
      {
        id: "view",
        name: "全部",
        kind: "grid",
        field_ids: ["date", "done"],
        widths: {},
        sorts: [],
        group_field_id: null,
        filters: [
          { field_id: "date", operator: "gt", value: null },
          { field_id: "done", operator: "eq", value: false },
        ],
      },
    ],
    public_view_id: "view",
    public_field_ids: ["date"],
  };
  const save = vi.fn();
  render(
    <ViewDialog
      definition={definition}
      view={definition.views[0]}
      onClose={() => {}}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("筛选值 1"), {
    target: { value: "2026-10-05T08:00" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "筛选值 2" }));
  fireEvent.click(screen.getByRole("button", { name: "保存视图" }));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0].views[0].filters).toEqual([
    {
      field_id: "date",
      operator: "gt",
      value: Date.parse("2026-10-05T08:00:00+08:00"),
    },
    { field_id: "done", operator: "eq", value: true },
  ]);
});
