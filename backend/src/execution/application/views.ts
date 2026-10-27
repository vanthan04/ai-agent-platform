import type { RepoProvider, Role } from "../../shared-kernel";
import type { RunStatus } from "../domain";

export interface TaskView {
  id: string;
  title: string;
  description: string;
  source: { type: "manual" } | { type: "jira"; issueKey: string };
  repositoryId: string;
  repo: { provider: RepoProvider; name: string; url: string; baseBranch: string };
  inputs: Record<string, string>;
  outputs: string[];
  createdBy: string;
  createdAt: string;
}

export interface RunView {
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
}

/** `created` is false when the same idempotency key had already created this run. */
export interface StartedRun {
  run: RunView;
  created: boolean;
}

export type RunEventView =
  | { seq: number; at: string; type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
  | { seq: number; at: string; type: "run.status_changed"; from: RunStatus; to: RunStatus }
  | { seq: number; at: string; type: string };

export type { Role };
