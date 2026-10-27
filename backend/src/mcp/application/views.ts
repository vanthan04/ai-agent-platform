export type McpTestError =
  | "unreachable"
  | "blocked_address"
  | "timeout"
  | "response_too_large"
  | "unauthorized"
  | "bad_status"
  | "invalid_response"
  | "server_error"
  /** The connection has a token but the vault no longer has it (for example a different encryption key). Replace the token. */
  | "token_unavailable";

/**
 * What a test of a connection found. Names and descriptions come from the remote server and are untrusted: they are cut,
 * stripped of control characters and meant to be shown as plain text, never executed or placed in a prompt as instructions.
 */
export type McpTestView =
  | {
      ok: true;
      testedAt: string;
      protocolVersion: string;
      server: { name?: string; version?: string };
      tools: { name: string; description: string }[];
      skippedTools: number;
      truncated: boolean;
    }
  | { ok: false; testedAt: string; error: McpTestError };

/** A connection as the API shows it. The token and the reference to it are never part of a view. */
export interface McpConnectionView {
  id: string;
  name: string;
  url: string;
  auth: "none" | "bearer";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
