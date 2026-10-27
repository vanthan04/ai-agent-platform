import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import { CorrelationId, IdempotencyKey, ProjectId, type Role, type TenantId } from "../../shared-kernel";
import {
  DuplicateRunError,
  ExecutionForbiddenError,
  ExecutionProjectNotFoundError,
  IdempotencyKeyReusedError,
  RunNotFoundError,
  TaskNotFoundError,
  canCancelRun,
  cancelRun,
  createRun,
  type ResolutionRepository,
  type Run,
  type RunRepository,
  type RunStatus,
  type TaskRepository,
} from "../domain";
import { CLOCK, PROJECT_CATALOG, RESOLUTION_REPOSITORY, RUN_REPOSITORY, TASK_REPOSITORY, type Clock, type ProjectCatalog } from "./ports";
import type { RunEventView, RunView, StartedRun } from "./views";

export const toRunView = (run: Run): RunView => ({
  id: run.id,
  taskId: run.taskId,
  attempt: run.attempt,
  status: run.status,
  publishes: run.publishes,
  idempotencyKey: run.idempotencyKey,
  correlationId: run.correlationId,
  requestedBy: run.requestedBy,
  createdAt: run.createdAt,
  ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
  ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
  ...(run.failureReason === undefined ? {} : { failureReason: run.failureReason }),
  ...(run.blockedReason === undefined ? {} : { blockedReason: run.blockedReason }),
});

/** Use cases for runs: members start and read them, and a run is only ever changed through the state machine. */
@Injectable()
export class RunsService {
  constructor(
    @Inject(RUN_REPOSITORY) private readonly runs: RunRepository,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepository,
    @Inject(PROJECT_CATALOG) private readonly catalog: ProjectCatalog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESOLUTION_REPOSITORY) private readonly resolutions: ResolutionRepository,
  ) {}

  /**
   * Puts a run of the task in the queue and returns at once; nothing runs inside this call. The same idempotency key always
   * answers with the same run, so a client that retries after a timeout never starts a second one. A task has at most one run
   * in progress; a new run of a task that ended is its next attempt.
   */
  async start(user: AuthUser, projectId: string, taskId: string, input: { idempotencyKey: IdempotencyKey; correlationId: CorrelationId }): Promise<StartedRun> {
    await this.requireMember(user, projectId);
    const project = ProjectId.parse(projectId);
    const task = await this.tasks.findById(user.tenantId, project, taskId);
    if (!task) throw new TaskNotFoundError();

    const replay = await this.replayOf(user.tenantId, project, input.idempotencyKey, task.id);
    if (replay) return { run: toRunView(replay), created: false };

    const run = createRun({
      id: this.runs.nextId(),
      tenantId: user.tenantId,
      projectId: project,
      task,
      attempt: (await this.runs.latestAttempt(user.tenantId, task.id)) + 1,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      requestedBy: user.userId,
      now: this.clock.now(),
    });
    try {
      await this.runs.create(run, { type: "log", level: "info", message: `run ${run.id} queued (attempt ${run.attempt})` });
    } catch (error) {
      if (error instanceof DuplicateRunError) {
        // Two requests with the same key arrived together; the other one won, so this one answers with its run.
        const winner = await this.replayOf(user.tenantId, project, input.idempotencyKey, task.id);
        if (winner) return { run: toRunView(winner), created: false };
      }
      throw error;
    }
    return { run: toRunView(run), created: true };
  }

  async list(user: AuthUser, projectId: string, filter: { taskId?: string; status?: RunStatus; limit: number }): Promise<RunView[]> {
    await this.requireMember(user, projectId);
    return (await this.runs.list(user.tenantId, ProjectId.parse(projectId), filter)).map(toRunView);
  }

  async get(user: AuthUser, projectId: string, runId: string): Promise<RunView> {
    await this.requireMember(user, projectId);
    const run = await this.find(user.tenantId, projectId, runId);
    const base = await this.resolutions.find(user.tenantId, run.projectId, run.id);
    return { ...toRunView(run), ...(base ? { baseCommit: { source: base.source, sha: base.baseCommitSha, resolvedAt: base.resolvedAt } } : {}) };
  }

  /** The recorded events of a run after `afterSeq`; a client that lost its connection asks again from the last number it saw. */
  async events(user: AuthUser, projectId: string, runId: string, afterSeq: number, limit: number): Promise<RunEventView[]> {
    await this.requireMember(user, projectId);
    const run = await this.find(user.tenantId, projectId, runId);
    const events = await this.runs.events(user.tenantId, run.projectId, run.id, afterSeq, limit);
    return events.map((event) => {
      switch (event.type) {
        case "log":
          return { seq: event.seq, at: event.at, type: event.type, level: event.level, message: event.message };
        case "run.status_changed":
          return { seq: event.seq, at: event.at, type: event.type, from: event.from, to: event.to };
        default:
          return { seq: event.seq, at: event.at, type: event.type };
      }
    });
  }

  /** A PM or PL, or the person who started the run, may cancel it while its state allows (not while it is publishing). */
  async cancel(user: AuthUser, projectId: string, runId: string): Promise<RunView> {
    const role = await this.requireMember(user, projectId);
    const run = await this.find(user.tenantId, projectId, runId);
    if (!canCancelRun(run, user.userId, role)) throw new ExecutionForbiddenError();
    const now = this.clock.now();
    const next = cancelRun(run, now);
    await this.runs.transition(user.tenantId, run.projectId, next, run.status, { type: "run.status_changed", from: run.status, to: next.status }, now);
    return toRunView(next);
  }

  /** The earlier run created with this key, if any. A key that belongs to another task is refused, not reused. */
  private async replayOf(tenantId: TenantId, projectId: ProjectId, key: IdempotencyKey, taskId: string): Promise<Run | undefined> {
    const existing = await this.runs.findByIdempotencyKey(tenantId, projectId, key);
    if (!existing) return undefined;
    if (existing.taskId !== taskId) throw new IdempotencyKeyReusedError();
    return existing;
  }

  private async find(tenantId: TenantId, projectId: string, runId: string): Promise<Run> {
    const run = await this.runs.findById(tenantId, ProjectId.parse(projectId), runId);
    if (!run) throw new RunNotFoundError();
    return run;
  }

  private async requireMember(user: AuthUser, projectId: string): Promise<Role> {
    const role = await this.catalog.roleOf(user, projectId);
    if (role === undefined) throw new ExecutionProjectNotFoundError();
    return role;
  }
}

