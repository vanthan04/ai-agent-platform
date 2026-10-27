import { z } from "zod";
import { TaskId, TenantId, Timestamp, UserId } from "./ids";

export const RepoProvider = z.enum(["github", "codecommit"]);
export type RepoProvider = z.infer<typeof RepoProvider>;

export const RepoRef = z.object({
  provider: RepoProvider,
  name: z.string().min(1),
  url: z.string().min(1),
  baseBranch: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRef>;

export const TaskSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("jira"), issueKey: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/) }),
]);
export type TaskSource = z.infer<typeof TaskSource>;

/** What the run must hand back. `pull_request` is the only kind that publishes code. */
export const OutputKind = z.enum(["report", "diff", "test_report", "pull_request"]);
export type OutputKind = z.infer<typeof OutputKind>;

export const Task = z.object({
  id: TaskId,
  tenantId: TenantId,
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
  source: TaskSource,
  repo: RepoRef,
  inputs: z.record(z.string(), z.string()),
  outputs: z.array(OutputKind).min(1),
  createdBy: UserId,
  createdAt: Timestamp,
});
export type Task = z.infer<typeof Task>;

export function taskPublishes(task: Pick<Task, "outputs">): boolean {
  return task.outputs.includes("pull_request");
}
