import type { BaselineDescription, EditablePolicy } from "../../policy";
import type { RepoProvider, Role } from "../../shared-kernel";

export interface PolicyVersionView {
  version: number;
  policy: EditablePolicy;
  changedBy: string;
  changedAt: string;
  comment: string;
}

/**
 * A project's policy as a settings screen needs it: the version and the editable part, what that part adds up to once merged
 * with the baseline, and the baseline itself (read-only). Version 0 is the default policy; it has no author yet.
 */
export interface PolicyView {
  version: number;
  policy: EditablePolicy;
  effective: { protectedBranches: string[]; allowedExecutables: string[]; forbiddenExecutables: string[] };
  baseline: BaselineDescription;
  changedBy?: string;
  changedAt?: string;
  comment?: string;
}

/** A project as one user sees it. The tenant is never exposed. */
export interface ProjectView {
  id: string;
  name: string;
  description: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface MemberView {
  userId: string;
  role: Role;
  addedAt: string;
}

export interface RepositoryMappingView {
  id: string;
  provider: RepoProvider;
  name: string;
  url: string;
  defaultBranch: string;
  allowedBranches: string[];
  addedAt: string;
}
