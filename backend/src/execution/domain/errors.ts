import { DomainError } from "../../shared-kernel";

/** Every broken rule of tasks and runs; the interface layer catches this one base class. */
export abstract class ExecutionError extends DomainError {}

/** The project does not exist or the caller is not a member of it: the same answer for both. */
export class ExecutionProjectNotFoundError extends ExecutionError {
  readonly code = "execution_project_not_found";
  constructor() {
    super("project not found");
  }
}

export class TaskNotFoundError extends ExecutionError {
  readonly code = "task_not_found";
  constructor() {
    super("task not found");
  }
}

export class RunNotFoundError extends ExecutionError {
  readonly code = "run_not_found";
  constructor() {
    super("run not found");
  }
}

export class RepositoryNotInProjectError extends ExecutionError {
  readonly code = "repository_not_in_project";
  constructor() {
    super("this repository is not connected to the project");
  }
}

export class BranchNotAllowedError extends ExecutionError {
  readonly code = "branch_not_allowed";
  constructor() {
    super("the base branch is not one of the allowed branches of this repository");
  }
}

export class TaskHasActiveRunError extends ExecutionError {
  readonly code = "task_has_active_run";
  constructor() {
    super("this task already has a run in progress");
  }
}

export class IdempotencyKeyReusedError extends ExecutionError {
  readonly code = "idempotency_key_reused";
  constructor() {
    super("this idempotency key was already used for a different task");
  }
}

export class RunNotCancellableError extends ExecutionError {
  readonly code = "run_not_cancellable";
  constructor() {
    super("a run in this state cannot be cancelled");
  }
}

export class RunStateConflictError extends ExecutionError {
  readonly code = "run_state_conflict";
  constructor() {
    super("the run changed while you were acting on it; reload it and try again");
  }
}

export class ExecutionForbiddenError extends ExecutionError {
  readonly code = "execution_forbidden";
  constructor() {
    super("you may not do this to this run");
  }
}
