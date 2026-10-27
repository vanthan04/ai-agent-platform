import { isUniqueViolation, type PrismaClientHolder } from "../../database";
import { ResolutionSource } from "../../integrations";
import type { ProjectId, RunId, TenantId } from "../../shared-kernel";
import type { ResolutionRepository, RunBaseCommit } from "../domain";

/** Postgres through Prisma. Write once: there is no update. */
export class PrismaResolutionRepository implements ResolutionRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  async save(tenantId: TenantId, projectId: ProjectId, runId: RunId, resolution: RunBaseCommit): Promise<void> {
    const db = this.prisma.db();
    const run = await db.run.findFirst({ where: { id: runId, projectId, project: { tenantId } }, select: { id: true } });
    if (!run) throw new Error("run not found in this project");
    try {
      await db.runResolution.create({
        data: { runId, source: resolution.source, baseCommitSha: resolution.baseCommitSha, resolvedAt: new Date(resolution.resolvedAt) },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("this run already has a resolution");
      throw error;
    }
  }

  async find(tenantId: TenantId, projectId: ProjectId, runId: RunId): Promise<RunBaseCommit | undefined> {
    const row = await this.prisma.db().runResolution.findFirst({ where: { runId, run: { projectId, project: { tenantId } } } });
    if (!row) return undefined;
    return { source: ResolutionSource.parse(row.source), baseCommitSha: row.baseCommitSha, resolvedAt: row.resolvedAt.toISOString() };
  }
}
