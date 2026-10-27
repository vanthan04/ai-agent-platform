import type { AuthUser } from "../../identity";
import type { RepoProvider, Role } from "../../shared-kernel";

export const TASK_REPOSITORY = Symbol("TASK_REPOSITORY");
export const RUN_REPOSITORY = Symbol("RUN_REPOSITORY");
export const PROJECT_CATALOG = Symbol("PROJECT_CATALOG");
export const CLOCK = Symbol("CLOCK");

/** Time comes through a port so a test can fix it. */
export interface Clock {
  now(): string;
}

/** A repository connected to a project, as the projects context describes it. */
export interface CatalogRepository {
  id: string;
  provider: RepoProvider;
  name: string;
  url: string;
  defaultBranch: string;
  allowedBranches: readonly string[];
}

/** What this context needs to know about a project, asked of the projects context instead of read from its tables. */
export interface ProjectCatalog {
  /** The caller's role in the project, or `undefined` when the project does not exist or the caller is not a member. */
  roleOf(user: AuthUser, projectId: string): Promise<Role | undefined>;
  /** A repository connected to the project, or `undefined`. The caller must be a member of the project. */
  repository(user: AuthUser, projectId: string, repositoryId: string): Promise<CatalogRepository | undefined>;
}
