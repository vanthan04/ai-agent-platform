import { beforeEach, describe, expect, it } from "vitest";
import {
  RunStateConflictError,
  Task,
  checkEventSequence,
  createRun,
  type Run,
} from "../../src/execution";
import { STAGES_NOT_IMPLEMENTED, RunProcessor, type BranchHead, type RepositoryInspector, type WorkerLog } from "../../src/worker";
import { CorrelationId, IdempotencyKey, ProjectId, RepositoryMappingId, TenantId, UserId } from "../../src/shared-kernel";
import { InMemoryResolutionRepository, InMemoryRunRepository, InMemoryTaskRepository } from "../support/in-memory-execution.repositories";
import { NOW } from "../support/time";

const tenant = TenantId.parse("tenant-1");
const project = ProjectId.parse("project-1");
const SHA = "0123456789abcdef0123456789abcdef01234567";

class FakeInspector implements RepositoryInspector {
  calls: { url: string; branch: string }[] = [];
  answer: BranchHead = { ok: true, commitSha: SHA };
  before: (() => Promise<void> | void) | undefined;
  failWith: Error | undefined;

  async branchHead(target: { url: string; branch: string }): Promise<BranchHead> {
    this.calls.push(target);
    await this.before?.();
    if (this.failWith) throw this.failWith;
    return this.answer;
  }
}

