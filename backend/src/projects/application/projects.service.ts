import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import type { BranchName, BranchPattern, RepoProvider, RepositoryMappingId, Role, UserId } from "../../shared-kernel";
import {
  Project,
  ProjectDescription,
  ProjectNotFoundError,
  type ProjectMember,
  type ProjectName,
  type ProjectRepository,
  type RepositoryMapping,
  type RepositoryName,
  type RepositoryUrl,
} from "../domain";
import { loadVisibleProject } from "./load-project";
import { CLOCK, PROJECT_REPOSITORY, type Clock } from "./ports";
import type { MemberView, ProjectView, RepositoryMappingView } from "./views";

const NO_DESCRIPTION = ProjectDescription.parse("");

const memberView = (member: ProjectMember): MemberView => ({ userId: member.userId, role: member.role, addedAt: member.addedAt });

const repositoryView = (mapping: RepositoryMapping): RepositoryMappingView => ({
  id: mapping.id,
  provider: mapping.provider,
  name: mapping.name,
  url: mapping.url,
  defaultBranch: mapping.defaultBranch,
  allowedBranches: [...mapping.allowedBranches],
  addedAt: mapping.addedAt,
});

/** A project is only ever shown to its members: anyone else gets the same answer as for a project that does not exist. */
const projectView = (project: Project, viewer: UserId): ProjectView => {
  const role = project.roleOf(viewer);
  if (role === undefined) throw new ProjectNotFoundError();
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    role,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
};

/** Use cases of the projects context. It loads an aggregate, asks it to change, saves it; the rules themselves live in `Project`. */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(user: AuthUser, input: { name: ProjectName; description?: ProjectDescription }): Promise<ProjectView> {
    const project = Project.create({
      id: this.projects.nextId(),
      tenantId: user.tenantId,
      name: input.name,
      description: input.description ?? NO_DESCRIPTION,
      creator: user.userId,
      now: this.clock.now(),
    });
    await this.projects.save(project);
    return projectView(project, user.userId);
  }

  async list(user: AuthUser): Promise<ProjectView[]> {
    const projects = await this.projects.listByMember(user.tenantId, user.userId);
    return projects.map((project) => projectView(project, user.userId));
  }

  async get(user: AuthUser, projectId: string): Promise<ProjectView> {
    return projectView(await this.load(user, projectId), user.userId);
  }

  async update(
    user: AuthUser,
    projectId: string,
    patch: { name?: ProjectName; description?: ProjectDescription },
  ): Promise<ProjectView> {
    const project = await this.load(user, projectId);
    const now = this.clock.now();
    if (patch.name !== undefined) project.rename(user.userId, patch.name, now);
    if (patch.description !== undefined) project.describe(user.userId, patch.description, now);
    await this.projects.save(project);
    return projectView(project, user.userId);
  }

  async listMembers(user: AuthUser, projectId: string): Promise<MemberView[]> {
    return (await this.load(user, projectId)).members().map(memberView);
  }

  async addMember(user: AuthUser, projectId: string, input: { userId: UserId; role: Role }): Promise<MemberView> {
    const project = await this.load(user, projectId);
    const member = project.addMember(user.userId, input.userId, input.role, this.clock.now());
    await this.projects.save(project);
    return memberView(member);
  }

  async changeMemberRole(user: AuthUser, projectId: string, memberId: UserId, role: Role): Promise<MemberView> {
    const project = await this.load(user, projectId);
    const member = project.changeMemberRole(user.userId, memberId, role, this.clock.now());
    await this.projects.save(project);
    return memberView(member);
  }

  async removeMember(user: AuthUser, projectId: string, memberId: UserId): Promise<void> {
    const project = await this.load(user, projectId);
    project.removeMember(user.userId, memberId, this.clock.now());
    await this.projects.save(project);
  }

  async listRepositories(user: AuthUser, projectId: string): Promise<RepositoryMappingView[]> {
    return (await this.load(user, projectId)).repositories().map(repositoryView);
  }

  async addRepository(
    user: AuthUser,
    projectId: string,
    input: {
      provider: RepoProvider;
      name: RepositoryName;
      url: RepositoryUrl;
      defaultBranch: BranchName;
      allowedBranches: readonly BranchPattern[];
    },
  ): Promise<RepositoryMappingView> {
    const project = await this.load(user, projectId);
    const mapping = project.addRepository(user.userId, { id: this.projects.nextRepositoryMappingId(), ...input }, this.clock.now());
    await this.projects.save(project);
    return repositoryView(mapping);
  }

  async changeRepositoryBranches(
    user: AuthUser,
    projectId: string,
    repositoryId: RepositoryMappingId,
    change: { defaultBranch?: BranchName; allowedBranches?: readonly BranchPattern[] },
  ): Promise<RepositoryMappingView> {
    const project = await this.load(user, projectId);
    const mapping = project.changeRepositoryBranches(user.userId, repositoryId, change, this.clock.now());
    await this.projects.save(project);
    return repositoryView(mapping);
  }

  async removeRepository(user: AuthUser, projectId: string, repositoryId: RepositoryMappingId): Promise<void> {
    const project = await this.load(user, projectId);
    project.removeRepository(user.userId, repositoryId, this.clock.now());
    await this.projects.save(project);
  }

  private load(user: AuthUser, projectId: string): Promise<Project> {
    return loadVisibleProject(this.projects, user, projectId);
  }
}
