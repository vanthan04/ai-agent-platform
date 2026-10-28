import type { PrismaClientHolder } from "../../database";
import { ProjectId, TenantId, UserId } from "../../shared-kernel";
import { SecretRef } from "../../vault";
import { ModelBaseUrl, ModelName, ModelProvider, ModelSettings, type ModelSettingsRepository } from "../domain";

interface Row {
  projectId: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  secretRef: string | null;
  updatedBy: string;
  updatedAt: Date;
}

/** A stored value that no longer passes today's rules is refused, not used. */
const toAggregate = (row: Row, tenantId: TenantId): ModelSettings =>
  ModelSettings.restore({
    tenantId,
    projectId: ProjectId.parse(row.projectId),
    provider: ModelProvider.parse(row.provider),
    model: ModelName.parse(row.model),
    baseUrl: row.baseUrl === null ? undefined : ModelBaseUrl.parse(row.baseUrl),
    secretRef: row.secretRef === null ? undefined : SecretRef.parse(row.secretRef),
    updatedBy: UserId.parse(row.updatedBy),
    updatedAt: row.updatedAt.toISOString(),
  });

/** Postgres through Prisma. Every query goes through the project's tenant. */
export class PrismaModelSettingsRepository implements ModelSettingsRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  async save(settings: ModelSettings): Promise<void> {
    const props = settings.toProps();
    const db = this.prisma.db();
    const project = await db.project.findFirst({ where: { id: props.projectId, tenantId: props.tenantId }, select: { id: true } });
    if (!project) throw new Error("project not found in this tenant");
    const data = {
      provider: props.provider,
      model: props.model,
      baseUrl: props.baseUrl ?? null,
      secretRef: props.secretRef ?? null,
      updatedBy: props.updatedBy,
      updatedAt: new Date(props.updatedAt),
    };
    await db.projectModelSettings.upsert({ where: { projectId: props.projectId }, create: { projectId: props.projectId, ...data }, update: data });
  }

  async find(tenantId: TenantId, projectId: ProjectId): Promise<ModelSettings | undefined> {
    const row = await this.prisma.db().projectModelSettings.findFirst({ where: { projectId, project: { tenantId } } });
    return row ? toAggregate(row, tenantId) : undefined;
  }

  async delete(tenantId: TenantId, projectId: ProjectId): Promise<void> {
    await this.prisma.db().projectModelSettings.deleteMany({ where: { projectId, project: { tenantId } } });
  }
}
