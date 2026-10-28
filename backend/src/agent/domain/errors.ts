import { DomainError } from "../../shared-kernel";

/** Every broken rule of the agent context; the interface layer catches this one base class. */
export abstract class AgentError extends DomainError {}

/** The project does not exist or the caller is not a member of it: the same answer for both. */
export class AgentProjectNotFoundError extends AgentError {
  readonly code = "agent_project_not_found";
  constructor() {
    super("project not found");
  }
}

export class AgentForbiddenError extends AgentError {
  readonly code = "agent_forbidden";
  constructor() {
    super("only a PM or PL can change the model of a project");
  }
}

export class InvalidModelSettingsError extends AgentError {
  readonly code = "invalid_model_settings";
}
