import { apiRequest } from "../api/api-client";
import { authResponseSchema, userSchema, type AuthResponse, type User } from "../api/schemas";

export type LoginPayload = {
  email: string;
  password: string;
};

export type SetupPayload = LoginPayload & {
  display_name: string;
};

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const response = await apiRequest("/auth/login", {
    method: "POST",
    body: payload,
  });
  return authResponseSchema.parse(response);
}

export async function setup(payload: SetupPayload): Promise<AuthResponse> {
  const response = await apiRequest("/setup", {
    method: "POST",
    body: payload,
  });
  return authResponseSchema.parse(response);
}

export async function getCurrentUser(token: string): Promise<User> {
  const response = await apiRequest("/users/me", { token });
  return userSchema.parse(response);
}
