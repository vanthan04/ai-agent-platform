import { randomUUID } from "node:crypto";
import type { PrismaClientHolder } from "../../database";
import { ProjectId, RepoProvider, RepositoryMappingId, TaskId, TenantId, UserId } from "../../shared-kernel";
import { Task, type TaskRepository } from "../domain";

interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  description: string;
  sourceType: string;
  jiraIssueKey: string | null;
  repositoryMappingId: string;
  repoProvider: string;
  repoName: string;
  repoUrl: string;
  baseBranch: string;
  inputs: unknown;
  outputs: string[];
  createdBy: string;
  createdAt: Date;
}

/** Rebuilt through the schema, so a row that no longer satisfies today's rules is refused instead of used. */
const toTask = (row: TaskRow, tenantId: TenantId): Task =>
  Task.parse({
    id: row.id,
    tenantId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    source: row.sourceType === "jira" ? { type: "jira", issueKey: row.jiraIssueKey } : { type: "manual" },
    repositoryId: row.repositoryMappingId,
    repo: { provider: row.repoProvider, name: row.repoName, url: row.repoUrl, baseBranch: row.baseBranch },
    inputs: row.inputs,
    outputs: row.outputs,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });

/** Postgres through Prisma. Every query goes through the project's tenant. */
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  nextId(): TaskId {
    return TaskId.parse(randomUUID());
  }

  async save(task: Task): Promise<void> {
    const db = this.prisma.db();
    const project = await db.project.findFirst({ where: { id: task.projectId, tenantId: task.tenantId }, select: { id: true } });
    if (!project) throw new Error("project not found in this tenant");
    await db.task.create({
      data: {
        id: task.id,
        projectId: ProjectId.parse(task.projectId),
        title: task.title,
        description: task.description,
        sourceType: task.source.type,
        jiraIssueKey: task.source.type === "jira" ? task.source.issueKey : null,
        repositoryMappingId: RepositoryMappingId.parse(task.repositoryId),
        repoProvider: RepoProvider.parse(task.repo.provider),
        repoName: task.repo.name,
        repoUrl: task.repo.url,
        baseBranch: task.repo.baseBranch,
        inputs: task.inputs,
        outputs: task.outputs,
        createdBy: UserId.parse(task.createdBy),
        createdAt: new Date(task.createdAt),
      },
    });
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Task | undefined> {
    const row = await this.prisma.db().task.findFirst({ where: { id, projectId, project: { tenantId } } });
    return row ? toTask(row, tenantId) : undefined;
  }

  async list(tenantId: TenantId, projectId: ProjectId, limit: number): Promise<Task[]> {
    const rows = await this.prisma.db().task.findMany({
      where: { projectId, project: { tenantId } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => toTask(row, tenantId));
  }
}
