import { z } from "zod";
import { DEFAULT_EDITABLE_POLICY, type EditablePolicy } from "../../policy";
import type { ProjectId, TenantId, UserId } from "../../shared-kernel";
import { PolicyUnchangedError, PolicyVersionConflictError } from "./errors";

export const PolicyComment = z.string().trim().max(500).brand<"PolicyComment">();
export type PolicyComment = z.infer<typeof PolicyComment>;

/**
 * One saved state of a project's editable policy (D10). Versions are never changed or deleted, so the list of them is the
 * audit trail: who changed the policy, when, to what, and why. Version 0 is the default policy that exists before any edit.
 */
export interface PolicyVersion {
  readonly version: number;
  readonly policy: EditablePolicy;
  readonly changedBy: UserId;
  readonly changedAt: string;
  readonly comment: string;
}

/** Order does not matter in these lists, so two policies with the same entries in another order are the same policy. */
const canonical = (policy: EditablePolicy): string =>
  JSON.stringify({
    allowedExecutables: [...policy.allowedExecutables].sort(),
    extraForbiddenExecutables: [...policy.extraForbiddenExecutables].sort(),
    extraProtectedBranches: [...policy.extraProtectedBranches].sort(),
    mcpToolDecisions: Object.entries(policy.mcpToolDecisions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    limits: policy.limits,
  });

/**
 * Builds the next version of a project's policy. The caller states which version it saw (`expectedVersion`); if someone
 * saved in between, the edit is refused instead of overwriting their change. A change that changes nothing is refused too,
 * so the history only holds real edits. Who may edit is checked by the caller against the project's members.
 */
export function createPolicyVersion(input: {
  latest: PolicyVersion | undefined;
  expectedVersion: number;
  policy: EditablePolicy;
  changedBy: UserId;
  comment: string;
  now: string;
}): PolicyVersion {
  const currentNumber = input.latest?.version ?? 0;
  if (input.expectedVersion !== currentNumber) throw new PolicyVersionConflictError();
  const current = input.latest?.policy ?? DEFAULT_EDITABLE_POLICY;
  if (canonical(current) === canonical(input.policy)) throw new PolicyUnchangedError();
  return { version: currentNumber + 1, policy: input.policy, changedBy: input.changedBy, changedAt: input.now, comment: input.comment };
}

/** Storage port of the policy history of projects. Append only; every lookup is scoped by tenant (D2). */
export interface ProjectPolicyRepository {
  findLatest(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion | undefined>;
  /** Newest first. */
  listVersions(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion[]>;
  /** Throws `PolicyVersionConflictError` when that version number already exists for the project. */
  append(tenantId: TenantId, projectId: ProjectId, version: PolicyVersion): Promise<void>;
}
