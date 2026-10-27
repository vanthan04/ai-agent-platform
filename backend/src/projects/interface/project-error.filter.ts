import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ProjectError } from "../domain";

const STATUS: Readonly<Record<string, number>> = {
  project_not_found: 404,
  member_not_found: 404,
  repository_mapping_not_found: 404,
  insufficient_role: 403,
  duplicate_project_name: 409,
  member_already_exists: 409,
  last_lead: 409,
  repository_already_mapped: 409,
  too_many_repositories: 409,
  default_branch_not_allowed: 422,
  policy_version_conflict: 409,
  policy_unchanged: 422,
};

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Turns a broken project rule into a response. A rule with no entry here is a bug and answers 500 without detail. */
@Catch(ProjectError)
export class ProjectErrorFilter implements ExceptionFilter {
  catch(error: ProjectError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status = STATUS[error.code];
    if (status === undefined) {
      response.status(500).json({ statusCode: 500, message: "Internal server error" });
      return;
    }
    response.status(status).json({ statusCode: status, message: error.message });
  }
}
