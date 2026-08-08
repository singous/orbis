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

type AuthRequestOptions = {
  accessToken: string;
  refreshToken: string | null;
  onTokenRefresh: (accessToken: string) => void;
  onUnauthorized: () => void;
};

function useToken(): string | null {
  return useStore(authStore, (state) => state.accessToken);
}

function useRefreshToken(): string | null {
  return useStore(authStore, (state) => state.refreshToken);
}

function useTokenRefreshHandler(): (accessToken: string) => void {
  return useStore(authStore, (state) => state.setAccessToken);
}

function useUnauthorizedHandler(): () => void {
  return useStore(authStore, (state) => state.clearSession);
}

function authRequestOptions(auth: AuthRequestOptions) {
  return {
    token: auth.accessToken,
    refreshToken: auth.refreshToken,
    onTokenRefresh: auth.onTokenRefresh,
    onUnauthorized: auth.onUnauthorized,
  };
}

export async function listNotes(auth: AuthRequestOptions): Promise<{ items: NoteListItem[] }> {
  const response = await apiRequest("/v1/notes", authRequestOptions(auth));
  return noteListResponseSchema.parse(response);
}

export async function getNote(noteId: string, auth: AuthRequestOptions): Promise<Note> {
  const response = await apiRequest(`/v1/notes/${noteId}`, authRequestOptions(auth));
  return noteSchema.parse(response);
}

export async function createNote(
  payload: Partial<CreateNotePayload>,
  auth: AuthRequestOptions,
): Promise<Note> {
  const response = await apiRequest("/v1/notes", {
    method: "POST",
    ...authRequestOptions(auth),
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
  auth: AuthRequestOptions,
): Promise<Note> {
  const response = await apiRequest(`/v1/notes/${payload.noteId}/content`, {
    method: "PUT",
    ...authRequestOptions(auth),
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
  const refreshToken = useRefreshToken();
  const onTokenRefresh = useTokenRefreshHandler();
  const onUnauthorized = useUnauthorizedHandler();
  const auth = token ? { accessToken: token, refreshToken, onTokenRefresh, onUnauthorized } : null;

  return useQuery({
    queryKey: ["notes"],
    enabled: Boolean(token),
    queryFn: () => listNotes(auth as AuthRequestOptions),
  });
}

export function useNoteDetail(noteId: string | null) {
  const token = useToken();
  const refreshToken = useRefreshToken();
  const onTokenRefresh = useTokenRefreshHandler();
  const onUnauthorized = useUnauthorizedHandler();
  const auth = token ? { accessToken: token, refreshToken, onTokenRefresh, onUnauthorized } : null;

  return useQuery({
    queryKey: ["notes", noteId],
    enabled: Boolean(token && noteId),
    queryFn: () => getNote(noteId as string, auth as AuthRequestOptions),
  });
}

export function useCreateNote() {
  const token = useToken();
  const refreshToken = useRefreshToken();
  const onTokenRefresh = useTokenRefreshHandler();
  const onUnauthorized = useUnauthorizedHandler();
  const auth = token ? { accessToken: token, refreshToken, onTokenRefresh, onUnauthorized } : null;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateNotePayload) => createNote(payload, auth as AuthRequestOptions),
    onSuccess: (note) => {
      queryClient.setQueryData(["notes", note.id], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export function useSaveNoteContent() {
  const token = useToken();
  const refreshToken = useRefreshToken();
  const onTokenRefresh = useTokenRefreshHandler();
  const onUnauthorized = useUnauthorizedHandler();
  const auth = token ? { accessToken: token, refreshToken, onTokenRefresh, onUnauthorized } : null;
  const queryClient = useQueryClient();

  return useMutation<Note, ApiError, SaveNotePayload>({
    mutationFn: (payload) => saveNoteContent(payload, auth as AuthRequestOptions),
    onSuccess: (note) => {
      queryClient.setQueryData(["notes", note.id], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}
