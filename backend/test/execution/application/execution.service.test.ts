import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/identity";
import {
  BranchNotAllowedError,
  ExecutionForbiddenError,
  ExecutionProjectNotFoundError,
  IdempotencyKeyReusedError,
  RepositoryNotInProjectError,
  RunNotCancellableError,
  RunNotFoundError,
  RunStateConflictError,
  RunsService,
  TaskHasActiveRunError,
  TaskNotFoundError,
  TasksService,
  type CatalogRepository,
  type ProjectCatalog,
} from "../../../src/execution";
import { CorrelationId, IdempotencyKey, RepositoryMappingId, Role, TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryRunRepository, InMemoryTaskRepository } from "../../support/in-memory-execution.repositories";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const pm = user("pm");
const dev = user("dev");
const otherDev = user("other-dev");
const stranger = user("stranger");

const SHOP: CatalogRepository = {
  id: "mapping-1",
  provider: "github",
  name: "org/shop",
  url: "https://github.com/org/shop.git",
  defaultBranch: "develop",
  allowedBranches: ["develop", "release/*"],
};

/** One project, `project-1`, with the given roles and one connected repository. */
const catalog = (): ProjectCatalog => {
  const roles: Record<string, Role> = { "tenant-1/alice": "PL", "tenant-1/pm": "PM", "tenant-1/dev": "DEV", "tenant-1/other-dev": "DEV" };
  return {
    async roleOf(who, projectId) {
      return projectId === "project-1" ? roles[`${who.tenantId}/${who.userId}`] : undefined;
    },
    async repository(who, projectId, repositoryId) {
      return projectId === "project-1" && roles[`${who.tenantId}/${who.userId}`] && repositoryId === SHOP.id ? SHOP : undefined;
    },
  };
};

const taskInput = (overrides: Partial<Parameters<TasksService["create"]>[2]> = {}) => ({
  title: "Add retry to the uploader",
  description: "Retry three times, then report.",
  source: { type: "manual" as const },
  repositoryId: RepositoryMappingId.parse("mapping-1"),
  baseBranch: "develop",
  inputs: {},
  outputs: ["report" as const],
  ...overrides,
});

const key = (value: string) => ({ idempotencyKey: IdempotencyKey.parse(value), correlationId: CorrelationId.parse("corr-12345678") });

