import { apiRequest } from "../api/api-client";
import { authResponseSchema, userSchema, type AuthResponse, type User } from "../api/schemas";

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = LoginPayload & {
  display_name?: string;
};

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const response = await apiRequest("/v1/auth/login", {
    method: "POST",
    body: payload,
  });
  return authResponseSchema.parse(response);
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const response = await apiRequest("/v1/auth/register", {
    method: "POST",
    body: payload,
  });
  return authResponseSchema.parse(response);
}

export async function getCurrentUser(token: string): Promise<User> {
  const response = await apiRequest("/v1/users/me", { token });
  return userSchema.parse(response);
}
