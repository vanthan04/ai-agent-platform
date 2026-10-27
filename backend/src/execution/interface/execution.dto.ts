import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { BranchName, CorrelationId, IdempotencyKey, RepositoryMappingId } from "../../shared-kernel";
import { OutputKind, RunStatus, TaskSource } from "../domain";

const text = (max: number) => z.string().trim().max(max);

export const CreateTaskBody = z
  .object({
    title: text(200).min(1),
    description: text(20_000).default(""),
    source: TaskSource.default({ type: "manual" }),
    repositoryId: RepositoryMappingId,
    baseBranch: BranchName,
    inputs: z.record(z.string().min(1).max(64), z.string().max(2_000)).refine((inputs) => Object.keys(inputs).length <= 20, "at most 20 inputs").default({}),
    outputs: z.array(OutputKind).min(1).max(4).default(["report"]),
  })
  .strict();

/** `Idempotency-Key` header: printable characters, so it can be logged and compared as it is. */
export const IdempotencyKeyHeader = IdempotencyKey.refine((key) => /^[\x21-\x7E]{1,128}$/.test(key), "must be 1 to 128 printable characters");

/** `X-Correlation-Id` header, optional: the caller's own trace id, kept so logs line up across systems. */
export const CorrelationIdHeader = CorrelationId.refine((value) => /^[A-Za-z0-9._-]{8,64}$/.test(value), "must be 8 to 64 letters, digits, dot, dash or underscore");

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  taskId: z.string().min(1).max(128).optional(),
  status: RunStatus.optional(),
});

export const EventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const TasksQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/** Rejects bad input with field paths and messages only, never the submitted values. */
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
