import type { AuthUser } from "../../identity";
import { ProjectNotFoundError, type ProjectsService } from "../../projects";
import type { Role } from "../../shared-kernel";
import type { ProjectAccess } from "../application/ports";

/** Asks the projects context who the caller is in a project. */
export class ProjectsServiceAccess implements ProjectAccess {
  constructor(private readonly projects: ProjectsService) {}

  async roleOf(user: AuthUser, projectId: string): Promise<Role | undefined> {
    try {
      return (await this.projects.get(user, projectId)).role;
    } catch (error) {
      if (error instanceof ProjectNotFoundError) return undefined;
      throw error;
    }
  }
}
