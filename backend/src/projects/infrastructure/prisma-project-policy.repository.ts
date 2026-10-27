import { EditablePolicy } from "../../policy";
import { UserId, type ProjectId, type TenantId } from "../../shared-kernel";
import { PolicyVersionConflictError, type PolicyVersion, type ProjectPolicyRepository } from "../domain";
import { PrismaClientHolder, isUniqueViolation } from "../../database";

interface PolicyRow {
  version: number;
  policy: unknown;
  changedBy: string;
  comment: string;
  createdAt: Date;
}

/** The stored JSON is checked again against the current rules on every read, so a row written under older rules can never widen a project's policy. */
const toVersion = (row: PolicyRow): PolicyVersion => ({
  version: row.version,
  policy: EditablePolicy.parse(row.policy),
  changedBy: UserId.parse(row.changedBy),
  changedAt: row.createdAt.toISOString(),
  comment: row.comment,
});

/** Postgres through Prisma. Append only: there is no update and no delete. */
export class PrismaProjectPolicyRepository implements ProjectPolicyRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  async findLatest(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion | undefined> {
    const row = await this.prisma.db().projectPolicyVersion.findFirst({
      where: { projectId, project: { tenantId } },
      orderBy: { version: "desc" },
    });
    return row ? toVersion(row) : undefined;
  }

  async listVersions(tenantId: TenantId, projectId: ProjectId): Promise<PolicyVersion[]> {
    const rows = await this.prisma.db().projectPolicyVersion.findMany({
      where: { projectId, project: { tenantId } },
      orderBy: { version: "desc" },
    });
    return rows.map(toVersion);
  }

  async append(tenantId: TenantId, projectId: ProjectId, version: PolicyVersion): Promise<void> {
    const db = this.prisma.db();
    const project = await db.project.findFirst({ where: { id: projectId, tenantId }, select: { id: true } });
    if (!project) throw new Error("project not found in this tenant");
    try {
      await db.projectPolicyVersion.create({
        data: {
          projectId,
          version: version.version,
          policy: JSON.parse(JSON.stringify(version.policy)),
          changedBy: version.changedBy,
          comment: version.comment,
          createdAt: new Date(version.changedAt),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PolicyVersionConflictError();
      throw error;
    }
  }
}
