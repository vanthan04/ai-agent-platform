import { randomUUID } from "node:crypto";
import { isUniqueViolation, type PrismaClientHolder } from "../../database";
import type { ProjectId, RunId as RunIdType, TaskId, TenantId } from "../../shared-kernel";
import { RunId } from "../../shared-kernel";
import {
  DuplicateRunError,
  Run,
  RunEvent,
  RunStateConflictError,
  TaskHasActiveRunError,
  type RunEventDraft,
  type RunRepository,
  type RunStatus,
} from "../domain";

interface RunRow {
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
}

const iso = (date: Date | null): string | undefined => (date === null ? undefined : date.toISOString());

/** Rebuilt through the schema, so a row with a state or field the code does not know is refused instead of used. */
const toRun = (row: RunRow, tenantId: TenantId): Run =>
  Run.parse({
    id: row.id,
    tenantId,
    projectId: row.projectId,
    taskId: row.taskId,
    attempt: row.attempt,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    requestedBy: row.requestedBy,
    status: row.status,
    publishes: row.publishes,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    failureReason: row.failureReason ?? undefined,
    blockedReason: row.blockedReason ?? undefined,
  });

/** Everything but the type; today every field of an event is text, which is also valid JSON for the column. */
const payloadOf = (draft: RunEventDraft): Record<string, string> => {
  const { type, ...rest } = draft;
  void type;
  return rest;
};

/** Postgres through Prisma. Every query goes through the project's tenant. */
export class PrismaRunRepository implements RunRepository {
  constructor(private readonly prisma: PrismaClientHolder) {}

  nextId(): RunIdType {
    return RunId.parse(randomUUID());
  }

  async create(run: Run, firstEvent: RunEventDraft): Promise<void> {
    const db = this.prisma.db();
    const project = await db.project.findFirst({ where: { id: run.projectId, tenantId: run.tenantId }, select: { id: true } });
    if (!project) throw new Error("project not found in this tenant");
    try {
      await db.$transaction(async (tx) => {
        await tx.run.create({
          data: {
            id: run.id,
            projectId: run.projectId,
            taskId: run.taskId,
            attempt: run.attempt,
            status: run.status,
            publishes: run.publishes,
            idempotencyKey: run.idempotencyKey,
            correlationId: run.correlationId,
            requestedBy: run.requestedBy,
            createdAt: new Date(run.createdAt),
          },
        });
        await tx.runEvent.create({
          data: { runId: run.id, seq: 1, id: randomUUID(), type: firstEvent.type, payload: payloadOf(firstEvent), at: new Date(run.createdAt) },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Which rule was broken? The key first: if its run exists this is a repeat of the same request.
      if (await this.findByIdempotencyKey(run.tenantId, run.projectId as ProjectId, run.idempotencyKey)) throw new DuplicateRunError();
      throw new TaskHasActiveRunError();
    }
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<Run | undefined> {
    const row = await this.prisma.db().run.findFirst({ where: { id, projectId, project: { tenantId } } });
    return row ? toRun(row, tenantId) : undefined;
  }

  async findByIdempotencyKey(tenantId: TenantId, projectId: ProjectId, key: string): Promise<Run | undefined> {
    const row = await this.prisma.db().run.findFirst({ where: { projectId, idempotencyKey: key, project: { tenantId } } });
    return row ? toRun(row, tenantId) : undefined;
  }

  async list(tenantId: TenantId, projectId: ProjectId, filter: { taskId?: string; status?: RunStatus; limit: number }): Promise<Run[]> {
    const rows = await this.prisma.db().run.findMany({
      where: {
        projectId,
        project: { tenantId },
        ...(filter.taskId === undefined ? {} : { taskId: filter.taskId }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
      },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
    });
    return rows.map((row) => toRun(row, tenantId));
  }

  async latestAttempt(tenantId: TenantId, taskId: TaskId): Promise<number> {
    const result = await this.prisma.db().run.aggregate({ _max: { attempt: true }, where: { taskId, project: { tenantId } } });
    return result._max.attempt ?? 0;
  }

  async transition(tenantId: TenantId, projectId: ProjectId, next: Run, expected: RunStatus, event: RunEventDraft, at: string): Promise<void> {
    await this.prisma.db().$transaction(async (tx) => {
      // Compare and set: the row only changes if it is still in the state the caller saw.
      const changed = await tx.run.updateMany({
        where: { id: next.id, projectId, status: expected, project: { tenantId } },
        data: {
          status: next.status,
          startedAt: next.startedAt === undefined ? null : new Date(next.startedAt),
          finishedAt: next.finishedAt === undefined ? null : new Date(next.finishedAt),
          failureReason: next.failureReason ?? null,
          blockedReason: next.blockedReason ?? null,
        },
      });
      if (changed.count !== 1) throw new RunStateConflictError();
      const last = await tx.runEvent.aggregate({ _max: { seq: true }, where: { runId: next.id } });
      await tx.runEvent.create({
        data: { runId: next.id, seq: (last._max.seq ?? 0) + 1, id: randomUUID(), type: event.type, payload: payloadOf(event), at: new Date(at) },
      });
    });
  }

  async events(tenantId: TenantId, projectId: ProjectId, runId: RunIdType, afterSeq: number, limit: number): Promise<RunEvent[]> {
    const rows = await this.prisma.db().runEvent.findMany({
      where: { runId, seq: { gt: afterSeq }, run: { projectId, project: { tenantId } } },
      orderBy: { seq: "asc" },
      take: limit,
    });
    return rows.map((row) =>
      RunEvent.parse({
        id: row.id,
        tenantId,
        runId: row.runId,
        seq: row.seq,
        at: row.at.toISOString(),
        type: row.type,
        ...(row.payload as Record<string, unknown>),
      }),
    );
  }
}
