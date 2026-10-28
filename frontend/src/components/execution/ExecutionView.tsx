"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "@/lib/api/client";
import { useQuery } from "@/lib/api/hooks";
import type { OutputKind, Run, Task } from "@/lib/api/types";
import { NO_FILTERS, OUTPUT_LABELS, applyFilters, countByStatus, groupRuns, type Filters } from "@/lib/execution";
import { TASK_STATUS, isActiveRun, type TaskStatus } from "@/lib/status";
import { useProject } from "@/components/project/ProjectContext";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { MetricCards } from "./MetricCards";
import { NewTaskDialog } from "./NewTaskDialog";
import { TaskRow } from "./TaskRow";

const SELECT = "h-10 rounded-lg border border-border bg-surface px-3 text-sm";

export function ExecutionView() {
  const { project } = useProject();
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const tasks = useQuery(`tasks:${project.id}`, (signal) => api<Task[]>("GET", `${base}/tasks?limit=100`, { signal }));
  // Runs keep refreshing while any of them is still in progress, so the status of a task follows its run.
  const runs = useQuery(`runs:${project.id}`, (signal) => api<Run[]>("GET", `${base}/runs?limit=100`, { signal }), (data) =>
    data?.some((run) => isActiveRun(run.status)) ? 2000 : false,
  );
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [creating, setCreating] = useState(false);

  const items = useMemo(() => (tasks.data && runs.data ? groupRuns(tasks.data, runs.data) : undefined), [tasks.data, runs.data]);
  const visible = useMemo(() => (items ? applyFilters(items, filters) : []), [items, filters]);
  const counts = useMemo(() => countByStatus(items ?? []), [items]);

  const reload = (): void => {
    void tasks.refresh();
    void runs.refresh();
  };
  const set = (patch: Partial<Filters>): void => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="flex flex-col gap-6">
      <MetricCards counts={counts} selected={filters.status} onSelect={(status) => set({ status })} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" aria-label="Search tasks" placeholder="Search tasks…" value={filters.search} onChange={(event) => set({ search: event.target.value })} className={`${SELECT} w-full pl-9`} />
        </div>
        <select aria-label="Filter by status" value={filters.status} onChange={(event) => set({ status: event.target.value as TaskStatus | "all" })} className={SELECT}>
          <option value="all">All status</option>
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS[status].label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by output" value={filters.type} onChange={(event) => set({ type: event.target.value as OutputKind | "all" })} className={SELECT}>
          <option value="all">All outputs</option>
          {(Object.keys(OUTPUT_LABELS) as OutputKind[]).map((output) => (
            <option key={output} value={output}>
              {OUTPUT_LABELS[output]}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" />
          New task
        </Button>
      </div>

      {tasks.error !== undefined && !tasks.data ? (
        <ErrorState error={tasks.error} onRetry={reload} title="Could not load the tasks" />
      ) : runs.error !== undefined && !runs.data ? (
        <ErrorState error={runs.error} onRetry={reload} title="Could not load the runs" />
      ) : !items ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No tasks yet" action={<Button variant="primary" onClick={() => setCreating(true)}>New task</Button>}>
          A task says what to do in one of the project&apos;s repositories. Create one, then start a run.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="No task matches" action={<Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}>
          Change the search or the filters to see more.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Tasks">
          {visible.map((item) => (
            <TaskRow key={item.task.id} projectId={project.id} item={item} onChanged={reload} />
          ))}
        </ul>
      )}

      <NewTaskDialog
        projectId={project.id}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
    </div>
  );
}
