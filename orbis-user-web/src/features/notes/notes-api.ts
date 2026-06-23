import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";

import { ApiError, apiRequest } from "../../shared/api/api-client";
import {
  noteListResponseSchema,
  noteSchema,
  type Note,
  type NoteBlocks,
  type NoteListItem,
} from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { createEmptyNoteBlocks } from "./note-contract";

export type CreateNotePayload = {
  title: string;
  blocks: NoteBlocks;
  plain_text: string;
  note_type: "doc";
};

export type SaveNotePayload = {
  noteId: string;
  expectedVersion: number;
  title: string;
  blocks: NoteBlocks;
  plainText: string;
};

function useToken(): string | null {
  return useStore(authStore, (state) => state.accessToken);
}

function useUnauthorizedHandler(): () => void {
  return useStore(authStore, (state) => state.clearSession);
}

export async function listNotes(token: string, onUnauthorized?: () => void): Promise<{ items: NoteListItem[] }> {
  const response = await apiRequest("/v1/notes", { token, onUnauthorized });
  return noteListResponseSchema.parse(response);
}

export async function getNote(noteId: string, token: string, onUnauthorized?: () => void): Promise<Note> {
  const response = await apiRequest(`/v1/notes/${noteId}`, { token, onUnauthorized });
  return noteSchema.parse(response);
}

export async function createNote(
  payload: Partial<CreateNotePayload>,
  token: string,
  onUnauthorized?: () => void,
): Promise<Note> {
  const response = await apiRequest("/v1/notes", {
    method: "POST",
    token,
    onUnauthorized,
    body: {
      title: payload.title ?? "未命名笔记",
      blocks: payload.blocks ?? createEmptyNoteBlocks(),
      plain_text: payload.plain_text ?? "",
      note_type: payload.note_type ?? "doc",
    },
  });
  return noteSchema.parse(response);
}

export async function saveNoteContent(
  payload: SaveNotePayload,
  token: string,
  onUnauthorized?: () => void,
): Promise<Note> {
  const response = await apiRequest(`/v1/notes/${payload.noteId}/content`, {
    method: "PUT",
    token,
    onUnauthorized,
    body: {
      expected_version: payload.expectedVersion,
      title: payload.title,
      blocks: payload.blocks,
      plain_text: payload.plainText,
    },
  });
  return noteSchema.parse(response);
}

export function useNotesList() {
  const token = useToken();
  const onUnauthorized = useUnauthorizedHandler();

  return useQuery({
    queryKey: ["notes"],
    enabled: Boolean(token),
    queryFn: () => listNotes(token as string, onUnauthorized),
  });
}

export function useNoteDetail(noteId: string | null) {
  const token = useToken();
  const onUnauthorized = useUnauthorizedHandler();

  return useQuery({
    queryKey: ["notes", noteId],
    enabled: Boolean(token && noteId),
    queryFn: () => getNote(noteId as string, token as string, onUnauthorized),
  });
}

export function useCreateNote() {
  const token = useToken();
  const onUnauthorized = useUnauthorizedHandler();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateNotePayload) => createNote(payload, token as string, onUnauthorized),
    onSuccess: (note) => {
      queryClient.setQueryData(["notes", note.id], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export function useSaveNoteContent() {
  const token = useToken();
  const onUnauthorized = useUnauthorizedHandler();
  const queryClient = useQueryClient();

  return useMutation<Note, ApiError, SaveNotePayload>({
    mutationFn: (payload) => saveNoteContent(payload, token as string, onUnauthorized),
    onSuccess: (note) => {
      queryClient.setQueryData(["notes", note.id], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}
