import { z } from "zod";
export const boardViewSchema = z
  .object({
    title: z.string(),
    revision: z.number().int(),
    svg: z.string(),
    text: z.string(),
    restricted: z.boolean(),
  })
  .strict();
export type BoardViewData = z.infer<typeof boardViewSchema>;
