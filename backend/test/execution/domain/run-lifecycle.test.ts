import { describe, expect, it } from "vitest";
import {
  RunNotCancellableError,
  RunStatus,
  canCancelRun,
  cancelRun,
  checkEventSequence,
  createRun,
  isActive,
} from "../../../src/execution";
import { CorrelationId, IdempotencyKey, ProjectId, Role, RunId, TaskId, TenantId, UserId } from "../../../src/shared-kernel";
import { NOW, makeRun } from "./fixtures";

const input = (outputs: ("report" | "diff" | "test_report" | "pull_request")[]) => ({
  id: RunId.parse("run-1"),
  tenantId: TenantId.parse("tenant-1"),
  projectId: ProjectId.parse("project-1"),
  task: { id: TaskId.parse("task-1"), outputs },
  attempt: 2,
  idempotencyKey: IdempotencyKey.parse("key-1"),
  correlationId: CorrelationId.parse("corr-12345678"),
  requestedBy: UserId.parse("alice"),
  now: NOW,
});

describe("createRun", () => {
  it("queues a run with its attempt, keys and requester, and no start or finish time", () => {
    expect(createRun(input(["report"]))).toEqual({
      id: "run-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      taskId: "task-1",
      attempt: 2,
      idempotencyKey: "key-1",
      correlationId: "corr-12345678",
      requestedBy: "alice",
      status: "queued",
      publishes: false,
      createdAt: NOW,
    });
  });

  it("fixes `publishes` from what the task asks for, so approval is part of the path only then", () => {
    expect(createRun(input(["report", "diff"])).publishes).toBe(false);
    expect(createRun(input(["diff", "pull_request"])).publishes).toBe(true);
  });
});

describe("cancelRun", () => {
  const CANCELLABLE: RunStatus[] = ["queued", "preparing", "analyzing", "planning", "implementing", "verifying", "awaiting_approval"];

  it.each(CANCELLABLE)("cancels a run that is %s and records when", (status) => {
    const cancelled = cancelRun(makeRun(status, false), NOW);
    expect(cancelled).toMatchObject({ status: "cancelled", finishedAt: NOW });
  });

  it("refuses a run that is publishing, because code may already be leaving", () => {
    expect(() => cancelRun(makeRun("publishing", true), NOW)).toThrow(RunNotCancellableError);
  });

  it.each(["succeeded", "rejected", "failed", "cancelled", "blocked"] as const)("refuses a run that is already %s", (status) => {
    expect(() => cancelRun(makeRun(status, false), NOW)).toThrow(RunNotCancellableError);
  });

  it("does not change the run it was given", () => {
    const run = makeRun("queued", false);
    cancelRun(run, NOW);
    expect(run.status).toBe("queued");
  });
});

describe("canCancelRun", () => {
  const run = { requestedBy: UserId.parse("alice") };

  it("lets a PM or PL cancel any run and anyone else only their own", () => {
    for (const role of Role.options) {
      expect(canCancelRun(run, UserId.parse("someone-else"), role), role).toBe(role === "PM" || role === "PL");
      expect(canCancelRun(run, UserId.parse("alice"), role), role).toBe(true);
    }
  });
});

describe("isActive", () => {
  it("is true until a run reaches a final state, the same states the database index treats as final", () => {
    expect(RunStatus.options.filter(isActive)).toEqual(["queued", "preparing", "analyzing", "planning", "implementing", "verifying", "awaiting_approval", "publishing"]);
    expect(RunStatus.options.filter((status) => !isActive(status))).toEqual(["succeeded", "rejected", "failed", "cancelled", "blocked"]);
  });
});

describe("event numbering", () => {
  it("stays valid when a cancel adds the second event", () => {
    const base = { tenantId: "tenant-1", runId: "run-1", at: NOW };
    const events = [
      { id: "e1", seq: 1, type: "log", level: "info", message: "queued", ...base },
      { id: "e2", seq: 2, type: "run.status_changed", from: "queued", to: "cancelled", ...base },
    ];
    expect(checkEventSequence(events as never)).toEqual({ ok: true });
  });
});
