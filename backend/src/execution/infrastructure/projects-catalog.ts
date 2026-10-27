import type { AuthUser } from "../../identity";
import { ProjectNotFoundError, type ProjectsService } from "../../projects";
import type { Role } from "../../shared-kernel";
import type { CatalogRepository, ProjectCatalog } from "../application/ports";

/** Asks the projects context who the caller is in a project and which repositories it has connected. */
export class ProjectsServiceCatalog implements ProjectCatalog {
  constructor(private readonly projects: ProjectsService) {}

  async roleOf(user: AuthUser, projectId: string): Promise<Role | undefined> {
    try {
      return (await this.projects.get(user, projectId)).role;
    } catch (error) {
      if (error instanceof ProjectNotFoundError) return undefined;
      throw error;
    }
  }

  async repository(user: AuthUser, projectId: string, repositoryId: string): Promise<CatalogRepository | undefined> {
    const repository = (await this.projects.listRepositories(user, projectId)).find((candidate) => candidate.id === repositoryId);
    return repository && { ...repository };
  }
}
