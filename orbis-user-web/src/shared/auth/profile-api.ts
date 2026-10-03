import { z } from "zod";
import { apiRequest } from "../api/api-client";
import { userSchema } from "../api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "./use-auth-request";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const accountAuthOptions = (auth: AuthRequestOptions) => ({ ...authRequestOptions(auth), workspaceId: null });
export function validateAvatar(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) return "请选择 PNG、JPEG 或 WebP 图片。";
  if (file.size > MAX_AVATAR_BYTES) return "头像图片不能超过 2 MiB。";
  return null;
}
export async function updateProfile(displayName: string, bio: string, auth: AuthRequestOptions) {
  return userSchema.parse(await apiRequest("/users/me", { method: "PATCH", body: { display_name: displayName.trim(), bio: bio.trim() }, ...accountAuthOptions(auth) }));
}
export async function changeAvatar(file: File | null, auth: AuthRequestOptions) {
  const body = file ? new FormData() : undefined;
  if (file) body!.append("file", file);
  return userSchema.parse(await apiRequest("/users/me/avatar", { method: file ? "PUT" : "DELETE", body, ...accountAuthOptions(auth) }));
}
export async function getAvatar(auth: AuthRequestOptions) {
  return z.object({ data_url: z.string().startsWith("data:image/webp;base64,") }).parse(await apiRequest("/users/me/avatar", accountAuthOptions(auth)));
}
export async function getProfile(auth: AuthRequestOptions) {
  return userSchema.parse(await apiRequest("/users/me", accountAuthOptions(auth)));
}
