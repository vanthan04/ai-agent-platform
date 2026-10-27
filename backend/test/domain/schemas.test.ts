import { describe, expect, it } from "vitest";
import { RunEvent, Task, TaskId, checkEventSequence, taskPublishes } from "../../src/domain";
import { NOW } from "./fixtures";

const baseTask = {
  id: "task-1",
  tenantId: "tenant-1",
  title: "Add retry to uploader",
  description: "",
  source: { type: "manual" },
  repo: { provider: "github", name: "org/repo", url: "https://example.invalid/org/repo.git", baseBranch: "develop" },
  inputs: {},
  outputs: ["report"],
  createdBy: "user-1",
  createdAt: NOW,
};

describe("Task", () => {
  it("parses a valid manual task", () => {
    expect(Task.safeParse(baseTask).success).toBe(true);
  });

  it("accepts a Jira source with a well-formed key and rejects a malformed one", () => {
    expect(Task.safeParse({ ...baseTask, source: { type: "jira", issueKey: "ABC-123" } }).success).toBe(true);
    expect(Task.safeParse({ ...baseTask, source: { type: "jira", issueKey: "abc-123" } }).success).toBe(false);
    expect(Task.safeParse({ ...baseTask, source: { type: "jira", issueKey: "ABC123" } }).success).toBe(false);
  });

  it("rejects unknown repo providers, empty outputs and empty ids", () => {
    expect(Task.safeParse({ ...baseTask, repo: { ...baseTask.repo, provider: "gitlab" } }).success).toBe(false);
    expect(Task.safeParse({ ...baseTask, outputs: [] }).success).toBe(false);
    expect(TaskId.safeParse("").success).toBe(false);
  });

  it("publishes only when a pull_request output is requested", () => {
    expect(taskPublishes({ outputs: ["report", "diff"] })).toBe(false);
    expect(taskPublishes({ outputs: ["diff", "pull_request"] })).toBe(true);
  });
});

describe("RunEvent and sequence", () => {
  const log = (seq: number, runId = "run-1") =>
    RunEvent.parse({
      id: `evt-${runId}-${seq}`,
      tenantId: "tenant-1",
      runId,
      seq,
      at: NOW,
      type: "log",
      level: "info",
      message: "hello",
    });

  it("accepts an in-order sequence and an empty one", () => {
    expect(checkEventSequence([])).toEqual({ ok: true });
    expect(checkEventSequence([log(1), log(2), log(3)])).toEqual({ ok: true });
  });

  it("flags a gap, a repeat and a foreign run", () => {
    expect(checkEventSequence([log(1), log(3)]).ok).toBe(false);
    expect(checkEventSequence([log(1), log(1)]).ok).toBe(false);
    expect(checkEventSequence([log(1), log(2, "run-2")]).ok).toBe(false);
  });

  it("rejects an unknown event type and an over-long message", () => {
    expect(RunEvent.safeParse({ id: "e", tenantId: "t", runId: "r", seq: 1, at: NOW, type: "nope" }).success).toBe(false);
    expect(
      RunEvent.safeParse({ id: "e", tenantId: "t", runId: "r", seq: 1, at: NOW, type: "log", level: "info", message: "x".repeat(2_001) }).success,
    ).toBe(false);
  });
});