class RecordingLog implements WorkerLog {
  lines: string[] = [];
  errors: string[] = [];
  info(message: string): void {
    this.lines.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

describe("RunProcessor", () => {
  let runs: InMemoryRunRepository;
  let tasks: InMemoryTaskRepository;
  let resolutions: InMemoryResolutionRepository;
  let inspector: FakeInspector;
  let log: RecordingLog;
  let now: string;
  let counter: number;

  const processor = (options?: { batchSize: number; stalledAfterMs: number }, repo: InMemoryRunRepository = runs) =>
    new RunProcessor({ queue: repo, runs: repo, tasks, resolutions, inspector, clock: { now: () => now }, log }, options);

  /** A task, and a run of it waiting in the queue. */
  const enqueue = async (overrides: { url?: string; branch?: string; name?: string } = {}): Promise<{ run: Run; task: Task }> => {
    const n = ++counter;
    const task = Task.parse({
      id: tasks.nextId(),
      tenantId: tenant,
      projectId: project,
      title: `Task ${n}`,
      description: "",
      source: { type: "manual" },
      repositoryId: RepositoryMappingId.parse("mapping-1"),
      repo: { provider: "github", name: overrides.name ?? "org/shop", url: overrides.url ?? "https://github.com/org/shop.git", baseBranch: overrides.branch ?? "develop" },
      inputs: {},
      outputs: ["report"],
      createdBy: UserId.parse("dev"),
      createdAt: NOW,
    });
    await tasks.save(task);
    const run = createRun({
      id: runs.nextId(),
      tenantId: tenant,
      projectId: project,
      task,
      attempt: 1,
      idempotencyKey: IdempotencyKey.parse(`key-${n}`),
      correlationId: CorrelationId.parse(`corr-0000000${n}`),
      requestedBy: UserId.parse("dev"),
      now: NOW,
    });
    await runs.create(run, { type: "log", level: "info", message: "queued" });
    return { run, task };
  };

  const state = async (run: Run) => (await runs.findById(tenant, project, run.id)) as Run;
  const events = async (run: Run) => runs.events(tenant, project, run.id, 0, 100);

  beforeEach(() => {
    runs = new InMemoryRunRepository();
    tasks = new InMemoryTaskRepository();
    resolutions = new InMemoryResolutionRepository();
    inspector = new FakeInspector();
    log = new RecordingLog();
    now = NOW;
    counter = 0;
  });

  it("prepares a queued run: reads the base commit, records it, writes every step down and stops where this version ends", async () => {
    const { run } = await enqueue();
    now = "2026-10-27T10:00:05Z";
    expect(await processor().tick()).toEqual({ claimed: 1, recovered: 0 });

    expect(inspector.calls).toEqual([{ url: "https://github.com/org/shop.git", branch: "develop" }]);
    expect(await state(run)).toMatchObject({ status: "failed", failureReason: STAGES_NOT_IMPLEMENTED, startedAt: now, finishedAt: now });
    expect(await resolutions.find(tenant, project, run.id)).toEqual({ source: "user_selected", baseCommitSha: SHA, resolvedAt: now });

    const all = await events(run);
    expect(checkEventSequence(all)).toEqual({ ok: true });
    expect(all.map((event) => (event.type === "log" ? `log: ${event.message}` : event.type === "run.status_changed" ? `${event.from} -> ${event.to}` : event.type))).toEqual([
      "log: queued",
      "queued -> preparing",
      "log: preparing: reading branch develop of org/shop",
      "log: repository prepared: org/shop develop at 0123456",
      "preparing -> failed",
    ]);
    expect(log.errors).toEqual([]);
  });

  it("blocks a run whose branch or repository cannot be found, with a reason a person can act on, and records no commit", async () => {
    const { run } = await enqueue({ branch: "nope" });
    inspector.answer = { ok: false, reason: "not_found" };
    await processor().tick();
    const after = await state(run);
    expect(after.status).toBe("blocked");
    expect(after.blockedReason).toContain("branch nope was not found in org/shop");
    expect(after.blockedReason).toContain("private");
    expect(after.finishedAt).toBe(NOW);
    expect(await resolutions.find(tenant, project, run.id)).toBeUndefined();
  });

  it("blocks a run whose repository is not reachable over https", async () => {
    const { run } = await enqueue({ url: "git@github.com:org/shop.git" });
    inspector.answer = { ok: false, reason: "unsupported" };
    await processor().tick();
    expect(await state(run)).toMatchObject({ status: "blocked", blockedReason: expect.stringContaining("only https repositories") });
  });

  it("fails, rather than blocks, when the host cannot be read, naming the fault and never what the host said", async () => {
    for (const [reason, words] of [
      ["unreachable", "could not be reached"],
      ["timeout", "did not answer in time"],
      ["too_large", "too large"],
      ["blocked_address", "must not connect"],
      ["invalid_response", "did not answer like a git server"],
    ] as const) {
      const { run } = await enqueue();
      inspector.answer = { ok: false, reason };
      await processor().tick();
      const after = await state(run);
      expect(after.status, reason).toBe("failed");
      expect(after.failureReason, reason).toContain("could not read org/shop: the repository");
      expect(after.failureReason, reason).toContain(words);
    }
  });

  it("leaves a run alone that was cancelled while it was being prepared", async () => {
    const { run } = await enqueue();
    inspector.before = () => {
      runs.force(run.id, "cancelled");
    };
    await processor().tick();
    expect((await state(run)).status).toBe("cancelled");
    expect(log.lines.some((line) => line.includes("changed by someone else"))).toBe(true);
    expect(log.errors).toEqual([]);
    const types = (await events(run)).map((event) => (event.type === "run.status_changed" ? `${event.from}->${event.to}` : event.type));
    expect(types).not.toContain("preparing->failed");
  });

  it("lets only one of two workers take a run", async () => {
    const { run } = await enqueue();
    const results = await Promise.all([processor().tick(), processor().tick()]);
    expect(results.map((result) => result.claimed).sort()).toEqual([0, 1]);
    expect(inspector.calls).toHaveLength(1);
    expect((await events(run)).filter((event) => event.type === "run.status_changed" && event.to === "preparing")).toHaveLength(1);
  });

  it("ignores runs that are not queued, takes the oldest first and no more than a batch", async () => {
    const first = await enqueue();
    const second = await enqueue();
    const third = await enqueue();
    runs.force(first.run.id, "analyzing");
    expect(await processor({ batchSize: 1, stalledAfterMs: 300_000 }).tick()).toMatchObject({ claimed: 1 });
    expect((await state(second.run)).status).toBe("failed");
    expect((await state(third.run)).status).toBe("queued");
    expect((await state(first.run)).status).toBe("analyzing");
    expect(inspector.calls).toHaveLength(1);
    expect(await processor().tick()).toMatchObject({ claimed: 1 });
    expect((await state(third.run)).status).toBe("failed");
    expect(await processor().tick()).toEqual({ claimed: 0, recovered: 0 });
  });

  it("fails a run whose task has disappeared", async () => {
    const { run } = await enqueue();
    (tasks as unknown as { tasks: Task[] }).tasks.length = 0;
    await processor().tick();
    expect(await state(run)).toMatchObject({ status: "failed", failureReason: "the task of this run no longer exists" });
  });

  it("fails a run on an unexpected error with a plain reason, and logs only the kind of error, never its message", async () => {
    const { run } = await enqueue();
    inspector.failWith = Object.assign(new Error("connection string postgres://user:hunter2@db/prod refused"), { name: "DatabaseError" });
    await processor().tick();
    const after = await state(run);
    expect(after.status).toBe("failed");
    expect(after.failureReason).toBe(`the worker failed while preparing this run; see the worker log for ${run.correlationId}`);
    expect(JSON.stringify(after)).not.toContain("hunter2");
    expect(log.errors.join("\n")).toContain("DatabaseError");
    expect(log.errors.join("\n")).toContain(run.id);
    expect([...log.errors, ...log.lines].join("\n")).not.toContain("hunter2");
    expect(JSON.stringify(await events(run))).not.toContain("hunter2");
  });

  it("does not stop the pass when one run goes wrong: the next run is still prepared", async () => {
    const bad = await enqueue();
    const good = await enqueue();
    let calls = 0;
    inspector.before = () => {
      if (++calls === 1) throw new Error("boom");
    };
    expect(await processor().tick()).toMatchObject({ claimed: 2 });
    expect((await state(bad.run)).failureReason).toContain("the worker failed");
    expect((await state(good.run)).failureReason).toBe(STAGES_NOT_IMPLEMENTED);
  });

  describe("recovering from a worker that stopped", () => {
    it("fails a run that has been preparing for a long time without a new event, so the task can be run again", async () => {
      const { run } = await enqueue();
      await runs.transition(tenant, project, { ...run, status: "preparing", startedAt: NOW }, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, NOW);
      now = "2026-10-27T10:10:00Z";
      expect(await processor({ batchSize: 5, stalledAfterMs: 5 * 60_000 }).tick()).toEqual({ claimed: 0, recovered: 1 });
      const after = await state(run);
      expect(after).toMatchObject({ status: "failed", failureReason: "the worker stopped while preparing this run; start the task again", finishedAt: now });
      expect(inspector.calls).toEqual([]);
      expect(checkEventSequence(await events(run))).toEqual({ ok: true });
    });

    it("leaves alone a run that is preparing but has made progress recently", async () => {
      const { run } = await enqueue();
      await runs.transition(tenant, project, { ...run, status: "preparing", startedAt: NOW }, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, NOW);
      now = "2026-10-27T10:04:00Z";
      expect(await processor({ batchSize: 5, stalledAfterMs: 5 * 60_000 }).tick()).toEqual({ claimed: 0, recovered: 0 });
      expect((await state(run)).status).toBe("preparing");
    });

    it("loses nothing if the run is cancelled at the moment it is being recovered", async () => {
      const { run } = await enqueue();
      await runs.transition(tenant, project, { ...run, status: "preparing", startedAt: NOW }, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, NOW);
      now = "2026-10-27T10:10:00Z";
      class Racy extends InMemoryRunRepository {}
      const racy = Object.assign(runs, {
        transition: async (...args: Parameters<InMemoryRunRepository["transition"]>) => {
          runs.force(args[2].id, "cancelled");
          return InMemoryRunRepository.prototype.transition.apply(runs, args);
        },
      }) as Racy;
      const result = await processor({ batchSize: 5, stalledAfterMs: 5 * 60_000 }, racy).tick();
      expect(result.recovered).toBe(0);
      expect((await state(run)).status).toBe("cancelled");
      expect(log.errors).toEqual([]);
    });
  });

  it("raises RunStateConflictError from the store when a state is stale (the guarantee the worker relies on)", async () => {
    const { run } = await enqueue();
    runs.force(run.id, "cancelled");
    await expect(runs.transition(tenant, project, { ...run, status: "preparing" }, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, NOW)).rejects.toBeInstanceOf(RunStateConflictError);
  });
});
