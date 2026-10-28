import type { Run, RunStatus } from "./api/types";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "violet";

/** States a run is in while someone or something is still working on it. Matches `isActive` in the backend. */
const ACTIVE: readonly RunStatus[] = ["queued", "preparing", "analyzing", "planning", "implementing", "verifying", "awaiting_approval", "publishing"];

export const isActiveRun = (status: RunStatus): boolean => ACTIVE.includes(status);

export const RUN_STATUS: Readonly<Record<RunStatus, { label: string; tone: Tone }>> = {
  queued: { label: "Queued", tone: "info" },
  preparing: { label: "Preparing", tone: "info" },
  analyzing: { label: "Analyzing", tone: "violet" },
  planning: { label: "Planning", tone: "violet" },
  implementing: { label: "Implementing", tone: "violet" },
  verifying: { label: "Verifying", tone: "violet" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  publishing: { label: "Publishing", tone: "violet" },
  succeeded: { label: "Succeeded", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  blocked: { label: "Blocked", tone: "warn" },
};

export type TaskStatus = "ready" | "in_progress" | "blocked" | "failed" | "succeeded";

export const TASK_STATUS: Readonly<Record<TaskStatus, { label: string; tone: Tone }>> = {
  ready: { label: "Ready", tone: "ok" },
  in_progress: { label: "In progress", tone: "info" },
  blocked: { label: "Blocked", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  succeeded: { label: "Succeeded", tone: "ok" },
};

/** Where a task stands, from its newest run (highest attempt). A task with no run, or whose last run was cancelled, is ready to start. */
export function taskStatus(runs: readonly Pick<Run, "attempt" | "status">[]): TaskStatus {
  const latest = [...runs].sort((a, b) => b.attempt - a.attempt)[0];
  if (!latest) return "ready";
  if (isActiveRun(latest.status)) return "in_progress";
  switch (latest.status) {
    case "blocked":
      return "blocked";
    case "failed":
    case "rejected":
      return "failed";
    case "succeeded":
      return "succeeded";
    default:
      return "ready";
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
