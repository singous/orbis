import { expect, it } from "vitest";
import { removeFieldDefinition, updateFieldDefinition } from "./definition";
import { newField, type Sheet, type View } from "./model";

const field = newField("select");
const other = newField("text");
function definition(): Sheet["definition"] {
  const view: View = {
    id: "grid", name: "Grid", kind: "grid", field_ids: [field.id, other.id],
    filters: [{ field_id: field.id, operator: "eq", value: "A" }, { field_id: other.id, operator: "eq", value: "B" }],
    sorts: [{ field_id: field.id, descending: true }, { field_id: other.id, descending: false }],
    group_field_id: field.id, widths: { [field.id]: 120, [other.id]: 200 },
    text_colors: { [field.id]: "purple", [other.id]: "blue" },
    highlight_duplicates: [field.id, other.id], row_height: 40,
  };
  return { fields: [field, other], views: [view, { ...structuredClone(view), id: "kanban", kind: "kanban" }] };
}

it("removes a column's dependent configuration from every view while preserving unrelated settings", () => {
  const original = definition();
  const snapshot = structuredClone(original);
  const result = removeFieldDefinition(original, field.id);
  expect(result.fields).toEqual([other]);
  for (const view of result.views) {
    expect(view.field_ids).toEqual([other.id]);
    expect(view.filters).toEqual([original.views[0].filters[1]]);
    expect(view.sorts).toEqual([original.views[0].sorts[1]]);
    expect(view.group_field_id).toBe("");
    expect(view.widths).toEqual({ [other.id]: 200 });
    expect(view.text_colors).toEqual({ [other.id]: "blue" });
    expect(view.highlight_duplicates).toEqual([other.id]);
    expect(view.row_height).toBe(40);
  }
  expect(original).toEqual(snapshot);
});

it("inserts a field in each view but preserves existing order and hidden columns when editing", () => {
  const original = definition();
  original.views[1].field_ids = [other.id];
  const snapshot = structuredClone(original);
  const inserted = newField("number");
  const result = updateFieldDefinition(original, inserted, 1);
  expect(result.fields.map(value => value.id)).toEqual([field.id, inserted.id, other.id]);
  expect(result.views[0].field_ids).toEqual([field.id, inserted.id, other.id]);
  expect(result.views[1].field_ids).toEqual([other.id, inserted.id]);
  const edited = updateFieldDefinition(original, { ...field, name: "Renamed" }, 1);
  expect(edited.fields[0].name).toBe("Renamed");
  expect(edited.views).toEqual(original.views);
  expect(original).toEqual(snapshot);
});

it("inserts beside the displayed column even when views use different field orders", () => {
  const original = definition();
  original.views[0].field_ids = [other.id, field.id];
  const inserted = newField("number");
  const next = updateFieldDefinition(original, inserted, 0, { fieldID: field.id, after: false });
  expect(next.views[0].field_ids).toEqual([other.id, inserted.id, field.id]);
  expect(next.views[1].field_ids).toEqual([inserted.id, field.id, other.id]);
});
