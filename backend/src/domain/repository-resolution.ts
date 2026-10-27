import { z } from "zod";
import { ProjectId, RunId, TenantId, Timestamp } from "./ids";
import { RepoRef } from "./task";

/**
 * Who decided which repository a run works on, in order of precedence. There is deliberately no model-chosen
 * value: the target repository never comes from the task text alone. When none of these identifies one
 * repository, the run ends in `blocked` instead.
 */
export const ResolutionSource = z.enum(["user_selected", "project_mapping", "trusted_metadata"]);
export type ResolutionSource = z.infer<typeof ResolutionSource>;

/** The repository a run works on and the exact commit it starts from. */
export const RepositoryResolution = z.object({
  tenantId: TenantId,
  projectId: ProjectId,
  runId: RunId,
  repo: RepoRef,
  source: ResolutionSource,
  /** Full object id: 40 hex characters (SHA-1) or 64 (SHA-256 repositories). */
  baseCommitSha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/),
  resolvedAt: Timestamp,
});
export type RepositoryResolution = z.infer<typeof RepositoryResolution>;
