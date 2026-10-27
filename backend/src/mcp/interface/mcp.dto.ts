import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { BearerToken, McpConnectionName, McpServerUrl } from "../domain";

export const CreateMcpConnectionBody = z.object({ name: McpConnectionName, url: McpServerUrl, bearerToken: BearerToken.optional() }).strict();

export const ReplaceTokenBody = z.object({ bearerToken: BearerToken }).strict();

/** Rejects bad input with field paths and messages only, never the submitted values (a token must not come back in an error). */
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
