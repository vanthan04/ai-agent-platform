import { z } from "zod";
import { RunId, TaskId, TenantId, Timestamp } from "./ids";

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
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "rejected", "failed", "cancelled"];

export const isTerminal = (status: RunStatus): boolean => TERMINAL_STATUSES.includes(status);

export const Run = z.object({
  id: RunId,
  tenantId: TenantId,
  taskId: TaskId,
  attempt: z.number().int().positive(),
  status: RunStatus,
  /** Snapshot of `taskPublishes(task)` at run creation; decides whether approval is part of the path. */
  publishes: z.boolean(),
  createdAt: Timestamp,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
  failureReason: z.string().max(1_000).optional(),
});
export type Run = z.infer<typeof Run>;
