import type { AuthUser } from "../../identity";
import type { Role } from "../../shared-kernel";

export const MODEL_SETTINGS_REPOSITORY = Symbol("MODEL_SETTINGS_REPOSITORY");
export const PROJECT_ACCESS = Symbol("PROJECT_ACCESS");
export const CLOCK = Symbol("CLOCK");

/** Time comes through a port so a test can fix it. */
export interface Clock {
  now(): string;
}

/** What this context needs to know about a project, asked of the projects context instead of read from its tables. */
export interface ProjectAccess {
  /** The caller's role in the project, or `undefined` when the project does not exist or the caller is not a member. */
  roleOf(user: AuthUser, projectId: string): Promise<Role | undefined>;
}
