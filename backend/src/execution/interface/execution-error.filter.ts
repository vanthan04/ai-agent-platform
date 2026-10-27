import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ExecutionError } from "../domain";

const STATUS: Readonly<Record<string, number>> = {
  execution_project_not_found: 404,
  task_not_found: 404,
  run_not_found: 404,
  execution_forbidden: 403,
  task_has_active_run: 409,
  idempotency_key_reused: 409,
  run_not_cancellable: 409,
  run_state_conflict: 409,
  repository_not_in_project: 422,
  branch_not_allowed: 422,
};

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Turns a broken rule of tasks and runs into a response. A rule with no entry here is a bug and answers 500 without detail. */
@Catch(ExecutionError)
export class ExecutionErrorFilter implements ExceptionFilter {
  catch(error: ExecutionError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status = STATUS[error.code];
    if (status === undefined) {
      response.status(500).json({ statusCode: 500, message: "Internal server error" });
      return;
    }
    response.status(status).json({ statusCode: status, message: error.message });
  }
}
