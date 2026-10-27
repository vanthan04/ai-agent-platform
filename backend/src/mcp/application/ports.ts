import type { AuthUser } from "../../identity";
import type { Role } from "../../shared-kernel";

export const MCP_CONNECTION_REPOSITORY = Symbol("MCP_CONNECTION_REPOSITORY");
export const PROJECT_ACCESS = Symbol("PROJECT_ACCESS");
export const CLOCK = Symbol("CLOCK");
export const MCP_SERVER_CLIENT = Symbol("MCP_SERVER_CLIENT");
export const TEST_RATE_LIMITER = Symbol("TEST_RATE_LIMITER");

/** Why a call to an MCP server failed, in a word. Nothing the server said is ever passed on. */
export type McpCallFailure =
  | "unreachable"
  | "blocked_address"
  | "timeout"
  | "response_too_large"
  | "unauthorized"
  | "bad_status"
  | "invalid_response"
  | "server_error";

export interface DiscoveredTool {
  name: string;
  description: string;
}

export type McpDiscovery =
  | {
      ok: true;
      protocolVersion: string;
      server: { name?: string; version?: string };
      tools: DiscoveredTool[];
      /** Tools the server listed that had no usable name. */
      skipped: number;
      /** The server had more pages or tools than the limits allow. */
      truncated: boolean;
    }
  | { ok: false; failure: McpCallFailure };

/** Talks to a remote MCP server to learn what it offers. The bearer token, when given, goes to that server and nowhere else. */
export interface McpServerClient {
  discover(target: { url: string; bearerToken?: string }): Promise<McpDiscovery>;
}

export interface RateLimiter {
  /** `true` and counts the attempt, or `false` when the key has used up its allowance. */
  tryAcquire(key: string): boolean;
}

/** Time comes through a port so a test can fix it. */
export interface Clock {
  now(): string;
}

/** What this context needs to know about a project, asked of the projects context instead of read from its tables. */
export interface ProjectAccess {
  /** The caller's role in the project, or `undefined` when the project does not exist or the caller is not a member. */
  roleOf(user: AuthUser, projectId: string): Promise<Role | undefined>;
}
