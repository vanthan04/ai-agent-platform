import type { CorrelationId, IdempotencyKey, ProjectId, Role, RunId, TenantId, UserId } from "../../shared-kernel";
import { RunNotCancellableError } from "./errors";
import { Run, isTerminal, type RunStatus } from "./run";
import { transition } from "./state-machine";
import { taskPublishes, type Task } from "./task";

/** A new run, waiting in the queue. `publishes` is fixed now from what the task asks for. */
export function createRun(input: {
  id: RunId;
  tenantId: TenantId;
  projectId: ProjectId;
  task: Pick<Task, "id" | "outputs">;
  attempt: number;
  idempotencyKey: IdempotencyKey;
  correlationId: CorrelationId;
  requestedBy: UserId;
  now: string;
}): Run {
  return Run.parse({
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    taskId: input.task.id,
    attempt: input.attempt,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    requestedBy: input.requestedBy,
    status: "queued",
    publishes: taskPublishes(input.task),
    createdAt: input.now,
  });
}

/** A run that has not reached a final state. Only one run per task may be like this at a time. */
export const isActive = (status: RunStatus): boolean => !isTerminal(status);

/** The next state of a run when it is cancelled, or `RunNotCancellableError` when its state does not allow it (for example while publishing). */
export function cancelRun(run: Run, now: string): Run {
  const result = transition(run, "cancelled", now);
  if (!result.ok) throw new RunNotCancellableError();
  return result.run;
}

/** A PM or PL may cancel any run of the project; anyone else only the run they started. */
export function canCancelRun(run: Pick<Run, "requestedBy">, actor: UserId, role: Role): boolean {
  return role === "PM" || role === "PL" || run.requestedBy === actor;
}

/** What a run records about itself. The store adds the id, the sequence number and the time. */
export type RunEventDraft =
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "run.status_changed"; from: RunStatus; to: RunStatus };
