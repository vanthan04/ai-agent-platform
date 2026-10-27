import type { PrismaClientHolder } from "../../database";
import { TenantId } from "../../shared-kernel";
import { Run, type RunQueue, type RunStatus } from "../domain";

interface Row {
  id: string;
  projectId: string;
  taskId: string;
  attempt: number;
  status: string;
  publishes: boolean;
  idempotencyKey: string;
  correlationId: string;
  requestedBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureReason: string | null;
  blockedReason: string | null;
  project: { tenantId: string };
}

/** Rebuilt through the schema, so a row with a state the code does not know is refused instead of used. */
const toRun = (row: Row): Run =>
  Run.parse({
    id: row.id,
    tenantId: TenantId.parse(row.project.tenantId),
    projectId: row.projectId,
    taskId: row.taskId,
    attempt: row.attempt,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    requestedBy: row.requestedBy,
    status: row.status,
    publishes: row.publishes,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    failureReason: row.failureReason ?? undefined,
    blockedReason: row.blockedReason ?? undefined,
  });

/** The worker's view of the Run table, across tenants. Read only. */
export class PrismaRunQueue implements RunQueue {
  constructor(private readonly prisma: PrismaClientHolder) {}

  async listQueued(limit: number): Promise<Run[]> {
    const rows = await this.prisma.db().run.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { project: { select: { tenantId: true } } },
    });
    return rows.map(toRun);
  }

  async listStalled(status: RunStatus, idleSince: string, limit: number): Promise<Run[]> {
    const rows = await this.prisma.db().run.findMany({
      where: { status, events: { none: { at: { gt: new Date(idleSince) } } } },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { project: { select: { tenantId: true } } },
    });
    return rows.map(toRun);
  }
}
