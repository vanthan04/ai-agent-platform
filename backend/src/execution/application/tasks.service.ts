import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import { ProjectId, matchesBranchPattern, type RepositoryMappingId } from "../../shared-kernel";
import {
  BranchNotAllowedError,
  ExecutionProjectNotFoundError,
  RepositoryNotInProjectError,
  Task,
  TaskNotFoundError,
  type OutputKind,
  type TaskRepository,
  type TaskSource,
} from "../domain";
import { CLOCK, PROJECT_CATALOG, TASK_REPOSITORY, type Clock, type ProjectCatalog } from "./ports";
import type { TaskView } from "./views";
export const toTaskView = (task: Task): TaskView => ({
  id: task.id,
  title: task.title,
  description: task.description,
  source: task.source,
  repositoryId: task.repositoryId,
  repo: { provider: task.repo.provider, name: task.repo.name, url: task.repo.url, baseBranch: task.repo.baseBranch },
  inputs: task.inputs,
  outputs: task.outputs,
  createdBy: task.createdBy,
  createdAt: task.createdAt,
});

/** Use cases for tasks: any member of a project describes work, always against a repository the project has connected. */
@Injectable()
export class TasksService {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepository,
    @Inject(PROJECT_CATALOG) private readonly catalog: ProjectCatalog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The repository comes from the person who creates the task and must be one the project connected; the base branch must be
   * one of that connection's allowed branches. Nothing here lets text in the task choose a repository (D14, plan phase 4).
   */
  async create(
    user: AuthUser,
    projectId: string,
    input: {
      title: string;
      description: string;
      source: TaskSource;
      repositoryId: RepositoryMappingId;
      baseBranch: string;
      inputs: Record<string, string>;
      outputs: OutputKind[];
    },
  ): Promise<TaskView> {
    await this.requireMember(user, projectId);
    const repository = await this.catalog.repository(user, projectId, input.repositoryId);
    if (!repository) throw new RepositoryNotInProjectError();
    if (!repository.allowedBranches.some((pattern) => matchesBranchPattern(pattern, input.baseBranch))) throw new BranchNotAllowedError();
    const task = Task.parse({
      id: this.tasks.nextId(),
      tenantId: user.tenantId,
      projectId,
      title: input.title,
      description: input.description,
      source: input.source,
      repositoryId: input.repositoryId,
      repo: { provider: repository.provider, name: repository.name, url: repository.url, baseBranch: input.baseBranch },
      inputs: input.inputs,
      outputs: input.outputs,
      createdBy: user.userId,
      createdAt: this.clock.now(),
    });
    await this.tasks.save(task);
    return toTaskView(task);
  }

  async list(user: AuthUser, projectId: string, limit: number): Promise<TaskView[]> {
    await this.requireMember(user, projectId);
    return (await this.tasks.list(user.tenantId, ProjectId.parse(projectId), limit)).map(toTaskView);
  }

  async get(user: AuthUser, projectId: string, taskId: string): Promise<TaskView> {
    await this.requireMember(user, projectId);
    const task = await this.tasks.findById(user.tenantId, ProjectId.parse(projectId), taskId);
    if (!task) throw new TaskNotFoundError();
    return toTaskView(task);
  }

  private async requireMember(user: AuthUser, projectId: string): Promise<void> {
    if ((await this.catalog.roleOf(user, projectId)) === undefined) throw new ExecutionProjectNotFoundError();
  }
}