describe("tasks and runs", () => {
  let taskRepo: InMemoryTaskRepository;
  let runRepo: InMemoryRunRepository;
  let tasks: TasksService;
  let runs: RunsService;
  let taskId: string;

  const build = (repo: InMemoryRunRepository = runRepo) => new RunsService(repo, taskRepo, catalog(), { now: () => NOW });

  beforeEach(async () => {
    taskRepo = new InMemoryTaskRepository();
    runRepo = new InMemoryRunRepository();
    tasks = new TasksService(taskRepo, catalog(), { now: () => NOW });
    runs = build();
    taskId = (await tasks.create(dev, "project-1", taskInput())).id;
  });

  describe("creating a task", () => {
    it("stores what the person described, with a copy of the repository it targets", async () => {
      const task = await tasks.get(dev, "project-1", taskId);
      expect(task).toMatchObject({
        title: "Add retry to the uploader",
        source: { type: "manual" },
        repositoryId: "mapping-1",
        repo: { provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", baseBranch: "develop" },
        outputs: ["report"],
        createdBy: "dev",
        createdAt: NOW,
      });
    });

    it("lets any member create one, including a DEV, and lists newest first", async () => {
      await tasks.create(alice, "project-1", taskInput({ title: "Second" }));
      expect((await tasks.list(dev, "project-1", 10)).map((task) => task.title)).toEqual(["Second", "Add retry to the uploader"]);
      expect(await tasks.list(dev, "project-1", 1)).toHaveLength(1);
    });

    it("accepts a base branch that matches an allowed pattern and refuses any other", async () => {
      await expect(tasks.create(dev, "project-1", taskInput({ baseBranch: "release/2.0" }))).resolves.toMatchObject({ repo: { baseBranch: "release/2.0" } });
      await expect(tasks.create(dev, "project-1", taskInput({ baseBranch: "main" }))).rejects.toBeInstanceOf(BranchNotAllowedError);
      await expect(tasks.create(dev, "project-1", taskInput({ baseBranch: "feat/anything" }))).rejects.toBeInstanceOf(BranchNotAllowedError);
    });

    it("only works against a repository the project connected", async () => {
      await expect(tasks.create(dev, "project-1", taskInput({ repositoryId: RepositoryMappingId.parse("mapping-of-another-project") }))).rejects.toBeInstanceOf(RepositoryNotInProjectError);
    });

    it("shows a non-member nothing and creates nothing", async () => {
      await expect(tasks.create(stranger, "project-1", taskInput())).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(tasks.list(stranger, "project-1", 10)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(tasks.get(stranger, "project-1", taskId)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(tasks.create(alice, "no-such-project", taskInput())).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(tasks.get(user("alice", "tenant-2"), "project-1", taskId)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      expect(await tasks.list(alice, "project-1", 10)).toHaveLength(1);
    });

    it("answers not found for an unknown task", async () => {
      await expect(tasks.get(dev, "project-1", "no-such-task")).rejects.toBeInstanceOf(TaskNotFoundError);
    });
  });

  describe("starting a run", () => {
    it("queues a run at once, as attempt 1, with a first event, and says it was created", async () => {
      const started = await runs.start(dev, "project-1", taskId, key("key-1"));
      expect(started.created).toBe(true);
      expect(started.run).toMatchObject({ taskId, attempt: 1, status: "queued", publishes: false, idempotencyKey: "key-1", correlationId: "corr-12345678", requestedBy: "dev", createdAt: NOW });
      expect(started.run).not.toHaveProperty("startedAt");
      expect(await runs.events(dev, "project-1", started.run.id, 0, 10)).toEqual([{ seq: 1, at: NOW, type: "log", level: "info", message: expect.stringContaining("queued") }]);
    });

    it("answers with the same run for the same key, and does not start a second one", async () => {
      const first = await runs.start(dev, "project-1", taskId, key("key-1"));
      const again = await runs.start(dev, "project-1", taskId, key("key-1"));
      expect(again).toEqual({ run: first.run, created: false });
      expect(await runs.list(dev, "project-1", { limit: 10 })).toHaveLength(1);
    });

    it("answers with the same run even after it ended, and refuses the key for another task", async () => {
      const first = await runs.start(dev, "project-1", taskId, key("key-1"));
      await runs.cancel(dev, "project-1", first.run.id);
      expect((await runs.start(dev, "project-1", taskId, key("key-1"))).created).toBe(false);
      const other = (await tasks.create(dev, "project-1", taskInput({ title: "Other" }))).id;
      await expect(runs.start(dev, "project-1", other, key("key-1"))).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    });

    it("allows one run in progress per task, and a new run of an ended task is its next attempt", async () => {
      const first = await runs.start(dev, "project-1", taskId, key("key-1"));
      await expect(runs.start(dev, "project-1", taskId, key("key-2"))).rejects.toBeInstanceOf(TaskHasActiveRunError);
      await runs.cancel(dev, "project-1", first.run.id);
      const second = await runs.start(dev, "project-1", taskId, key("key-2"));
      expect(second.run.attempt).toBe(2);
      expect(second.run.id).not.toBe(first.run.id);
      expect((await runs.get(dev, "project-1", first.run.id)).status).toBe("cancelled");
    });

    it("can run two different tasks at the same time", async () => {
      const other = (await tasks.create(dev, "project-1", taskInput({ title: "Other" }))).id;
      await runs.start(dev, "project-1", taskId, key("key-1"));
      await expect(runs.start(dev, "project-1", other, key("key-2"))).resolves.toMatchObject({ created: true });
    });

    it("fixes `publishes` from the task's outputs", async () => {
      const publishing = (await tasks.create(dev, "project-1", taskInput({ title: "Ship it", outputs: ["diff", "pull_request"] }))).id;
      expect((await runs.start(dev, "project-1", publishing, key("key-p"))).run.publishes).toBe(true);
    });

    it("shows a non-member nothing, and nothing for an unknown task", async () => {
      await expect(runs.start(stranger, "project-1", taskId, key("key-1"))).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(runs.start(dev, "project-1", "no-such-task", key("key-1"))).rejects.toBeInstanceOf(TaskNotFoundError);
      expect(await runs.list(dev, "project-1", { limit: 10 })).toEqual([]);
    });
  });

  describe("reading runs", () => {
    it("lists runs newest first and filters by task and by status", async () => {
      const other = (await tasks.create(dev, "project-1", taskInput({ title: "Other" }))).id;
      const a = await runs.start(dev, "project-1", taskId, key("key-a"));
      const b = await runs.start(dev, "project-1", other, key("key-b"));
      await runs.cancel(dev, "project-1", a.run.id);
      expect((await runs.list(alice, "project-1", { limit: 10 })).map((run) => run.id)).toEqual([b.run.id, a.run.id]);
      expect((await runs.list(alice, "project-1", { limit: 10, taskId })).map((run) => run.id)).toEqual([a.run.id]);
      expect((await runs.list(alice, "project-1", { limit: 10, status: "queued" })).map((run) => run.id)).toEqual([b.run.id]);
      expect(await runs.list(alice, "project-1", { limit: 1 })).toHaveLength(1);
    });

    it("answers not found for an unknown run, and hides runs of another tenant", async () => {
      const started = await runs.start(dev, "project-1", taskId, key("key-1"));
      await expect(runs.get(dev, "project-1", "no-such-run")).rejects.toBeInstanceOf(RunNotFoundError);
      await expect(runs.get(user("dev", "tenant-2"), "project-1", started.run.id)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
    });
  });

  describe("cancelling a run", () => {
    it("lets the person who started it cancel, and records the change as the next event", async () => {
      const started = await runs.start(dev, "project-1", taskId, key("key-1"));
      const cancelled = await runs.cancel(dev, "project-1", started.run.id);
      expect(cancelled).toMatchObject({ status: "cancelled", finishedAt: NOW });
      expect((await runs.events(dev, "project-1", started.run.id, 0, 10)).map((event) => event.seq)).toEqual([1, 2]);
      expect((await runs.events(dev, "project-1", started.run.id, 1, 10))[0]).toEqual({ seq: 2, at: NOW, type: "run.status_changed", from: "queued", to: "cancelled" });
      expect(await runs.events(dev, "project-1", started.run.id, 2, 10)).toEqual([]);
    });

    it("lets a PM or PL cancel any run, and not another DEV", async () => {
      const first = await runs.start(dev, "project-1", taskId, key("key-1"));
      await expect(runs.cancel(otherDev, "project-1", first.run.id)).rejects.toBeInstanceOf(ExecutionForbiddenError);
      expect((await runs.cancel(pm, "project-1", first.run.id)).status).toBe("cancelled");
      const second = await runs.start(dev, "project-1", taskId, key("key-2"));
      expect((await runs.cancel(alice, "project-1", second.run.id)).status).toBe("cancelled");
    });

    it("refuses a run that is publishing or already ended, and changes nothing", async () => {
      const started = await runs.start(dev, "project-1", taskId, key("key-1"));
      runRepo.force(started.run.id, "publishing");
      await expect(runs.cancel(dev, "project-1", started.run.id)).rejects.toBeInstanceOf(RunNotCancellableError);
      runRepo.force(started.run.id, "succeeded");
      await expect(runs.cancel(alice, "project-1", started.run.id)).rejects.toBeInstanceOf(RunNotCancellableError);
      expect((await runs.get(dev, "project-1", started.run.id)).status).toBe("succeeded");
      expect(await runs.events(dev, "project-1", started.run.id, 0, 10)).toHaveLength(1);
    });

    it("refuses when the run changed after it was read, instead of overwriting the other change", async () => {
      class Racy extends InMemoryRunRepository {
        armed = false;
        override async transition(...args: Parameters<InMemoryRunRepository["transition"]>): Promise<void> {
          if (this.armed) this.force(args[2].id, "preparing");
          return super.transition(...args);
        }
      }
      const racy = new Racy();
      const service = build(racy);
      const started = await service.start(dev, "project-1", taskId, key("key-1"));
      racy.armed = true;
      await expect(service.cancel(dev, "project-1", started.run.id)).rejects.toBeInstanceOf(RunStateConflictError);
      expect((await service.get(dev, "project-1", started.run.id)).status).toBe("preparing");
    });

    it("shows a non-member nothing", async () => {
      const started = await runs.start(dev, "project-1", taskId, key("key-1"));
      await expect(runs.cancel(stranger, "project-1", started.run.id)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
      await expect(runs.events(stranger, "project-1", started.run.id, 0, 10)).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
    });
  });
});
