import {
  matchesBranchPattern,
  type BranchName,
  type BranchPattern,
  type ProjectId,
  type RepoProvider,
  type RepositoryMappingId,
  type Role,
  type TenantId,
  type UserId,
} from "../../shared-kernel";
import {
  DefaultBranchNotAllowedError,
  InsufficientRoleError,
  LastLeadError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  RepositoryAlreadyMappedError,
  RepositoryMappingNotFoundError,
  TooManyRepositoriesError,
} from "./errors";
import { canManageProject } from "./permissions";
import type { ProjectMember } from "./project-member";
import type { RepositoryMapping, RepositoryName, RepositoryUrl } from "./repository-mapping";
import type { ProjectDescription, ProjectName } from "./value-objects";

export const MAX_REPOSITORIES_PER_PROJECT = 20;

export interface ProjectProps {
  id: ProjectId;
  tenantId: TenantId;
  name: ProjectName;
  description: ProjectDescription;
  members: readonly ProjectMember[];
  repositories: readonly RepositoryMapping[];
  createdAt: string;
  updatedAt: string;
}

export interface NewRepositoryMapping {
  id: RepositoryMappingId;
  provider: RepoProvider;
  name: RepositoryName;
  url: RepositoryUrl;
  defaultBranch: BranchName;
  allowedBranches: readonly BranchPattern[];
}

/**
 * Aggregate root of the projects context. Members and repository mappings belong to it and change only through it, so its
 * rules always hold: the creator starts as PL, only a PM or PL changes anything, a user is a member once, a project keeps at
 * least one PL, a repository is connected once, and a repository's default branch is one of its allowed branches.
 */
export class Project {
  private constructor(private props: ProjectProps) {}

