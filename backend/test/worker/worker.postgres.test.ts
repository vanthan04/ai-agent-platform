import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClientHolder } from "../../src/database";
import { Task, checkEventSequence, createRun, type Run, type RunQueue } from "../../src/execution";
import { PrismaResolutionRepository } from "../../src/execution/infrastructure/prisma-resolution.repository";
import { PrismaRunQueue } from "../../src/execution/infrastructure/prisma-run-queue";
import { PrismaRunRepository } from "../../src/execution/infrastructure/prisma-run.repository";
import { PrismaTaskRepository } from "../../src/execution/infrastructure/prisma-task.repository";
import { Project, ProjectDescription, ProjectName } from "../../src/projects";
import { PrismaProjectRepository } from "../../src/projects/infrastructure/prisma-project.repository";
import { CorrelationId, IdempotencyKey, RepositoryMappingId, TenantId, UserId } from "../../src/shared-kernel";
import { RunProcessor, STAGES_NOT_IMPLEMENTED, type RepositoryInspector } from "../../src/worker";
import { NOW } from "../support/time";

const url = process.env["DATABASE_URL"];
const SHA = "fedcba9876543210fedcba9876543210fedcba98";

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("the worker's ports and the worker itself, on Postgres", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const dev = UserId.parse("dev");
  const holder = new PrismaClientHolder(url);
  const projects = new PrismaProjectRepository(holder);
  const tasks = new PrismaTaskRepository(holder);
  const runs = new PrismaRunRepository(holder);
  const queue = new PrismaRunQueue(holder);
  const resolutions = new PrismaResolutionRepository(holder);

  afterAll(async () => {
    await holder.db().project.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await holder.onModuleDestroy();
  });

  const newRun = async (tenantId: TenantId, name: string, created = NOW): Promise<{ run: Run; task: Task }> => {
    const project = Project.create({ id: projects.nextId(), tenantId, name: ProjectName.parse(name), description: ProjectDescription.parse(""), creator: dev, now: NOW });
    await projects.save(project);
    const task = Task.parse({
      id: tasks.nextId(),
      tenantId,
      projectId: project.id,
      title: "Add retry",
      description: "",
      source: { type: "manual" },
      repositoryId: RepositoryMappingId.parse("mapping-1"),
      repo: { provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", baseBranch: "develop" },
      inputs: {},
      outputs: ["report"],
      createdBy: dev,
      createdAt: NOW,
    });
    await tasks.save(task);
    const run = createRun({
      id: runs.nextId(),
      tenantId,
      projectId: project.id,
      task,
      attempt: 1,
      idempotencyKey: IdempotencyKey.parse(`key-${randomUUID()}`),
      correlationId: CorrelationId.parse(`corr-${randomUUID()}`),
      requestedBy: dev,
      now: created,
    });
    await runs.create(run, { type: "log", level: "info", message: "queued" });
    return { run, task };
  };

  it("lists queued runs of every tenant, oldest first, and no run that is not queued", async () => {
    const older = await newRun(tenantA, "WorkerQueueA", "2026-10-27T09:00:00Z");
    const newer = await newRun(tenantB, "WorkerQueueB", "2026-10-27T09:30:00Z");
    const ours = (await queue.listQueued(1_000)).filter((run) => [older.run.id, newer.run.id].includes(run.id));
    expect(ours.map((run) => run.id)).toEqual([older.run.id, newer.run.id]);
    expect(ours.map((run) => run.tenantId)).toEqual([tenantA, tenantB]);
    expect(await queue.listQueued(0)).toEqual([]);
    await runs.transition(tenantA, older.run.projectId, { ...older.run, status: "cancelled", finishedAt: NOW }, "queued", { type: "run.status_changed", from: "queued", to: "cancelled" }, NOW);
    expect((await queue.listQueued(1_000)).map((run) => run.id)).not.toContain(older.run.id);
  });

  it("lists runs that have made no progress since a time, by their last event", async () => {
    const { run } = await newRun(tenantA, "WorkerStalled");
    await runs.transition(tenantA, run.projectId, { ...run, status: "preparing", startedAt: NOW }, "queued", { type: "run.status_changed", from: "queued", to: "preparing" }, "2026-10-27T10:00:00Z");
    const ids = async (idleSince: string) => (await queue.listStalled("preparing", idleSince, 1_000)).map((r) => r.id);
    expect(await ids("2026-10-27T10:05:00Z")).toContain(run.id);
    expect(await ids("2026-10-27T10:00:00Z")).toContain(run.id);
    expect(await ids("2026-10-27T09:59:59Z")).not.toContain(run.id);
    expect(await queue.listStalled("analyzing", "2030-01-01T00:00:00Z", 1_000).then((list) => list.map((r) => r.id))).not.toContain(run.id);
  });

  it("numbers events without gaps even when several are added at the same moment", async () => {
    const { run } = await newRun(tenantA, "WorkerEvents");
    await Promise.all(Array.from({ length: 6 }, (_, i) => runs.appendEvent(tenantA, run.projectId, run.id, { type: "log", level: "info", message: `note ${i}` }, NOW)));
    const events = await runs.events(tenantA, run.projectId, run.id, 0, 100);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(checkEventSequence(events)).toEqual({ ok: true });
    await expect(runs.appendEvent(tenantB, run.projectId, run.id, { type: "log", level: "info", message: "x" }, NOW)).rejects.toThrow();
  });

  it("keeps the commit a run started from, once, for its own tenant only", async () => {
    const { run } = await newRun(tenantA, "WorkerResolution");
    expect(await resolutions.find(tenantA, run.projectId, run.id)).toBeUndefined();
    await resolutions.save(tenantA, run.projectId, run.id, { source: "user_selected", baseCommitSha: SHA, resolvedAt: NOW });
    expect(await resolutions.find(tenantA, run.projectId, run.id)).toMatchObject({ source: "user_selected", baseCommitSha: SHA });
    expect(await resolutions.find(tenantB, run.projectId, run.id)).toBeUndefined();
    await expect(resolutions.save(tenantA, run.projectId, run.id, { source: "user_selected", baseCommitSha: "a".repeat(40), resolvedAt: NOW })).rejects.toThrow("already has a resolution");
    await expect(resolutions.save(tenantB, run.projectId, run.id, { source: "user_selected", baseCommitSha: SHA, resolvedAt: NOW })).rejects.toThrow();
    expect((await resolutions.find(tenantA, run.projectId, run.id))?.baseCommitSha).toBe(SHA);
  });

  it("prepares a run end to end against the real tables, and two workers at once still prepare it once", async () => {
    const { run, task } = await newRun(tenantA, "WorkerEndToEnd");
    const calls: string[] = [];
    const inspector: RepositoryInspector = {
      async branchHead(target) {
        calls.push(`${target.url} ${target.branch}`);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true, commitSha: SHA };
      },
    };
    // This test shares the database with other data, so the worker is shown only the runs this test made.
    const mine = new Set<string>([run.id]);
    const onlyMine: RunQueue = {
      listQueued: async (limit) => (await queue.listQueued(1_000)).filter((r) => mine.has(r.id)).slice(0, limit),
      listStalled: async (status, idleSince, limit) => (await queue.listStalled(status, idleSince, 1_000)).filter((r) => mine.has(r.id)).slice(0, limit),
    };
    const worker = () => new RunProcessor({ queue: onlyMine, runs, tasks, resolutions, inspector, clock: { now: () => new Date().toISOString() }, log: { info() {}, error() {} } });
    const results = await Promise.all([worker().tick(), worker().tick()]);
    expect(results.map((r) => r.claimed).sort()).toEqual([0, 1]);
    expect(calls).toEqual([`${task.repo.url} ${task.repo.baseBranch}`]);

    const after = await runs.findById(tenantA, run.projectId, run.id);
    expect(after).toMatchObject({ status: "failed", failureReason: STAGES_NOT_IMPLEMENTED });
    expect(after?.startedAt).toBeTruthy();
    expect(after?.finishedAt).toBeTruthy();
    expect(await resolutions.find(tenantA, run.projectId, run.id)).toMatchObject({ source: "user_selected", baseCommitSha: SHA });
    const events = await runs.events(tenantA, run.projectId, run.id, 0, 100);
    expect(checkEventSequence(events)).toEqual({ ok: true });
    expect(events.map((e) => (e.type === "run.status_changed" ? `${e.from}->${e.to}` : e.type))).toEqual(["log", "queued->preparing", "log", "log", "preparing->failed"]);
    expect(await runs.latestAttempt(tenantA, task.id)).toBe(1);
  });
});
