import { withRequestFeedback } from "../api/request-feedback";
import { imageDataURL } from "../api/blob";
import { apiBlobRequest, apiRequest } from "../api/api-client";
import { userSchema } from "../api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "./use-auth-request";
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export function validateAvatar(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) return "请选择 PNG、JPEG 或 WebP 图片。";
  if (file.size > MAX_AVATAR_BYTES) return "头像图片不能超过 2 MiB。";
  return null;
}
export async function updateProfile(displayName: string, bio: string, expectedVersion: number, auth: AuthRequestOptions) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return userSchema.parse(await apiRequest("/v1/me", { method: "PATCH", body: { display_name: displayName.trim() || null, bio: bio.trim() || null, expected_version: expectedVersion }, ...authRequestOptions(auth) }));

  });
}
export async function changeAvatar(file: File | null, expectedVersion: number, auth: AuthRequestOptions) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  const body = file ? new FormData() : { expected_version: expectedVersion };
  if (file) (body as FormData).append("file", file);
  return userSchema.parse(await apiRequest(`/v1/me/avatar${file ? `?expected_version=${expectedVersion}` : ""}`, { method: file ? "PUT" : "DELETE", body, ...authRequestOptions(auth) }));

  });
}
export async function getAvatar(auth: AuthRequestOptions): Promise<{ data_url: string }> {
  const blob = await apiBlobRequest("/v1/me/avatar", authRequestOptions({ ...auth, feedback: { error: false } }));
  return { data_url: await imageDataURL(blob) };
}
export async function getProfile(auth: AuthRequestOptions) {
  return userSchema.parse(await apiRequest("/v1/me", authRequestOptions(auth)));
}
