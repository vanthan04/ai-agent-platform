import { randomUUID } from "node:crypto";
import { BranchName, BranchPattern, ProjectId, RepoProvider, RepositoryMappingId, Role, TenantId, UserId } from "../../shared-kernel";
import {
  DuplicateProjectNameError,
  Project,
  ProjectDescription,
  ProjectName,
  RepositoryName,
  RepositoryUrl,
  type ProjectRepository,
} from "../domain";
import { PrismaClientHolder, isUniqueViolation } from "../../database";

interface ProjectRow {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  members: { userId: string; role: string; createdAt: Date }[];
  repositories: {
    id: string;
    provider: string;
    name: string;
    url: string;
    defaultBranch: string;
    allowedBranches: string[];
    createdAt: Date;
  }[];
}

const INCLUDE = { members: true, repositories: true } as const;

const toAggregate = (row: ProjectRow): Project =>
  Project.restore({
    id: ProjectId.parse(row.id),
    tenantId: TenantId.parse(row.tenantId),
    name: ProjectName.parse(row.name),
    description: ProjectDescription.parse(row.description),
    members: row.members.map((member) => ({
      userId: UserId.parse(member.userId),
      role: Role.parse(member.role),
      addedAt: member.createdAt.toISOString(),
    })),
    repositories: [...row.repositories]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((repository) => ({
        id: RepositoryMappingId.parse(repository.id),
        provider: RepoProvider.parse(repository.provider),
        name: RepositoryName.parse(repository.name),
        url: RepositoryUrl.parse(repository.url),
        defaultBranch: BranchName.parse(repository.defaultBranch),
        allowedBranches: repository.allowedBranches.map((pattern) => BranchPattern.parse(pattern)),
        addedAt: repository.createdAt.toISOString(),
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

/** Postgres through Prisma. */
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  private db() {
    return this.prisma.db();
  }

  nextId(): ProjectId {
    return ProjectId.parse(randomUUID());
  }

  nextRepositoryMappingId(): RepositoryMappingId {
    return RepositoryMappingId.parse(randomUUID());
  }

  async save(project: Project): Promise<void> {
    const props = project.toProps();
    await this.db().$transaction(async (tx) => {
      try {
        await tx.project.upsert({
          where: { id: props.id },
          create: {
            id: props.id,
            tenantId: props.tenantId,
            name: props.name,
            description: props.description,
            createdAt: new Date(props.createdAt),
            updatedAt: new Date(props.updatedAt),
          },
          update: { name: props.name, description: props.description, updatedAt: new Date(props.updatedAt) },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateProjectNameError();
        throw error;
      }
      await tx.projectMember.deleteMany({
        where: { projectId: props.id, userId: { notIn: props.members.map((member) => member.userId) } },
      });
      for (const member of props.members) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: props.id, userId: member.userId } },
          create: { projectId: props.id, userId: member.userId, role: member.role, createdAt: new Date(member.addedAt) },
          update: { role: member.role },
        });
      }
      await tx.repositoryMapping.deleteMany({
        where: { projectId: props.id, id: { notIn: props.repositories.map((repository) => repository.id) } },
      });
      for (const repository of props.repositories) {
        const data = {
          provider: repository.provider,
          name: repository.name,
          url: repository.url,
          defaultBranch: repository.defaultBranch,
          allowedBranches: [...repository.allowedBranches],
        };
        await tx.repositoryMapping.upsert({
          where: { id: repository.id },
          create: { id: repository.id, projectId: props.id, createdAt: new Date(repository.addedAt), ...data },
          update: data,
        });
      }
    });
  }

  async findById(tenantId: TenantId, id: string): Promise<Project | undefined> {
    const row = await this.db().project.findFirst({ where: { id, tenantId }, include: INCLUDE });
    return row ? toAggregate(row) : undefined;
  }

  async listByMember(tenantId: TenantId, userId: UserId): Promise<Project[]> {
    const rows = await this.db().project.findMany({
      where: { tenantId, members: { some: { userId } } },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toAggregate);
  }
}
