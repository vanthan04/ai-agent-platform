import type { AuthUser } from "../../identity";
import { ProjectNotFoundError, type Project, type ProjectRepository } from "../domain";

/** A project is only visible to its members: anyone else gets the same answer as for a project that does not exist. */
export async function loadVisibleProject(projects: ProjectRepository, user: AuthUser, projectId: string): Promise<Project> {
  const project = await projects.findById(user.tenantId, projectId);
  if (!project || project.roleOf(user.userId) === undefined) throw new ProjectNotFoundError();
  return project;
}
