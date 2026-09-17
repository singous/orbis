import { z } from "zod";

import { apiRequest } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

const iconImageSchema = z.object({ data_url: z.string().startsWith("data:image/webp;base64,") });
const uploadedIconSchema = iconImageSchema.extend({ file_id: z.string().uuid() });

export type UploadedNotebookIcon = z.infer<typeof uploadedIconSchema>;

export async function uploadNotebookIcon(file: File, auth: AuthRequestOptions): Promise<UploadedNotebookIcon> {
  const body = new FormData();
  body.append("file", file);
  return uploadedIconSchema.parse(await apiRequest("/notebooks/icons", {
    method: "POST", body, ...authRequestOptions(auth),
  }));
}

export async function getNotebookIcon(fileId: string, auth: AuthRequestOptions): Promise<z.infer<typeof iconImageSchema>> {
  return iconImageSchema.parse(await apiRequest(`/notebooks/icons/${encodeURIComponent(fileId)}`, authRequestOptions(auth)));
}
