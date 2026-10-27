import type { RepositoryResolution } from "../../integrations";
import type { ProjectId, RunId, TaskId, TenantId } from "../../shared-kernel";
import type { RunEvent } from "./event";
import type { Run, RunStatus } from "./run";
import type { RunEventDraft } from "./run-lifecycle";
import type { Task } from "./task";

/** Raised by the run store when a run with the same idempotency key already exists, so the caller can return that run instead. */
export class DuplicateRunError extends Error {
  constructor() {
    super("a run with this idempotency key already exists");
  }
}

/** Storage port for tasks. Every lookup is scoped by tenant and project (D2, D7). */
export interface TaskRepository {
  nextId(): TaskId;
  save(task: Task): Promise<void>;
  findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Task | undefined>;
  /** Newest first. */
  list(tenantId: TenantId, projectId: ProjectId, limit: number): Promise<Task[]>;
}

/** Storage port for runs and their events. Every lookup is scoped by tenant and project (D2, D7). */
export interface RunRepository {
  nextId(): RunId;
  /**
   * Stores a new run together with its first event, in one step. Throws `DuplicateRunError` when the idempotency key is
   * taken in the project and `TaskHasActiveRunError` when the task already has a run in progress.
   */
  create(run: Run, firstEvent: RunEventDraft): Promise<void>;
  findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Run | undefined>;
  findByIdempotencyKey(tenantId: TenantId, projectId: ProjectId, key: string): Promise<Run | undefined>;
  /** Newest first. */
  list(tenantId: TenantId, projectId: ProjectId, filter: { taskId?: string; status?: RunStatus; limit: number }): Promise<Run[]>;
  /** Highest attempt number used for the task so far; 0 when it has no run. */
  latestAttempt(tenantId: TenantId, taskId: TaskId): Promise<number>;
  /**
   * Moves a run to `next` and records `event`, only if the run is still in `expected`; otherwise throws
   * `RunStateConflictError` and changes nothing. Two people acting at once cannot both win.
   */
  transition(tenantId: TenantId, projectId: ProjectId, next: Run, expected: RunStatus, event: RunEventDraft, at: string): Promise<void>;
  /** Events of a run after sequence number `afterSeq`, in order. */
  events(tenantId: TenantId, projectId: ProjectId, runId: RunId, afterSeq: number, limit: number): Promise<RunEvent[]>;
  /** Adds an event to a run without changing its state, numbered after the last one. */
  appendEvent(tenantId: TenantId, projectId: ProjectId, runId: RunId, event: RunEventDraft, at: string): Promise<void>;
}

/** The commit a run's base branch pointed at when the run was prepared, and who chose the repository. */
export type RunBaseCommit = Pick<RepositoryResolution, "source" | "baseCommitSha" | "resolvedAt">;

/** Written once per run and never changed, so what a run saw stays fixed even if the branch moves on. */
export interface ResolutionRepository {
  /** Throws if the run already has one. */
  save(tenantId: TenantId, projectId: ProjectId, runId: RunId, resolution: RunBaseCommit): Promise<void>;
  find(tenantId: TenantId, projectId: ProjectId, runId: RunId): Promise<RunBaseCommit | undefined>;
}

/**
 * The runs waiting for work, seen across every tenant, for the worker. The worker only reads here; it takes a run by moving it
 * with `RunRepository.transition`, whose compare-and-set lets exactly one worker win.
 */
export interface RunQueue {
  /** Runs in `queued`, oldest first. */
  listQueued(limit: number): Promise<Run[]>;
  /** Runs in `status` whose last recorded event is older than `idleSince`, oldest first: a worker that stopped leaves these behind. */
  listStalled(status: RunStatus, idleSince: string, limit: number): Promise<Run[]>;
}