  static create(input: {
    id: ProjectId;
    tenantId: TenantId;
    name: ProjectName;
    description: ProjectDescription;
    creator: UserId;
    now: string;
  }): Project {
    return new Project({
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      members: [{ userId: input.creator, role: "PL", addedAt: input.now }],
      repositories: [],
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rebuilds a stored project; the data is trusted to have passed the rules when it was saved. */
  static restore(props: ProjectProps): Project {
    return new Project({ ...props, members: [...props.members], repositories: [...props.repositories] });
  }

  get id(): ProjectId {
    return this.props.id;
  }
  get tenantId(): TenantId {
    return this.props.tenantId;
  }
  get name(): ProjectName {
    return this.props.name;
  }
  get description(): ProjectDescription {
    return this.props.description;
  }
  get createdAt(): string {
    return this.props.createdAt;
  }
  get updatedAt(): string {
    return this.props.updatedAt;
  }

  members(): readonly ProjectMember[] {
    return this.props.members;
  }

  repositories(): readonly RepositoryMapping[] {
    return this.props.repositories;
  }

  roleOf(userId: UserId): Role | undefined {
    return this.props.members.find((member) => member.userId === userId)?.role;
  }

  /** Whether `userId` is a PM or PL of this project; the use cases that change something owned by the project ask this. */
  canBeManagedBy(userId: UserId): boolean {
    const role = this.roleOf(userId);
    return role !== undefined && canManageProject(role);
  }

  /** Whether a run of this project may start from `branch` of the connected repository. */
  isBranchAllowed(repositoryId: RepositoryMappingId, branch: string): boolean {
    const mapping = this.props.repositories.find((repository) => repository.id === repositoryId);
    return mapping !== undefined && mapping.allowedBranches.some((pattern) => matchesBranchPattern(pattern, branch));
  }

  rename(actor: UserId, name: ProjectName, now: string): void {
    this.requireManager(actor);
    this.props = { ...this.props, name, updatedAt: now };
  }

  describe(actor: UserId, description: ProjectDescription, now: string): void {
    this.requireManager(actor);
    this.props = { ...this.props, description, updatedAt: now };
  }

  addMember(actor: UserId, userId: UserId, role: Role, now: string): ProjectMember {
    this.requireManager(actor);
    if (this.roleOf(userId) !== undefined) throw new MemberAlreadyExistsError();
    const member: ProjectMember = { userId, role, addedAt: now };
    this.props = { ...this.props, members: [...this.props.members, member], updatedAt: now };
    return member;
  }

  changeMemberRole(actor: UserId, userId: UserId, role: Role, now: string): ProjectMember {
    this.requireManager(actor);
    const current = this.props.members.find((member) => member.userId === userId);
    if (!current) throw new MemberNotFoundError();
    if (current.role === "PL" && role !== "PL") this.requireAnotherLead(userId);
    const member: ProjectMember = { ...current, role };
    this.props = {
      ...this.props,
      members: this.props.members.map((existing) => (existing.userId === userId ? member : existing)),
      updatedAt: now,
    };
    return member;
  }

  removeMember(actor: UserId, userId: UserId, now: string): void {
    this.requireManager(actor);
    const current = this.props.members.find((member) => member.userId === userId);
    if (!current) throw new MemberNotFoundError();
    if (current.role === "PL") this.requireAnotherLead(userId);
    this.props = { ...this.props, members: this.props.members.filter((member) => member.userId !== userId), updatedAt: now };
  }

  addRepository(actor: UserId, input: NewRepositoryMapping, now: string): RepositoryMapping {
    this.requireManager(actor);
    if (this.props.repositories.length >= MAX_REPOSITORIES_PER_PROJECT) throw new TooManyRepositoriesError(MAX_REPOSITORIES_PER_PROJECT);
    const key = (provider: RepoProvider, name: string): string => `${provider}:${name.toLowerCase()}`;
    if (this.props.repositories.some((existing) => key(existing.provider, existing.name) === key(input.provider, input.name))) {
      throw new RepositoryAlreadyMappedError();
    }
    const allowedBranches = unique(input.allowedBranches);
    requireDefaultBranchAllowed(input.defaultBranch, allowedBranches);
    const mapping: RepositoryMapping = {
      id: input.id,
      provider: input.provider,
      name: input.name,
      url: input.url,
      defaultBranch: input.defaultBranch,
      allowedBranches,
      addedAt: now,
    };
    this.props = { ...this.props, repositories: [...this.props.repositories, mapping], updatedAt: now };
    return mapping;
  }

  changeRepositoryBranches(
    actor: UserId,
    repositoryId: RepositoryMappingId,
    change: { defaultBranch?: BranchName; allowedBranches?: readonly BranchPattern[] },
    now: string,
  ): RepositoryMapping {
    this.requireManager(actor);
    const current = this.props.repositories.find((repository) => repository.id === repositoryId);
    if (!current) throw new RepositoryMappingNotFoundError();
    const allowedBranches = change.allowedBranches ? unique(change.allowedBranches) : current.allowedBranches;
    const defaultBranch = change.defaultBranch ?? current.defaultBranch;
    requireDefaultBranchAllowed(defaultBranch, allowedBranches);
    const mapping: RepositoryMapping = { ...current, defaultBranch, allowedBranches };
    this.props = {
      ...this.props,
      repositories: this.props.repositories.map((existing) => (existing.id === repositoryId ? mapping : existing)),
      updatedAt: now,
    };
    return mapping;
  }

  removeRepository(actor: UserId, repositoryId: RepositoryMappingId, now: string): void {
    this.requireManager(actor);
    if (!this.props.repositories.some((repository) => repository.id === repositoryId)) throw new RepositoryMappingNotFoundError();
    this.props = {
      ...this.props,
      repositories: this.props.repositories.filter((repository) => repository.id !== repositoryId),
      updatedAt: now,
    };
  }

  toProps(): ProjectProps {
    return { ...this.props, members: [...this.props.members], repositories: [...this.props.repositories] };
  }

  private requireManager(actor: UserId): void {
    const role = this.roleOf(actor);
    if (role === undefined || !canManageProject(role)) throw new InsufficientRoleError();
  }

  /** Called before a PL stops being one: someone else must still be PL. */
  private requireAnotherLead(leaving: UserId): void {
    const others = this.props.members.filter((member) => member.role === "PL" && member.userId !== leaving);
    if (others.length === 0) throw new LastLeadError();
  }
}

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

function requireDefaultBranchAllowed(defaultBranch: BranchName, allowed: readonly BranchPattern[]): void {
  if (!allowed.some((pattern) => matchesBranchPattern(pattern, defaultBranch))) throw new DefaultBranchNotAllowedError();
}
