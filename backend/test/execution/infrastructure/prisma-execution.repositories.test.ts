import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClientHolder } from "../../../src/database";
import {
  DuplicateRunError,
  RunStateConflictError,
  Task,
  TaskHasActiveRunError,
  cancelRun,
  checkEventSequence,
  createRun,
  type RunEventDraft,
} from "../../../src/execution";
import { PrismaRunRepository } from "../../../src/execution/infrastructure/prisma-run.repository";
import { PrismaTaskRepository } from "../../../src/execution/infrastructure/prisma-task.repository";
import { Project, ProjectDescription, ProjectName } from "../../../src/projects";
import { PrismaProjectRepository } from "../../../src/projects/infrastructure/prisma-project.repository";
import { CorrelationId, IdempotencyKey, RepositoryMappingId, TenantId, UserId, type ProjectId } from "../../../src/shared-kernel";
import { NOW } from "../../support/time";

const url = process.env["DATABASE_URL"];
const queued: RunEventDraft = { type: "log", level: "info", message: "queued" };

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("Prisma task and run repositories (Postgres)", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const alice = UserId.parse("alice");
  const holder = new PrismaClientHolder(url);
  const projects = new PrismaProjectRepository(holder);
  const tasks = new PrismaTaskRepository(holder);
  const runs = new PrismaRunRepository(holder);

  afterAll(async () => {
    await holder.db().project.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await holder.onModuleDestroy();
  });

  const newProject = async (tenantId: TenantId, name: string): Promise<Project> => {
    const project = Project.create({ id: projects.nextId(), tenantId, name: ProjectName.parse(name), description: ProjectDescription.parse(""), creator: alice, now: NOW });
    await projects.save(project);
    return project;
  };

  const newTask = async (project: Project, title = "Add retry", extra: Partial<Parameters<typeof Task.parse>[0]> = {}): Promise<Task> => {
    const task = Task.parse({
      id: tasks.nextId(),
      tenantId: project.tenantId,
      projectId: project.id,
      title,
      description: "details",
      source: { type: "manual" },
      repositoryId: RepositoryMappingId.parse("mapping-1"),
      repo: { provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", baseBranch: "develop" },
      inputs: { hint: "start in uploader.ts" },
      outputs: ["report", "diff"],
      createdBy: alice,
      createdAt: NOW,
      ...extra,
    });
    await tasks.save(task);
    return task;
  };

  const newRun = (task: Task, key: string, attempt = 1, now = NOW) =>
    createRun({
      id: runs.nextId(),
      tenantId: task.tenantId,
      projectId: task.projectId,
      task,
      attempt,
      idempotencyKey: IdempotencyKey.parse(key),
      correlationId: CorrelationId.parse(`corr-${randomUUID()}`),
      requestedBy: alice,
      now,
    });

  it("saves a task with its repository copy and reads it back for its tenant and project only", async () => {
    const project = await newProject(tenantA, "ExecTasks");
    const task = await newTask(project, "With jira", { source: { type: "jira", issueKey: "ABC-123" } });
    const loaded = await tasks.findById(tenantA, project.id, task.id);
    expect(loaded).toMatchObject({ title: "With jira", source: { type: "jira", issueKey: "ABC-123" }, repositoryId: "mapping-1", inputs: { hint: "start in uploader.ts" }, outputs: ["report", "diff"], repo: { name: "org/shop", baseBranch: "develop" } });
    expect(new Date(loaded?.createdAt ?? "").getTime()).toBe(new Date(NOW).getTime());
    expect(await tasks.findById(tenantB, project.id, task.id)).toBeUndefined();
    expect(await tasks.findById(tenantA, (await newProject(tenantA, "ExecTasksOther")).id, task.id)).toBeUndefined();
    await newTask(project, "Second", { createdAt: "2026-10-27T10:00:01Z" });
    expect((await tasks.list(tenantA, project.id, 10)).map((t) => t.title)).toEqual(["Second", "With jira"]);
    expect(await tasks.list(tenantA, project.id, 1)).toHaveLength(1);
    expect(await tasks.list(tenantB, project.id, 10)).toEqual([]);
    await expect(tasks.save({ ...task, id: tasks.nextId(), tenantId: tenantB })).rejects.toThrow();
  });

  it("creates a run with its first event, and finds it by id and by idempotency key", async () => {
    const project = await newProject(tenantA, "ExecRuns");
    const task = await newTask(project);
    const run = newRun(task, "key-1");
    await runs.create(run, queued);
    expect(await runs.findById(tenantA, project.id, run.id)).toMatchObject({ status: "queued", attempt: 1, publishes: false, requestedBy: "alice", idempotencyKey: "key-1" });
    expect((await runs.findByIdempotencyKey(tenantA, project.id, "key-1"))?.id).toBe(run.id);
    expect(await runs.findByIdempotencyKey(tenantB, project.id, "key-1")).toBeUndefined();
    expect(await runs.findById(tenantB, project.id, run.id)).toBeUndefined();
    expect(await runs.latestAttempt(tenantA, task.id)).toBe(1);
    const events = await runs.events(tenantA, project.id, run.id, 0, 10);
    expect(events).toMatchObject([{ seq: 1, type: "log", level: "info", message: "queued" }]);
    expect(await runs.events(tenantB, project.id, run.id, 0, 10)).toEqual([]);
  });

  it("refuses a repeated idempotency key and a second run in progress, enforced by the database", async () => {
    const project = await newProject(tenantA, "ExecRules");
    const task = await newTask(project);
    const first = newRun(task, "key-1");
    await runs.create(first, queued);
    await expect(runs.create(newRun(task, "key-1", 2), queued)).rejects.toBeInstanceOf(DuplicateRunError);
    await expect(runs.create(newRun(task, "key-2", 2), queued)).rejects.toBeInstanceOf(TaskHasActiveRunError);
    const other = await newTask(project, "Other");
    await expect(runs.create(newRun(other, "key-1"), queued)).rejects.toBeInstanceOf(DuplicateRunError);
    await expect(runs.create(newRun(other, "key-3"), queued)).resolves.toBeUndefined();
    expect(await runs.list(tenantA, project.id, { limit: 10 })).toHaveLength(2);
  });

  it("lets a task have a new run once the earlier one ended, as the next attempt, keeping the old evidence", async () => {
    const project = await newProject(tenantA, "ExecAttempts");
    const task = await newTask(project);
    const first = newRun(task, "key-1");
    await runs.create(first, queued);
    const cancelled = cancelRun(first, NOW);
    await runs.transition(tenantA, project.id, cancelled, "queued", { type: "run.status_changed", from: "queued", to: "cancelled" }, NOW);
    expect(await runs.latestAttempt(tenantA, task.id)).toBe(1);
    const second = newRun(task, "key-2", 2, "2026-10-27T10:00:05Z");
    await runs.create(second, queued);
    expect(await runs.latestAttempt(tenantA, task.id)).toBe(2);
    expect((await runs.findById(tenantA, project.id, first.id))?.status).toBe("cancelled");
    expect((await runs.list(tenantA, project.id, { limit: 10, taskId: task.id })).map((r) => r.attempt)).toEqual([2, 1]);
    expect((await runs.list(tenantA, project.id, { limit: 10, status: "cancelled" })).map((r) => r.id)).toEqual([first.id]);
    expect(await runs.events(tenantA, project.id, first.id, 0, 10)).toHaveLength(2);
  });

  it("changes state only from the state the caller saw, and numbers events without gaps", async () => {
    const project = await newProject(tenantA, "ExecTransition");
    const task = await newTask(project);
    const run = newRun(task, "key-1");
    await runs.create(run, queued);
    const cancelled = cancelRun(run, NOW);
    await expect(runs.transition(tenantA, project.id, cancelled, "planning", { type: "run.status_changed", from: "planning", to: "cancelled" }, NOW)).rejects.toBeInstanceOf(RunStateConflictError);
    expect(await runs.events(tenantA, project.id, run.id, 0, 10)).toHaveLength(1);
    await runs.transition(tenantA, project.id, cancelled, "queued", { type: "run.status_changed", from: "queued", to: "cancelled" }, NOW);
    const stored = await runs.findById(tenantA, project.id, run.id);
    expect(stored).toMatchObject({ status: "cancelled" });
    expect(new Date(stored?.finishedAt ?? "").getTime()).toBe(new Date(NOW).getTime());
    const events = await runs.events(tenantA, project.id, run.id, 0, 10);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(checkEventSequence(events)).toEqual({ ok: true });
    expect(events[1]).toMatchObject({ type: "run.status_changed", from: "queued", to: "cancelled" });
    expect((await runs.events(tenantA, project.id, run.id, 1, 10)).map((e) => e.seq)).toEqual([2]);
    await expect(runs.transition(tenantB, project.id, cancelled, "cancelled", { type: "log", level: "info", message: "x" }, NOW)).rejects.toBeInstanceOf(RunStateConflictError);
  });

  it("lets only one of two simultaneous cancels win", async () => {
    const project = await newProject(tenantA, "ExecRace");
    const task = await newTask(project);
    const run = newRun(task, "key-1");
    await runs.create(run, queued);
    const cancelled = cancelRun(run, NOW);
    const attempt = () => runs.transition(tenantA, project.id, cancelled, "queued", { type: "run.status_changed", from: "queued", to: "cancelled" }, NOW);
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof RunStateConflictError)).toBe(true);
    expect((await runs.events(tenantA, project.id, run.id, 0, 10)).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("lets only one of two simultaneous requests with the same key create a run", async () => {
    const project = await newProject(tenantA, "ExecSameKey");
    const task = await newTask(project);
    const results = await Promise.allSettled([runs.create(newRun(task, "same-key"), queued), runs.create(newRun(task, "same-key"), queued)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof DuplicateRunError)).toBe(true);
    expect(await runs.list(tenantA, project.id, { limit: 10 })).toHaveLength(1);
  });

  it("refuses to read a run whose state the code does not know instead of using it", async () => {
    const project = await newProject(tenantA, "ExecTampered");
    const task = await newTask(project);
    const id = randomUUID();
    await holder.db().run.create({
      data: { id, projectId: project.id as ProjectId, taskId: task.id, attempt: 9, status: "sleeping", publishes: false, idempotencyKey: "tampered", correlationId: "corr-12345678", requestedBy: "mallory", createdAt: new Date(NOW) },
    });
    await expect(runs.findById(tenantA, project.id, id)).rejects.toThrow();
  });
});
