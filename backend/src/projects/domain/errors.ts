import { DomainError } from "../../shared-kernel";

/** Every broken rule of the projects context; the interface layer catches this one base class. */
export abstract class ProjectError extends DomainError {}

export class ProjectNotFoundError extends ProjectError {
  readonly code = "project_not_found";
  constructor() {
    super("project not found");
  }
}

export class DuplicateProjectNameError extends ProjectError {
  readonly code = "duplicate_project_name";
  constructor() {
    super("a project with this name already exists");
  }
}

export class InsufficientRoleError extends ProjectError {
  readonly code = "insufficient_role";
  constructor() {
    super("only a PM or PL can change a project");
  }
}

export class MemberAlreadyExistsError extends ProjectError {
  readonly code = "member_already_exists";
  constructor() {
    super("this user is already a member of the project");
  }
}

export class MemberNotFoundError extends ProjectError {
  readonly code = "member_not_found";
  constructor() {
    super("member not found");
  }
}

export class RepositoryAlreadyMappedError extends ProjectError {
  readonly code = "repository_already_mapped";
  constructor() {
    super("this repository is already connected to the project");
  }
}

export class RepositoryMappingNotFoundError extends ProjectError {
  readonly code = "repository_mapping_not_found";
  constructor() {
    super("repository not found in this project");
  }
}

export class TooManyRepositoriesError extends ProjectError {
  readonly code = "too_many_repositories";
  constructor(limit: number) {
    super(`a project can have at most ${limit} repositories`);
  }
}

export class DefaultBranchNotAllowedError extends ProjectError {
  readonly code = "default_branch_not_allowed";
  constructor() {
    super("the default branch must match one of the allowed branches");
  }
}

export class PolicyVersionConflictError extends ProjectError {
  readonly code = "policy_version_conflict";
  constructor() {
    super("the policy was changed by someone else; reload it and try again");
  }
}

export class PolicyUnchangedError extends ProjectError {
  readonly code = "policy_unchanged";
  constructor() {
    super("nothing changed in the policy");
  }
}

export class LastLeadError extends ProjectError {
  readonly code = "last_lead";
  constructor() {
    super("a project must keep at least one PL");
  }
}
