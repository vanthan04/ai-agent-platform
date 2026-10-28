import { describe, expect, it } from "vitest";
import type { Run, Task } from "@/lib/api/types";
import { NO_FILTERS, applyFilters, countByStatus, groupRuns } from "@/lib/execution";
import { taskStatus } from "@/lib/status";
import { lines } from "@/lib/text";
import { fromDraft } from "@/components/setup/PolicyView";

const task = (id: string, title: string, outputs: Task["outputs"] = ["report"]): Task => ({
  id,
  title,
  description: "",
  source: { type: "manual" },
  repositoryId: "r1",
  repo: { provider: "github", name: "acme/app", url: "https://github.com/acme/app", baseBranch: "develop" },
  inputs: {},
  outputs,
  createdBy: "dev",
  createdAt: "2026-01-01T00:00:00Z",
});

const run = (taskId: string, attempt: number, status: Run["status"]): Run => ({
  id: `${taskId}-${attempt}`,
  taskId,
  attempt,
  status,
  publishes: false,
  idempotencyKey: "k",
  correlationId: "c",
  requestedBy: "dev",
  createdAt: "2026-01-01T00:00:00Z",
});

describe("taskStatus", () => {
  it("is ready with no run or after a cancelled one", () => {
    expect(taskStatus([])).toBe("ready");
    expect(taskStatus([run("t", 1, "cancelled")])).toBe("ready");
  });

  it("follows the newest attempt, not the order given", () => {
    expect(taskStatus([run("t", 2, "failed"), run("t", 1, "queued")])).toBe("failed");
    expect(taskStatus([run("t", 1, "failed"), run("t", 2, "preparing")])).toBe("in_progress");
  });

  it("maps blocked, rejected and succeeded", () => {
    expect(taskStatus([run("t", 1, "blocked")])).toBe("blocked");
    expect(taskStatus([run("t", 1, "rejected")])).toBe("failed");
    expect(taskStatus([run("t", 1, "succeeded")])).toBe("succeeded");
  });
});

describe("grouping and filters", () => {
  const items = groupRuns(
    [task("a", "Fix login", ["diff"]), task("b", "Write report"), task("c", "Upgrade deps", ["pull_request"])],
    [run("a", 1, "failed"), run("a", 2, "queued"), run("b", 1, "blocked"), run("zzz", 1, "queued")],
  );

  it("puts the newest attempt first and ignores runs of unknown tasks", () => {
    expect(items[0]?.runs.map((r) => r.attempt)).toEqual([2, 1]);
    expect(items.flatMap((item) => item.runs).some((r) => r.taskId === "zzz")).toBe(false);
  });

  it("counts by status", () => {
    expect(countByStatus(items)).toEqual({ ready: 1, in_progress: 1, blocked: 1, failed: 0, succeeded: 0 });
  });

  it("filters by status, output and text together", () => {
    expect(applyFilters(items, { ...NO_FILTERS, status: "blocked" }).map((i) => i.task.id)).toEqual(["b"]);
    expect(applyFilters(items, { ...NO_FILTERS, type: "pull_request" }).map((i) => i.task.id)).toEqual(["c"]);
    expect(applyFilters(items, { ...NO_FILTERS, search: "  LOGIN " }).map((i) => i.task.id)).toEqual(["a"]);
    expect(applyFilters(items, { search: "login", status: "ready", type: "all" })).toEqual([]);
  });
});

describe("lines and policy draft", () => {
  it("trims, drops empty lines and repeats", () => {
    expect(lines(" git \r\n\r\npnpm\ngit\n")).toEqual(["git", "pnpm"]);
  });

  it("turns a draft into the policy the server expects", () => {
    expect(
      fromDraft({
        allowedExecutables: "git\npnpm",
        extraForbiddenExecutables: "",
        extraProtectedBranches: "release/*",
        decisions: [
          ["jira:getIssue", "allow"],
          ["  ", "ask"],
        ],
        commandTimeoutSeconds: "60",
        maxToolCallsPerRun: "100",
        comment: "ignored",
      }),
    ).toEqual({
      allowedExecutables: ["git", "pnpm"],
      extraForbiddenExecutables: [],
      extraProtectedBranches: ["release/*"],
      mcpToolDecisions: { "jira:getIssue": "allow" },
      limits: { commandTimeoutSeconds: 60, maxToolCallsPerRun: 100 },
    });
  });
});
