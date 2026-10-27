import { z } from "zod";
import { isProtectedBranch } from "./branch";
import { ApprovalId, RunId, TenantId, Timestamp, UserId } from "./ids";
import { Role, canApprovePublish } from "./roles";

export const ApprovalDecision = z.enum(["approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/** An approval covers one exact diff and one target branch; changing either invalidates it. */
export const Approval = z.object({
  id: ApprovalId,
  tenantId: TenantId,
  runId: RunId,
  approverId: UserId,
  approverRole: Role,
  decision: ApprovalDecision,
  diffHash: z.string().regex(/^[0-9a-f]{64}$/),
  targetBranch: z.string().min(1),
  decidedAt: Timestamp,
});
export type Approval = z.infer<typeof Approval>;

export interface PublishExpectation {
  runId: RunId;
  diffHash: string;
  targetBranch: string;
  protectedBranches: readonly string[];
}

export type Validation = { ok: true } | { ok: false; reason: string };

export function validatePublishApproval(
  approval: Approval | undefined,
  expected: PublishExpectation,
): Validation {
  if (!approval) return { ok: false, reason: "no approval recorded" };
  if (approval.decision !== "approved") return { ok: false, reason: "approval was not granted" };
  if (!canApprovePublish(approval.approverRole)) {
    return { ok: false, reason: `role ${approval.approverRole} cannot approve a publish` };
  }
  if (approval.runId !== expected.runId) return { ok: false, reason: "approval belongs to another run" };
  if (approval.diffHash !== expected.diffHash) return { ok: false, reason: "diff changed after approval" };
  if (approval.targetBranch !== expected.targetBranch) {
    return { ok: false, reason: "target branch differs from the approved one" };
  }
  if (isProtectedBranch(expected.targetBranch, expected.protectedBranches)) {
    return { ok: false, reason: `${expected.targetBranch} is a protected branch` };
  }
  return { ok: true };
}
