"use client";

import { useId, useState } from "react";
import { ChevronRight, Play, Square } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction } from "@/lib/api/hooks";
import type { Run } from "@/lib/api/types";
import { OUTPUT_LABELS, type TaskWithRuns } from "@/lib/execution";
import { RUN_STATUS, TASK_STATUS, formatDateTime, isActiveRun } from "@/lib/status";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { InlineError } from "@/components/ui/States";
import { RunLog } from "./RunLog";

function Attempt({ projectId, run, onChanged }: { projectId: string; run: Run; onChanged: () => void }) {
  const cancel = useAction(async () => {
    await api<Run>("POST", `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.id)}/cancel`);
    onChanged();
  });
  const status = RUN_STATUS[run.status];
  const reason = run.blockedReason ?? run.failureReason;
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Attempt {run.attempt}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="text-muted">{formatDateTime(run.createdAt)}</span>
        {isActiveRun(run.status) && run.status !== "publishing" ? (
          <Button size="sm" variant="danger" className="ml-auto" loading={cancel.pending} onClick={() => void cancel.run()}>
            <Square aria-hidden className="size-3.5" />
            Cancel run
          </Button>
        ) : null}
      </div>
      {run.baseCommit ? (
        <p className="text-muted">
          Base commit <code className="font-mono text-text">{run.baseCommit.sha.slice(0, 12)}</code>
        </p>
      ) : null}
      {reason ? <p className="text-muted">{reason}</p> : null}
      <InlineError>{cancel.error}</InlineError>
    </li>
  );
}

/** One task: a summary line that opens into what it is, its attempts and the live log of the newest one. */
export function TaskRow({ projectId, item, onChanged }: { projectId: string; item: TaskWithRuns; onChanged: () => void }) {
  const { task, runs, status } = item;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const latest = runs[0];
  const tone = TASK_STATUS[status];
  const busy = latest !== undefined && isActiveRun(latest.status);

  const start = useAction(async () => {
    await api<Run>("POST", `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}/runs`, { headers: { "Idempotency-Key": crypto.randomUUID() } });
    setOpen(true);
    onChanged();
  });

  return (
    <li className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight aria-hidden className={cn("size-5 shrink-0 text-muted transition-transform", open && "rotate-90")} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{task.title}</span>
            <span className="block truncate text-sm text-muted">
              {task.repo.name} @ {task.repo.baseBranch}
              {runs.length > 0 ? ` · ${runs.length} ${runs.length === 1 ? "attempt" : "attempts"}` : ""}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {task.outputs.map((output) => (
            <Badge key={output}>{OUTPUT_LABELS[output]}</Badge>
          ))}
          <Badge tone={tone.tone}>{tone.label}</Badge>
          <Button size="sm" variant="primary" disabled={busy} loading={start.pending} onClick={() => void start.run()} aria-label={`Start a run for ${task.title}`}>
            <Play aria-hidden className="size-3.5" />
            {runs.length === 0 ? "Start run" : "Run again"}
          </Button>
        </div>
      </div>
      {start.error ? (
        <div className="px-4 pb-3">
          <InlineError>{start.error}</InlineError>
        </div>
      ) : null}
      {open ? (
        <div id={panelId} className="grid gap-6 border-t border-border p-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h4 className="text-sm font-medium">Planning and objectives</h4>
            <p className="text-sm whitespace-pre-wrap">{task.description === "" ? <span className="text-muted">No description.</span> : task.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Repository</dt>
              <dd className="break-all">{task.repo.url}</dd>
              <dt className="text-muted">Base branch</dt>
              <dd>{task.repo.baseBranch}</dd>
              <dt className="text-muted">Created</dt>
              <dd>{formatDateTime(task.createdAt)}</dd>
              {task.source.type === "jira" ? (
                <>
                  <dt className="text-muted">Jira</dt>
                  <dd>{task.source.issueKey}</dd>
                </>
              ) : null}
            </dl>
            <h4 className="mt-2 text-sm font-medium">Execution progress</h4>
            {runs.length === 0 ? (
              <p className="text-sm text-muted">No run yet. Start one to see its progress here.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {runs.map((run) => (
                  <Attempt key={run.id} projectId={projectId} run={run} onChanged={onChanged} />
                ))}
              </ul>
            )}
          </section>
          <section>{latest ? <RunLog key={latest.id} projectId={projectId} runId={latest.id} active={isActiveRun(latest.status)} /> : <p className="text-sm text-muted">Logs appear when a run starts.</p>}</section>
        </div>
      ) : null}
    </li>
  );
}
