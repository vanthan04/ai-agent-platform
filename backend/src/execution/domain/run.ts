import { z } from "zod";
import { CorrelationId, IdempotencyKey, ProjectId, RunId, TaskId, TenantId, Timestamp, UserId } from "../../shared-kernel";

export const RunStatus = z.enum([
  "queued",
  "preparing",
  "analyzing",
  "planning",
  "implementing",
  "verifying",
  "awaiting_approval",
  "publishing",
  "succeeded",
  "rejected",
  "failed",
  "cancelled",
  /** The run cannot continue without a person (for example an ambiguous repository); see D14. */
  "blocked",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "rejected", "failed", "cancelled", "blocked"];

export const isTerminal = (status: RunStatus): boolean => TERMINAL_STATUSES.includes(status);

export const Run = z.object({
  id: RunId,
  tenantId: TenantId,
  projectId: ProjectId,
  taskId: TaskId,
  attempt: z.number().int().positive(),
  idempotencyKey: IdempotencyKey,
  correlationId: CorrelationId,
  /** Who started this run; with a PM or PL, the only people who may cancel it. */
  requestedBy: UserId,
  status: RunStatus,
  /** Snapshot of `taskPublishes(task)` at run creation; decides whether approval is part of the path. */
  publishes: z.boolean(),
  createdAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  failureReason: z.string().max(1_000).optional(),
  blockedReason: z.string().max(1_000).optional(),
});
export type Run = z.infer<typeof Run>;
