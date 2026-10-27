import { RepositoryResolution } from "../../integrations";
import {
  RunStateConflictError,
  transition,
  type ResolutionRepository,
  type Run,
  type RunEventDraft,
  type RunQueue,
  type RunRepository,
  type RunStatus,
  type Task,
  type TaskRepository,
  type TransitionContext,
} from "../../execution";
import type { BranchHeadFailure, Clock, RepositoryInspector, WorkerLog } from "./ports";

/**
 * What a run ends with today, once its repository is prepared. The stages after preparing (analysis, planning,
 * implementation, verification) do not exist yet, so the run says so and stops instead of waiting for a stage nobody runs.
 */
export const STAGES_NOT_IMPLEMENTED =
  "the repository was prepared, but the stages after preparing (analysis, planning, implementation) are not implemented in this version";

export interface ProcessorOptions {
  /** Most runs taken from the queue in one pass. */
  batchSize: number;
  /** A run that has been preparing this long without any new event is taken to have lost its worker. */
  stalledAfterMs: number;
}

const DEFAULT_OPTIONS: ProcessorOptions = { batchSize: 5, stalledAfterMs: 5 * 60_000 };

const UNREADABLE: Readonly<Record<Exclude<BranchHeadFailure, "not_found" | "unsupported">, string>> = {
  unreachable: "the repository host could not be reached",
  timeout: "the repository host did not answer in time",
  too_large: "the repository's list of branches is too large to read",
  blocked_address: "the repository address points to a place this server must not connect to",
  invalid_response: "the repository host did not answer like a git server",
};

export interface ProcessorDeps {
  queue: RunQueue;
  runs: RunRepository;
  tasks: TaskRepository;
  resolutions: ResolutionRepository;
  inspector: RepositoryInspector;
  clock: Clock;
  log: WorkerLog;
}

/**
 * Takes queued runs and prepares them: moves a run to `preparing`, reads the commit its base branch points at, records it as
 * the run's starting point, and writes down each step as an event. Every change of state is compare-and-set, so a run that is
 * cancelled, or taken by another worker, while this one is busy is left alone rather than overwritten.
 */
export class RunProcessor {
  constructor(
    private readonly deps: ProcessorDeps,
    private readonly options: ProcessorOptions = DEFAULT_OPTIONS,
  ) {}

  /** One pass: recover runs whose worker stopped, then prepare the queued ones. */
  async tick(): Promise<{ claimed: number; recovered: number }> {
    const recovered = await this.recoverStalled();
    let claimed = 0;
    for (const queued of await this.deps.queue.listQueued(this.options.batchSize)) {
      if (await this.process(queued)) claimed++;
    }
    return { claimed, recovered };
  }

  private async process(queued: Run): Promise<boolean> {
    const run = await this.claim(queued);
    if (!run) return false;
    try {
      await this.prepare(run);
    } catch (error) {
      await this.abort(run, error);
    }
    return true;
  }

  /** Moves the run from `queued` to `preparing`. Only one worker can: the others see the state change and skip the run. */
  private async claim(queued: Run): Promise<Run | undefined> {
    const now = this.deps.clock.now();
    const result = transition(queued, "preparing", now);
    if (!result.ok) return undefined;
    try {
      await this.deps.runs.transition(queued.tenantId, queued.projectId, result.run, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, now);
      return result.run;
    } catch (error) {
      if (error instanceof RunStateConflictError) return undefined;
      throw error;
    }
  }

