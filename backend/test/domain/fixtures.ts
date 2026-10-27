import {
  Approval,
  ApprovalId,
  Run,
  RunId,
  TaskId,
  TenantId,
  UserId,
  type RunStatus,
} from "../../src/domain";

export const NOW = "2026-10-27T10:00:00Z";
export const DIFF_HASH = "a".repeat(64);
export const PROTECTED = ["main", "master", "develop", "release/*"];

export function makeRun(status: RunStatus, publishes: boolean): Run {
  return Run.parse({
    id: "run-1",
    tenantId: "tenant-1",
    taskId: "task-1",
    attempt: 1,
    status,
    publishes,
    createdAt: NOW,
  });
}

export function makeApproval(overrides: Partial<Record<keyof Approval, unknown>> = {}): Approval {
  return Approval.parse({
    id: "appr-1",
    tenantId: "tenant-1",
    runId: "run-1",
    approverId: "user-1",
    approverRole: "PL",
    decision: "approved",
    diffHash: DIFF_HASH,
    targetBranch: "feat/abc-1-thing",
    decidedAt: NOW,
    ...overrides,
  });
}

export const publishDetails = { diffHash: DIFF_HASH, targetBranch: "feat/abc-1-thing", protectedBranches: PROTECTED };

export const ids = {
  tenant: TenantId.parse("tenant-1"),
  user: UserId.parse("user-1"),
  task: TaskId.parse("task-1"),
  run: RunId.parse("run-1"),
  approval: ApprovalId.parse("appr-1"),
};
