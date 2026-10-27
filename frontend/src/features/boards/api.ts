import { z } from "zod";
import { apiRequest, workspacePath } from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import {
  boardSchema,
  elementSchema,
  changeSchema,
  type Element,
  type Mutation,
} from "./model";
export function boardAPI(auth: AuthRequestOptions) {
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    silent = false,
  ) =>
    apiRequest(workspacePath(auth, "/boards" + path), {
      ...authRequestOptions(auth),
      method,
      body: body as Record<string, unknown>,
      signal,
      feedback: silent ? { ...auth.feedback, error: false } : auth.feedback,
    });
  return {
    list: async (page = 1, signal?: AbortSignal) =>
      z
        .object({
          items: z.array(
            boardSchema.pick({
              id: true,
              document_id: true,
              collection_id: true,
              title: true,
              updated_at_ms: true,
            }),
          ),
          pagination: z.object({
            page: z.number(),
            page_size: z.number(),
            total: z.number(),
          }),
        })
        .parse(
          await request(
            "?page=" + page + "&page_size=20",
            "GET",
            undefined,
            signal,
          ),
        ),
    create: async (input: {
      id: string;
      operation_id: string;
      collection_id: string;
      parent_id: string | null;
      title: string;
      page_id: string;
      elements: Element[];
    }) => boardSchema.parse(await request("", "POST", input)),
    get: async (id: string, revision = 0, signal?: AbortSignal) =>
      boardSchema.parse(
        await request(
          "/" + id + (revision ? "?revision=" + revision : ""),
          "GET",
          undefined,
          signal,
        ),
      ),
    elements: async (
      id: string,
      page: string,
      revision: number,
      cursor = "",
      signal?: AbortSignal,
    ) =>
      z
        .object({
          items: z.array(elementSchema),
          revision: z.number(),
          next_cursor: z.string().nullable(),
          has_more: z.boolean(),
        })
        .parse(
          await request(
            `/${id}/pages/${page}/elements?` +
              new URLSearchParams({ revision: String(revision), cursor }),
            "GET",
            undefined,
            signal,
          ),
        ),
    change: async (id: string, input: Mutation, signal?: AbortSignal) =>
      changeSchema.parse(
        await request(`/${id}/commands`, "POST", input, signal),
      ),
    changes: async (id: string, after: number, signal?: AbortSignal) =>
      z
        .object({
          items: z.array(changeSchema),
          revision: z.number(),
          has_more: z.boolean(),
        })
        .parse(
          await request(
            `/${id}/changes?after=${after}`,
            "GET",
            undefined,
            signal,
            true,
          ),
        ),
    history: async (id: string, signal?: AbortSignal) =>
      z
        .object({
          items: z.array(
            z.object({
              revision: z.number(),
              actor_id: z.string().nullable(),
              created_at_ms: z.number(),
            }),
          ),
        })
        .parse(await request(`/${id}/history`, "GET", undefined, signal)),
    snapshot: async (id: string, revision = 0, signal?: AbortSignal) =>
      z
        .object({ board: boardSchema, elements: z.array(elementSchema) })
        .parse(
          await request(
            `/${id}/snapshot?revision=${revision}`,
            "GET",
            undefined,
            signal,
          ),
        ),
  };
}
