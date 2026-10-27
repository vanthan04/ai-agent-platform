import { DuplicateProjectNameError, Project, type ProjectProps, type ProjectRepository } from "../../src/projects";
import { ProjectId, RepositoryMappingId, type TenantId, type UserId } from "../../src/shared-kernel";

/** Same contract as the Postgres repository, kept in memory, so the use cases and the HTTP layer are tested without a database. */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly stored = new Map<string, ProjectProps>();
  private counter = 0;
  private mappingCounter = 0;

  nextId(): ProjectId {
    return ProjectId.parse(`project-${++this.counter}`);
  }

  nextRepositoryMappingId(): RepositoryMappingId {
    return RepositoryMappingId.parse(`mapping-${++this.mappingCounter}`);
  }

  async save(project: Project): Promise<void> {
    const props = project.toProps();
    for (const other of this.stored.values()) {
      if (other.id !== props.id && other.tenantId === props.tenantId && other.name === props.name) {
        throw new DuplicateProjectNameError();
      }
    }
    this.stored.set(props.id, props);
  }

  async findById(tenantId: TenantId, id: string): Promise<Project | undefined> {
    const props = this.stored.get(id);
    return props && props.tenantId === tenantId ? Project.restore(props) : undefined;
  }

  async listByMember(tenantId: TenantId, userId: UserId): Promise<Project[]> {
    return [...this.stored.values()]
      .filter((props) => props.tenantId === tenantId && props.members.some((member) => member.userId === userId))
      .map((props) => Project.restore(props));
  }
}
