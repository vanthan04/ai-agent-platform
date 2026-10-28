import type { OutputKind, Run, Task } from "./api/types";
import { taskStatus, type TaskStatus } from "./status";

export interface TaskWithRuns {
  task: Task;
  /** Newest attempt first. */
  runs: Run[];
  status: TaskStatus;
}

export interface Filters {
  search: string;
  status: TaskStatus | "all";
  type: OutputKind | "all";
}

export const NO_FILTERS: Filters = { search: "", status: "all", type: "all" };

/** Puts each run with its task. Runs of a task that is not in the list are left out. */
export function groupRuns(tasks: readonly Task[], runs: readonly Run[]): TaskWithRuns[] {
  const byTask = new Map<string, Run[]>();
  for (const run of runs) byTask.set(run.taskId, [...(byTask.get(run.taskId) ?? []), run]);
  return tasks.map((task) => {
    const taskRuns = (byTask.get(task.id) ?? []).sort((a, b) => b.attempt - a.attempt);
    return { task, runs: taskRuns, status: taskStatus(taskRuns) };
  });
}

export function applyFilters(items: readonly TaskWithRuns[], filters: Filters): TaskWithRuns[] {
  const needle = filters.search.trim().toLowerCase();
  return items.filter(({ task, status }) => {
    if (filters.status !== "all" && status !== filters.status) return false;
    if (filters.type !== "all" && !task.outputs.includes(filters.type)) return false;
    if (needle === "") return true;
    return [task.title, task.description, task.repo.name, task.repo.baseBranch].some((text) => text.toLowerCase().includes(needle));
  });
}

export function countByStatus(items: readonly TaskWithRuns[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { ready: 0, in_progress: 0, blocked: 0, failed: 0, succeeded: 0 };
  for (const item of items) counts[item.status]++;
  return counts;
}

export const OUTPUT_LABELS: Readonly<Record<OutputKind, string>> = {
  report: "Report",
  diff: "Diff",
  test_report: "Test report",
  pull_request: "Pull request",
};
