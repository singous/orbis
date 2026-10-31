import { z } from "zod";
import { ApiError } from "../../shared/api/api-client";

const validationDetails = z.object({
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});

export function boardValidationErrors(error: unknown) {
  if (!(error instanceof ApiError)) return [];
  const details = validationDetails.safeParse(error.data);
  return details.success ? details.data.errors : [];
}

export function boardErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const details = boardValidationErrors(error);
  if (!details.length) return message;
  const reasons = details.map(({ message }) => message);
  return `${message}：${reasons.join("；")}`;
}
