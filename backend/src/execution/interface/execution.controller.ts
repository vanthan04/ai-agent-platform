import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../identity";
import { RunsService } from "../application/runs.service";
import { TasksService } from "../application/tasks.service";
import type { RunEventView, RunView, TaskView } from "../application/views";
import { CorrelationIdHeader, CreateTaskBody, EventsQuery, IdempotencyKeyHeader, ListQuery, TasksQuery, parseInput } from "./execution.dto";

interface Reply {
  status(code: number): unknown;
}

@Controller("projects/:id")
export class ExecutionController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  @Post("tasks")
  createTask(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<TaskView> {
    return this.tasks.create(user, id, parseInput(CreateTaskBody, body));
  }

  @Get("tasks")
  listTasks(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query() query: unknown): Promise<TaskView[]> {
    return this.tasks.list(user, id, parseInput(TasksQuery, query).limit);
  }

  @Get("tasks/:taskId")
  getTask(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("taskId") taskId: string): Promise<TaskView> {
    return this.tasks.get(user, id, taskId);
  }

  /** Queues a run and answers at once. 201 for a new run, 200 when the same `Idempotency-Key` already created it. */
  @Post("tasks/:taskId/runs")
  async startRun(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<RunView> {
    const started = await this.runs.start(user, id, taskId, {
      idempotencyKey: parseInput(IdempotencyKeyHeader, idempotencyKey),
      correlationId: correlationId === undefined ? CorrelationIdHeader.parse(randomUUID()) : parseInput(CorrelationIdHeader, correlationId),
    });
    reply.status(started.created ? 201 : 200);
    return started.run;
  }

  @Get("runs")
  listRuns(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query() query: unknown): Promise<RunView[]> {
    const { limit, taskId, status } = parseInput(ListQuery, query);
    return this.runs.list(user, id, { limit, ...(taskId === undefined ? {} : { taskId }), ...(status === undefined ? {} : { status }) });
  }

  @Get("runs/:runId")
  getRun(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("runId") runId: string): Promise<RunView> {
    return this.runs.get(user, id, runId);
  }

  @Get("runs/:runId/events")
  events(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("runId") runId: string, @Query() query: unknown): Promise<RunEventView[]> {
    const { after, limit } = parseInput(EventsQuery, query);
    return this.runs.events(user, id, runId, after, limit);
  }

  @Post("runs/:runId/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("runId") runId: string): Promise<RunView> {
    return this.runs.cancel(user, id, runId);
  }
}
