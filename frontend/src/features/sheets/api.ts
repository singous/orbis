import { z } from "zod";
import {
  ApiError,
  apiRequest,
  workspacePath,
} from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import {
  fieldSchema,
  formConfigSchema,
  formSchema,
  recordSchema,
  sheetSchema,
  type Changes,
  type Form,
  type Sheet,
} from "./model";

const pageSchema = z.object({
  duplicate_ids: z.record(z.array(z.string())).default({}),
  items: z.array(recordSchema),
  next_cursor: z.string(),
  schema_version: z.number(),
});
export type RecordPage = z.infer<typeof pageSchema>;
export function sheetAPI(auth: AuthRequestOptions) {
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) =>
    apiRequest(workspacePath(auth, `/sheets${path}`), {
      ...authRequestOptions(auth),
      method,
      body: body as Record<string, unknown>,
      signal,
    }).catch((error: unknown) => {
      if (error instanceof ApiError) {
        const details = error.data as {
          errors?: Array<{ message?: string }>;
        } | null;
        const message = details?.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("；");
        if (message)
          throw new ApiError(
            error.status,
            message,
            error.code,
            error.requestId,
            error.data,
          );
      }
      throw error;
    });
  return {
    list: async (collection = "", cursor = "", signal?: AbortSignal) =>
      z
        .object({
          items: z.array(
            sheetSchema.pick({
              id: true,
              document_id: true,
              collection_id: true,
              title: true,
              created_at_ms: true,
              updated_at_ms: true,
            }),
          ),
          next_cursor: z.string(),
        })
        .parse(
          await request(
            `?${new URLSearchParams({ collection_id: collection, cursor })}`,
            "GET",
            undefined,
            signal,
          ),
        ),
    create: async (input: {
      id: string;
      collection_id: string;
      title: string;
      template: string;
      document_id?: string;
      parent_id?: string | null;
    }) => sheetSchema.parse(await request("", "POST", input)),
    get: async (id: string, signal?: AbortSignal) =>
      sheetSchema.parse(await request(`/${id}`, "GET", undefined, signal)),
    update: async (sheet: Sheet) =>
      sheetSchema.parse(
        await request(`/${sheet.id}`, "PUT", {
          title: sheet.title,
          definition: sheet.definition,
          version: sheet.version,
        }),
      ),
    records: async (
      id: string,
      view: string,
      cursor = "",
      search = "",
      group?: string,
      signal?: AbortSignal,
    ) => {
      const p = new URLSearchParams({ view, cursor, search, limit: "100" });
      if (group !== undefined) p.set("group", group || "");
      return pageSchema.parse(
        await request(`/${id}/records?${p}`, "GET", undefined, signal),
      );
    },
    stats: async (
      id: string,
      view: string,
      search = "",
      signal?: AbortSignal,
    ) =>
      z
        .object({
          total: z.number(),
          groups: z.array(z.object({ value: z.string(), count: z.number() })),
        })
        .parse(
          await request(
            `/${id}/stats?${new URLSearchParams({ view, search })}`,
            "GET",
            undefined,
            signal,
          ),
        ),
    change: async (id: string, changes: Changes) =>
      z
        .object({
          records: z.array(recordSchema),
          deleted: z.array(z.string()),
        })
        .parse(await request(`/${id}/changes`, "POST", changes)),
    forms: async (id: string, signal?: AbortSignal) =>
      z
        .object({ items: z.array(formSchema) })
        .parse(await request(`/${id}/forms`, "GET", undefined, signal)).items,
    saveForm: async (id: string, form: Form) =>
      formSchema.parse(await request(`/${id}/forms`, "PUT", form)),
  };
}
export async function readPublicForm(token: string, signal?: AbortSignal) {
  return z
    .object({
      id: z.string(),
      version: z.number(),
      config: formConfigSchema,
      fields: z.array(fieldSchema),
    })
    .parse(await apiRequest(`/v1/public/forms/${token}`, { signal }));
}
export function submitPublicForm(token: string, body: unknown) {
  return apiRequest(`/v1/public/forms/${token}/submissions`, {
    method: "POST",
    body: body as Record<string, unknown>,
  });
}

export async function uploadPublicFormFile(
  token: string,
  field: string,
  file: File,
) {
  if (file.size > 7 * 1024 * 1024) throw new Error("表单附件不能超过 7 MiB");
  const body = new FormData();
  body.append("file", file);
  const result = z.object({ id: z.string(), filename: z.string() }).parse(
    await apiRequest(`/v1/public/forms/${token}/fields/${field}/assets`, {
      method: "POST",
      body,
    }),
  );
  return result.id;
}
