import {
  DuplicateRunError,
  Run,
  RunEvent,
  RunStateConflictError,
  TaskHasActiveRunError,
  isActive,
  type ResolutionRepository,
  type RunBaseCommit,
  type RunEventDraft,
  type RunQueue,
  type RunRepository,
  type RunStatus,
  type Task,
  type TaskRepository,
} from "../../src/execution";
import { RunId, TaskId, type ProjectId, type TenantId } from "../../src/shared-kernel";

/** Same contract as the Postgres task store, kept in memory. */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks: Task[] = [];
  private counter = 0;

  nextId(): TaskId {
    return TaskId.parse(`task-${++this.counter}`);
  }

  async save(task: Task): Promise<void> {
    this.tasks.push(task);
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Task | undefined> {
    return this.tasks.find((task) => task.id === id && task.tenantId === tenantId && task.projectId === projectId);
  }

  async list(tenantId: TenantId, projectId: ProjectId, limit: number): Promise<Task[]> {
    return this.tasks.filter((task) => task.tenantId === tenantId && task.projectId === projectId).reverse().slice(0, limit);
  }
}

const eventOf = (run: Run, seq: number, draft: RunEventDraft, at: string): RunEvent =>
  RunEvent.parse({ id: `evt-${run.id}-${seq}`, tenantId: run.tenantId, runId: run.id, seq, at, ...draft });

/** Same contract as the Postgres run store, kept in memory: the same two uniqueness rules and the same compare-and-set. */
export class InMemoryRunRepository implements RunRepository, RunQueue {
  protected readonly runs: Run[] = [];
  private readonly events_ = new Map<string, RunEvent[]>();
  private counter = 0;

  nextId(): RunId {
    return RunId.parse(`run-${++this.counter}`);
  }

  /** Test helper: puts a run in a state without going through the state machine, as if another process had moved it. */
  force(runId: string, status: RunStatus): void {
    const index = this.runs.findIndex((run) => run.id === runId);
    const run = this.runs[index];
    if (run) this.runs[index] = { ...run, status };
  }

  async create(run: Run, firstEvent: RunEventDraft): Promise<void> {
    if (this.runs.some((other) => other.projectId === run.projectId && other.idempotencyKey === run.idempotencyKey)) throw new DuplicateRunError();
    if (this.runs.some((other) => other.taskId === run.taskId && isActive(other.status))) throw new TaskHasActiveRunError();
    this.runs.push(run);
    this.events_.set(run.id, [eventOf(run, 1, firstEvent, run.createdAt)]);
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Run | undefined> {
    return this.runs.find((run) => run.id === id && run.tenantId === tenantId && run.projectId === projectId);
  }

  async findByIdempotencyKey(tenantId: TenantId, projectId: ProjectId, key: string): Promise<Run | undefined> {
    return this.runs.find((run) => run.idempotencyKey === key && run.tenantId === tenantId && run.projectId === projectId);
  }

  async list(tenantId: TenantId, projectId: ProjectId, filter: { taskId?: string; status?: RunStatus; limit: number }): Promise<Run[]> {
    return this.runs
      .filter((run) => run.tenantId === tenantId && run.projectId === projectId)
      .filter((run) => (filter.taskId === undefined ? true : run.taskId === filter.taskId))
      .filter((run) => (filter.status === undefined ? true : run.status === filter.status))
      .reverse()
      .slice(0, filter.limit);
  }

  async latestAttempt(tenantId: TenantId, taskId: TaskId): Promise<number> {
    return Math.max(0, ...this.runs.filter((run) => run.tenantId === tenantId && run.taskId === taskId).map((run) => run.attempt));
  }

  async transition(tenantId: TenantId, projectId: ProjectId, next: Run, expected: RunStatus, event: RunEventDraft, at: string): Promise<void> {
    const index = this.runs.findIndex((run) => run.id === next.id && run.tenantId === tenantId && run.projectId === projectId);
    const stored = this.runs[index];
    if (!stored || stored.status !== expected) throw new RunStateConflictError();
    this.runs[index] = next;
    const events = this.events_.get(next.id) ?? [];
    this.events_.set(next.id, [...events, eventOf(next, events.length + 1, event, at)]);
  }

  async appendEvent(tenantId: TenantId, projectId: ProjectId, runId: RunId, event: RunEventDraft, at: string): Promise<void> {
    const run = await this.findById(tenantId, projectId, runId);
    if (!run) throw new Error("run not found in this project");
    const events = this.events_.get(run.id) ?? [];
    this.events_.set(run.id, [...events, eventOf(run, events.length + 1, event, at)]);
  }

  async listQueued(limit: number): Promise<Run[]> {
    return this.runs.filter((run) => run.status === "queued").slice(0, limit);
  }

  async listStalled(status: RunStatus, idleSince: string, limit: number): Promise<Run[]> {
    const cutoff = new Date(idleSince).getTime();
    return this.runs
      .filter((run) => run.status === status)
      .filter((run) => (this.events_.get(run.id) ?? []).every((event) => new Date(event.at).getTime() <= cutoff))
      .slice(0, limit);
  }

  async events(tenantId: TenantId, projectId: ProjectId, runId: RunId, afterSeq: number, limit: number): Promise<RunEvent[]> {
    const run = await this.findById(tenantId, projectId, runId);
    return run ? (this.events_.get(run.id) ?? []).filter((event) => event.seq > afterSeq).slice(0, limit) : [];
  }
}

/** Same contract as the Postgres resolution store, kept in memory. */
export class InMemoryResolutionRepository implements ResolutionRepository {
  private readonly saved = new Map<string, RunBaseCommit>();

  async save(_tenantId: TenantId, _projectId: ProjectId, runId: RunId, resolution: RunBaseCommit): Promise<void> {
    if (this.saved.has(runId)) throw new Error("this run already has a resolution");
    this.saved.set(runId, resolution);
  }

  async find(_tenantId: TenantId, _projectId: ProjectId, runId: RunId): Promise<RunBaseCommit | undefined> {
    return this.saved.get(runId);
  }
}
