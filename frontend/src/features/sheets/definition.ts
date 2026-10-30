import type { Field, Sheet } from "./model";

type Definition = Sheet["definition"];

/** Keep field order and every view's column order consistent without mutating the source. */
export function updateFieldDefinition(definition: Definition, field: Field, insertIndex?: number, relative?: { fieldID: string; after: boolean }): Definition {
  const existingIndex = definition.fields.findIndex(candidate => candidate.id === field.id);
  const fields = [...definition.fields];
  fields.splice(existingIndex >= 0 ? existingIndex : insertIndex ?? fields.length, existingIndex >= 0 ? 1 : 0, field);
  const views = definition.views.map(view => {
    const field_ids = [...view.field_ids];
    const anchorIndex = relative ? field_ids.indexOf(relative.fieldID) : -1;
    if (existingIndex < 0) field_ids.splice(anchorIndex >= 0 ? anchorIndex + (relative?.after ? 1 : 0) : insertIndex ?? field_ids.length, 0, field.id);
    return { ...view, field_ids };
  });
  return { fields, views };
}

/** Removing a column must remove its dependent configuration from every view. */
export function removeFieldDefinition(definition: Definition, fieldID: string): Definition {
  return {
    fields: definition.fields.filter(field => field.id !== fieldID),
    views: definition.views.map(view => ({
      ...view,
      field_ids: view.field_ids.filter(id => id !== fieldID),
      filters: view.filters.filter(filter => filter.field_id !== fieldID),
      sorts: view.sorts.filter(sort => sort.field_id !== fieldID),
      group_field_id: view.group_field_id === fieldID ? "" : view.group_field_id,
      widths: Object.fromEntries(Object.entries(view.widths).filter(([id]) => id !== fieldID)),
      text_colors: Object.fromEntries(Object.entries(view.text_colors).filter(([id]) => id !== fieldID)),
      highlight_duplicates: view.highlight_duplicates.filter(id => id !== fieldID),
    })),
  };
}
