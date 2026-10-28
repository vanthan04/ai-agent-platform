import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { SecretStorageNotConfiguredError } from "../../vault";
import { AgentError } from "../domain";

const STATUS: Readonly<Record<string, number>> = {
  agent_project_not_found: 404,
  agent_forbidden: 403,
  invalid_model_settings: 400,
  secret_storage_not_configured: 503,
};

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Turns a broken rule of this context, or a missing encryption key, into a response. Anything without an entry answers 500 without detail. */
@Catch(AgentError, SecretStorageNotConfiguredError)
export class AgentErrorFilter implements ExceptionFilter {
  catch(error: AgentError | SecretStorageNotConfiguredError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status = STATUS[error.code];
    if (status === undefined) {
      response.status(500).json({ statusCode: 500, message: "Internal server error" });
      return;
    }
    response.status(status).json({ statusCode: status, message: error.message });
  }
}
