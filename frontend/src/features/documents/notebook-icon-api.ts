import { z } from "zod";
import { apiBlobRequest, apiRequest, workspacePath } from "../../shared/api/api-client";
import { imageDataURL } from "../../shared/api/blob";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
export type UploadedNotebookIcon = { asset_id: string; data_url: string };
export async function uploadNotebookIcon(file: File, auth: AuthRequestOptions): Promise<UploadedNotebookIcon> {
  const body = new FormData();
  body.append("file", file);
  const asset = z.object({ id: z.string().uuid() }).parse(await apiRequest(workspacePath(auth, "/collection-icons"), { method: "POST", body, ...authRequestOptions(auth) }));
  return { asset_id: asset.id, ...await getNotebookIcon(asset.id, auth) };
}
export async function getNotebookIcon(assetId: string, auth: AuthRequestOptions): Promise<{ data_url: string }> {
  const blob = await apiBlobRequest(workspacePath(auth, `/assets/${encodeURIComponent(assetId)}/content`), authRequestOptions(auth));
  return { data_url: await imageDataURL(blob) };
}
