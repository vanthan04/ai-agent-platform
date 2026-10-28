import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ApiKey, ModelBaseUrl, ModelName, ModelProvider } from "../domain";

export const SaveModelBody = z
  .object({ provider: ModelProvider, model: ModelName, baseUrl: ModelBaseUrl.optional(), apiKey: ApiKey.optional() })
  .strict();

/** Rejects bad input with field paths and messages only, never the submitted values (a key must not come back in an error). */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: "invalid request",
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return result.data;
}
