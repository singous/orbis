import type { NoteTreeItem } from "../../shared/api/schemas";
import type { SitePageOverride, SiteSource } from "./schemas";

export const MANUAL_SOURCE: SiteSource = {
  kind: "manual",
  notebooks: [],
  excluded_note_ids: [],
  page_overrides: [],
};

export function sourceOrManual(source?: SiteSource): SiteSource {
  return source ?? MANUAL_SOURCE;
}

export function flattenNoteTree(items: NoteTreeItem[]): NoteTreeItem[] {
  const flattened: NoteTreeItem[] = [];
  function visit(nodes: NoteTreeItem[]) {
    nodes.forEach((node) => {
      flattened.push(node);
      visit(node.children);
    });
  }
  visit(items);
  return flattened;
}

export function scopedNoteTree(items: NoteTreeItem[], rootNoteId?: string | null): NoteTreeItem[] {
  if (!rootNoteId) return items;
  return flattenNoteTree(items).filter((item) => item.id === rootNoteId);
}

export function updatePageOverride(
  source: SiteSource,
  noteId: string,
  patch: Partial<Omit<SitePageOverride, "note_id">>,
): SiteSource {
  const current = source.page_overrides.find((entry) => entry.note_id === noteId);
  const next = { note_id: noteId, ...current, ...patch };
  const hasValue = [next.title, next.slug, next.description].some((value) => Boolean(value?.trim()));
  const others = source.page_overrides.filter((entry) => entry.note_id !== noteId);
  return { ...source, page_overrides: hasValue ? [...others, next] : others };
}

export function formatSavedTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}
