import { randomUUID } from "node:crypto";
import { isUniqueViolation, type PrismaClientHolder } from "../../database";
import { ProjectId, TenantId, UserId } from "../../shared-kernel";
import { SecretRef } from "../../vault";
import {
  DuplicateMcpConnectionError,
  McpConnection,
  McpConnectionId,
  McpConnectionName,
  McpServerUrl,
  type McpConnectionRepository,
} from "../domain";

interface Row {
  id: string;
  projectId: string;
  name: string;
  url: string;
  secretRef: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const toAggregate = (row: Row, tenantId: TenantId): McpConnection =>
  McpConnection.restore({
    id: McpConnectionId.parse(row.id),
    tenantId,
    projectId: ProjectId.parse(row.projectId),
    name: McpConnectionName.parse(row.name),
    url: McpServerUrl.parse(row.url),
    secretRef: row.secretRef === null ? undefined : SecretRef.parse(row.secretRef),
    createdBy: UserId.parse(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

/** Postgres through Prisma. Every query goes through the project's tenant. */
export class PrismaMcpConnectionRepository implements McpConnectionRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  nextId(): McpConnectionId {
    return McpConnectionId.parse(randomUUID());
  }

  async save(connection: McpConnection): Promise<void> {
    const props = connection.toProps();
    const db = this.prisma.db();
    const project = await db.project.findFirst({ where: { id: props.projectId, tenantId: props.tenantId }, select: { id: true } });
    if (!project) throw new Error("project not found in this tenant");
    const data = {
      name: props.name,
      url: props.url,
      secretRef: props.secretRef ?? null,
      updatedAt: new Date(props.updatedAt),
    };
    try {
      await db.mcpConnection.upsert({
        where: { id: props.id },
        create: { id: props.id, projectId: props.projectId, createdBy: props.createdBy, createdAt: new Date(props.createdAt), ...data },
        update: data,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateMcpConnectionError();
      throw error;
    }
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<McpConnection | undefined> {
    const row = await this.prisma.db().mcpConnection.findFirst({ where: { id, projectId, project: { tenantId } } });
    return row ? toAggregate(row, tenantId) : undefined;
  }

  async listByProject(tenantId: TenantId, projectId: ProjectId): Promise<McpConnection[]> {
    const rows = await this.prisma.db().mcpConnection.findMany({
      where: { projectId, project: { tenantId } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => toAggregate(row, tenantId));
  }

  async delete(tenantId: TenantId, projectId: ProjectId, id: McpConnectionId): Promise<void> {
    await this.prisma.db().mcpConnection.deleteMany({ where: { id, projectId, project: { tenantId } } });
  }
}