  private async prepare(run: Run): Promise<void> {
    const task = await this.deps.tasks.findById(run.tenantId, run.projectId, run.taskId);
    if (!task) return this.move(run, "failed", { failureReason: "the task of this run no longer exists" });

    await this.note(run, `preparing: reading branch ${task.repo.baseBranch} of ${task.repo.name}`);
    const head = await this.deps.inspector.branchHead({ url: task.repo.url, branch: task.repo.baseBranch });
    if (!head.ok) return this.stopFor(run, task, head.reason);

    const now = this.deps.clock.now();
    const resolution = RepositoryResolution.parse({
      tenantId: run.tenantId,
      projectId: run.projectId,
      runId: run.id,
      repo: task.repo,
      source: "user_selected",
      baseCommitSha: head.commitSha,
      resolvedAt: now,
    });
    await this.deps.resolutions.save(run.tenantId, run.projectId, run.id, {
      source: resolution.source,
      baseCommitSha: resolution.baseCommitSha,
      resolvedAt: resolution.resolvedAt,
    });
    await this.note(run, `repository prepared: ${task.repo.name} ${task.repo.baseBranch} at ${resolution.baseCommitSha.slice(0, 7)}`);
    return this.move(run, "failed", { failureReason: STAGES_NOT_IMPLEMENTED });
  }

  /** A repository that cannot be read yet: a person can fix it (blocked), or it is a fault in reaching it (failed). */
  private async stopFor(run: Run, task: Task, reason: BranchHeadFailure): Promise<void> {
    if (reason === "not_found") {
      return this.move(run, "blocked", {
        blockedReason: `branch ${task.repo.baseBranch} was not found in ${task.repo.name}, or the repository is private or does not exist; only public https repositories can be read in this version`,
      });
    }
    if (reason === "unsupported") {
      return this.move(run, "blocked", { blockedReason: `${task.repo.name} is not reachable over https; only https repositories can be read in this version` });
    }
    return this.move(run, "failed", { failureReason: `could not read ${task.repo.name}: ${UNREADABLE[reason]}` });
  }

  /** Runs that stopped moving because their worker did. They are failed, so the task can be run again. */
  private async recoverStalled(): Promise<number> {
    const cutoff = new Date(new Date(this.deps.clock.now()).getTime() - this.options.stalledAfterMs).toISOString();
    let recovered = 0;
    for (const run of await this.deps.queue.listStalled("preparing", cutoff, this.options.batchSize)) {
      try {
        await this.note(run, "no progress for a long time: the worker that was preparing this run stopped");
        await this.move(run, "failed", { failureReason: "the worker stopped while preparing this run; start the task again" });
        recovered++;
      } catch (error) {
        if (!(error instanceof RunStateConflictError)) this.deps.log.error(`could not recover run ${run.id}: ${errorName(error)}`);
      }
    }
    return recovered;
  }

  /** Anything unexpected: the run is failed with a plain reason (the details go to the log, not to the run). */
  private async abort(run: Run, error: unknown): Promise<void> {
    if (error instanceof RunStateConflictError) {
      this.deps.log.info(`run ${run.id} (${run.correlationId}) was changed by someone else while it was prepared; left as it is`);
      return;
    }
    this.deps.log.error(`run ${run.id} (${run.correlationId}) failed unexpectedly: ${errorName(error)}`);
    try {
      await this.move(run, "failed", { failureReason: `the worker failed while preparing this run; see the worker log for ${run.correlationId}` });
    } catch (secondary) {
      if (!(secondary instanceof RunStateConflictError)) this.deps.log.error(`could not mark run ${run.id} as failed: ${errorName(secondary)}`);
    }
  }

  /** The next state of a run, through the state machine, written only if the run is still in the state this worker saw. */
  private async move(run: Run, to: RunStatus, context: TransitionContext): Promise<void> {
    const now = this.deps.clock.now();
    const result = transition(run, to, now, context);
    if (!result.ok) throw new Error(result.reason);
    const event: RunEventDraft = { type: "run.status_changed", from: run.status, to };
    await this.deps.runs.transition(run.tenantId, run.projectId, result.run, run.status, event, now);
    this.deps.log.info(`run ${run.id} (${run.correlationId}): ${run.status} -> ${to}`);
  }

  private async note(run: Run, message: string): Promise<void> {
    await this.deps.runs.appendEvent(run.tenantId, run.projectId, run.id, { type: "log", level: "info", message }, this.deps.clock.now());
  }
}

/** Only the kind of error is logged, never its message: a message can carry what a remote server or the database said. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown error");
