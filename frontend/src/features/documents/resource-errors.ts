import { ApiError } from "../../shared/api/api-client";

export function isUnavailableResourceError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
