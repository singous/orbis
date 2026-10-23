import { z } from "zod";
import { nativeBlockSchema, type NativeBlock } from "../content/codecs/api-content";
import type { NoteWrite, QuickNote } from "./api";

const writeSchema = z.object({ operation_id: z.string().uuid(), expected_version: z.number().int().nonnegative(), blocks: z.array(nativeBlockSchema), tag_ids: z.array(z.string().uuid()) });
const draftSchema = z.object({ version: z.literal(1), note_id: z.string().uuid().nullable(), as_new: z.boolean().default(false), expected_version: z.number().int().nonnegative(), blocks: z.array(nativeBlockSchema), tag_ids: z.array(z.string().uuid()), pending: writeSchema.nullable() });
export type QuickNoteDraft = z.infer<typeof draftSchema>;
const MAX_DRAFT_BYTES = 2 << 20;

export function draftKey(userId: string, workspaceId: string, noteId?: string) {
  return `orbis.quick-note-draft.v1:${userId}:${workspaceId}:${noteId ?? "new"}`;
}
export function freshDraft(note?: QuickNote): QuickNoteDraft {
  return { version: 1, note_id: note?.id ?? null, as_new: false, expected_version: note?.version ?? 0, blocks: note?.blocks ?? [], tag_ids: note?.tag_ids ?? [], pending: null };
}
export function readDraft(key: string, fallback: QuickNoteDraft): QuickNoteDraft {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_DRAFT_BYTES) return fallback;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.note_id === fallback.note_id ? parsed.data : fallback;
  } catch { return fallback; }
}
export function writeDraft(key: string, draft: QuickNoteDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}
export function removeDraft(key: string): void { try { localStorage.removeItem(key); } catch { /* The submitted receipt still makes restoring this draft safe to retry. */ } }
export function pendingWrite(draft: QuickNoteDraft): NoteWrite {
  return draft.pending ?? { operation_id: crypto.randomUUID(), expected_version: draft.expected_version, blocks: draft.blocks, tag_ids: draft.tag_ids };
}
export function hasNoteContent(blocks: NativeBlock[]): boolean {
  return blocks.some(block => block.content.some(run => run.text.trim()) || Boolean(block.props.source) || hasNoteContent(block.children));
}
