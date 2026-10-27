import type { PolicyDecision } from "../domain";

export type ExternalSystem = "jira" | "github" | "codecommit";

/** Everything an agent can ask the platform to do goes through one of these typed actions. */
export type Action =
  | { kind: "read_file"; path: string }
  | { kind: "write_file"; path: string }
  | { kind: "delete_path"; path: string }
  | { kind: "run_command"; executable: string; args: readonly string[] }
  | { kind: "git_push"; branch: string; force: boolean }
  | { kind: "external_write"; system: ExternalSystem; operation: string };

export interface PolicyContext {
  protectedBranches: readonly string[];
  /** Executables the sandbox may run without asking (for example node, pnpm, tsc, vitest). */
  allowedExecutables: readonly string[];
  /** Executables that are never run (deploy and infrastructure tools). */
  forbiddenExecutables: readonly string[];
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}
