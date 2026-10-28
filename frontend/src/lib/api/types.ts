/** What the backend API returns. Kept by hand next to `backend/README.md`; the backend is the authority. */

export type Role = "PM" | "PL" | "DEV";
export type RepoProvider = "github" | "codecommit";
export type OutputKind = "report" | "diff" | "test_report" | "pull_request";

export type RunStatus =
  | "queued"
  | "preparing"
  | "analyzing"
  | "planning"
  | "implementing"
  | "verifying"
  | "awaiting_approval"
  | "publishing"
  | "succeeded"
  | "rejected"
  | "failed"
  | "cancelled"
  | "blocked";

export interface Project {
  id: string;
  name: string;
  description: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  role: Role;
  addedAt: string;
}

export interface RepositoryMapping {
  id: string;
  provider: RepoProvider;
  name: string;
  url: string;
  defaultBranch: string;
  allowedBranches: string[];
  addedAt: string;
}

export interface EditablePolicy {
  allowedExecutables: string[];
  extraForbiddenExecutables: string[];
  extraProtectedBranches: string[];
  mcpToolDecisions: Record<string, "allow" | "ask">;
  limits: { commandTimeoutSeconds: number; maxToolCallsPerRun: number };
}

export interface Baseline {
  protectedBranches: string[];
  forbiddenExecutables: string[];
  neverAllowedExecutables: string[];
  limitCeilings: { commandTimeoutSeconds: number; maxToolCallsPerRun: number };
  rules: { id: string; description: string }[];
}

export interface PolicyView {
  version: number;
  policy: EditablePolicy;
  effective: { protectedBranches: string[]; allowedExecutables: string[]; forbiddenExecutables: string[] };
  baseline: Baseline;
  changedBy?: string;
  changedAt?: string;
  comment?: string;
}

export interface PolicyVersion {
  version: number;
  policy: EditablePolicy;
  changedBy: string;
  changedAt: string;
  comment: string;
}

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  auth: "none" | "bearer";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type McpTestResult =
  | {
      ok: true;
      testedAt: string;
      protocolVersion: string;
      server: { name?: string; version?: string };
      tools: { name: string; description: string }[];
      skippedTools: number;
      truncated: boolean;
    }
  | { ok: false; testedAt: string; error: string };

export interface Task {
  id: string;
  title: string;
  description: string;
  source: { type: "manual" } | { type: "jira"; issueKey: string };
  repositoryId: string;
  repo: { provider: RepoProvider; name: string; url: string; baseBranch: string };
  inputs: Record<string, string>;
  outputs: OutputKind[];
  createdBy: string;
  createdAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  attempt: number;
  status: RunStatus;
  publishes: boolean;
  idempotencyKey: string;
  correlationId: string;
  requestedBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  failureReason?: string;
  blockedReason?: string;
  baseCommit?: { source: string; sha: string; resolvedAt: string };
}

export type RunEvent =
  | { seq: number; at: string; type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { seq: number; at: string; type: "run.status_changed"; from: RunStatus; to: RunStatus }
  | { seq: number; at: string; type: string };
