import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ViewSettings } from "./ViewSettings";
import { SheetWorkspaceMenu } from "./SheetWorkspaceMenu";
import { FieldManager } from "./FieldManager";
import { newField, type View } from "./model";
afterEach(cleanup);
const fields = [{ ...newField(), name: "Title" }, { ...newField(), name: "Notes" }, { ...newField(), name: "Date" }];
const view: View = { id: "view", name: "Grid", kind: "grid", field_ids: fields.map(field => field.id), widths: {}, filters: [], sorts: [], group_field_id: "", row_height: 40, text_colors: {}, highlight_duplicates: [] };
it("reorders by keyboard, hides columns via the eye and persists only visible order", async () => {
  const save = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  const user = userEvent.setup();
  render(<FieldManager fields={fields} view={view} anchor={{ left: 0, top: 0 }} onSave={save} onClose={close} />);
  act(() => screen.getByRole("button", { name: "拖拽排序Date" }).focus());
  await user.keyboard("{ArrowUp}{ArrowUp}");
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  await user.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...view, field_ids: [fields[2].id, fields[0].id] }));
  expect(close).toHaveBeenCalledOnce();
});
it("preserves one visible field and leaves the draft open on save failure", async () => {
  const close = vi.fn(), save = vi.fn().mockRejectedValue(new Error("Failure"));
  const user = userEvent.setup();
  render(<FieldManager fields={fields} view={{ ...view, field_ids: [fields[0].id] }} anchor={{ left: 0, top: 0 }} onSave={save} onClose={close} />);
  expect(screen.getByRole("checkbox", { name: "Title" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "应用" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "字段管理" })).toBeVisible();
});

it("does not create unsupported system-column filters through either entry point", () => {
  const system = { ...newField("created_at"), name: "Created" };
  const ui = render(<ViewSettings mode="filter" initialFieldID={system.id} fields={[...fields, system]} view={view} anchor={{ left: 0, top: 0 }} onSave={vi.fn()} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /筛选字段 1/ })).not.toBeInTheDocument();
  ui.unmount();
  render(<SheetWorkspaceMenu menu={{ kind: "field", field: system, anchor: { left: 0, top: 0 } }} busy={false} fieldCount={4} visibleFieldCount={3} viewCount={1} onClose={vi.fn()} onRename={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} onColor={vi.fn()} onFieldAction={vi.fn()} />);
  expect(screen.getByRole("menuitem", { name: "按本列筛选" })).toBeDisabled();
});
