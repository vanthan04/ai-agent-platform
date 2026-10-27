import { DomainError } from "../../shared-kernel";

/** Every broken rule of the mcp context; the interface layer catches this one base class. */
export abstract class McpError extends DomainError {}

/** The project does not exist or the caller is not a member of it: the same answer for both. */
export class McpProjectNotFoundError extends McpError {
  readonly code = "mcp_project_not_found";
  constructor() {
    super("project not found");
  }
}

export class McpForbiddenError extends McpError {
  readonly code = "mcp_forbidden";
  constructor() {
    super("only a PM or PL can change the MCP connections of a project");
  }
}

export class McpConnectionNotFoundError extends McpError {
  readonly code = "mcp_connection_not_found";
  constructor() {
    super("MCP connection not found");
  }
}

export class DuplicateMcpConnectionError extends McpError {
  readonly code = "duplicate_mcp_connection";
  constructor() {
    super("a connection with this name already exists in the project");
  }
}

export class McpRateLimitedError extends McpError {
  readonly code = "mcp_rate_limited";
  constructor() {
    super("too many connection tests for this project; try again in a minute");
  }
}

export class TooManyMcpConnectionsError extends McpError {
  readonly code = "too_many_mcp_connections";
  constructor(limit: number) {
    super(`a project can have at most ${limit} MCP connections`);
  }
}
