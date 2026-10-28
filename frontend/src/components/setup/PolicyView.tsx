"use client";

import { useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { EditablePolicy, PolicyVersion, PolicyView as PolicyData } from "@/lib/api/types";
import { lines } from "@/lib/text";
import { formatDateTime } from "@/lib/status";
import { MANAGER_ONLY, useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea, TextField } from "@/components/ui/Field";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/States";

type Decision = "allow" | "ask";

interface Draft {
  allowedExecutables: string;
  extraForbiddenExecutables: string;
  extraProtectedBranches: string;
  decisions: [string, Decision][];
  commandTimeoutSeconds: string;
  maxToolCallsPerRun: string;
  comment: string;
}

const toDraft = (policy: EditablePolicy): Draft => ({
  allowedExecutables: policy.allowedExecutables.join("\n"),
  extraForbiddenExecutables: policy.extraForbiddenExecutables.join("\n"),
  extraProtectedBranches: policy.extraProtectedBranches.join("\n"),
  decisions: Object.entries(policy.mcpToolDecisions).sort(([a], [b]) => a.localeCompare(b)),
  commandTimeoutSeconds: String(policy.limits.commandTimeoutSeconds),
  maxToolCallsPerRun: String(policy.limits.maxToolCallsPerRun),
  comment: "",
});

export const fromDraft = (draft: Draft): EditablePolicy => ({
  allowedExecutables: lines(draft.allowedExecutables),
  extraForbiddenExecutables: lines(draft.extraForbiddenExecutables),
  extraProtectedBranches: lines(draft.extraProtectedBranches),
  mcpToolDecisions: Object.fromEntries(draft.decisions.filter(([key]) => key.trim() !== "").map(([key, value]) => [key.trim(), value])),
  limits: { commandTimeoutSeconds: Number(draft.commandTimeoutSeconds), maxToolCallsPerRun: Number(draft.maxToolCallsPerRun) },
});

/** The fixed part of the policy: shown so people see what they cannot change, with no control to change it. */
function Baseline({ data }: { data: PolicyData }) {
  const { baseline } = data;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Lock aria-hidden className="size-4 text-muted" />
        <h3 className="font-medium">Baseline (fixed)</h3>
      </div>
      <p className="text-sm text-muted">These rules apply to every project. Edits below can only add to them.</p>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="mb-1 font-medium">Protected branches</dt>
          <dd className="flex flex-wrap gap-1.5">
            {baseline.protectedBranches.map((branch) => (
              <Badge key={branch}>{branch}</Badge>
            ))}
          </dd>
        </div>
        <div>
          <dt className="mb-1 font-medium">Forbidden programs</dt>
          <dd className="flex flex-wrap gap-1.5">
            {[...baseline.forbiddenExecutables, ...baseline.neverAllowedExecutables].map((name) => (
              <Badge key={name} tone="bad">
                {name}
              </Badge>
            ))}
          </dd>
        </div>
        <div>
          <dt className="mb-1 font-medium">Limit ceilings</dt>
          <dd className="text-muted">
            {baseline.limitCeilings.commandTimeoutSeconds} s per command, {baseline.limitCeilings.maxToolCallsPerRun} tool calls per run
          </dd>
        </div>
      </dl>
      <ul className="flex flex-col gap-1.5 text-sm">
        {baseline.rules.map((rule) => (
          <li key={rule.id} className="text-muted">
            {rule.description}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Editor({ data, onSaved }: { data: PolicyData; onSaved: () => void }) {
  const { project, canManage } = useProject();
  const [draft, setDraft] = useState<Draft>(() => toDraft(data.policy));
  const [stale, setStale] = useState(false);
  const set = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const dirty = useMemo(() => JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(data.policy))), [draft, data.policy]);

  const save = useAction(async () => {
    try {
      await api<PolicyData>("PUT", `/projects/${encodeURIComponent(project.id)}/policy`, {
        body: { expectedVersion: data.version, policy: fromDraft(draft), ...(draft.comment.trim() === "" ? {} : { comment: draft.comment.trim() }) },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setStale(true);
      throw error;
    }
    onSaved();
  });

  const readOnly = !canManage;
  const hint = readOnly ? MANAGER_ONLY : undefined;
  const { limitCeilings } = data.baseline;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
    >
      <Card className="grid gap-5 p-5 lg:grid-cols-2">
        <TextArea label="Programs a run may start without asking" value={draft.allowedExecutables} onChange={(event) => set({ allowedExecutables: event.target.value })} disabled={readOnly} rows={5} hint={hint ?? "One program name per line, for example git or pnpm. Shells are never allowed."} />
        <TextArea label="Extra forbidden programs" value={draft.extraForbiddenExecutables} onChange={(event) => set({ extraForbiddenExecutables: event.target.value })} disabled={readOnly} rows={5} hint={hint ?? "Forbidden in this project on top of the baseline."} />
        <TextArea label="Extra protected branches" value={draft.extraProtectedBranches} onChange={(event) => set({ extraProtectedBranches: event.target.value })} disabled={readOnly} rows={4} hint={hint ?? "Nobody pushes to these in this project, on top of the baseline."} />
        <div className="flex flex-col gap-4">
          <TextField label="Seconds a command may run" type="number" min={1} max={limitCeilings.commandTimeoutSeconds} value={draft.commandTimeoutSeconds} onChange={(event) => set({ commandTimeoutSeconds: event.target.value })} disabled={readOnly} hint={`At most ${limitCeilings.commandTimeoutSeconds}.`} />
          <TextField label="Tool calls a run may make" type="number" min={1} max={limitCeilings.maxToolCallsPerRun} value={draft.maxToolCallsPerRun} onChange={(event) => set({ maxToolCallsPerRun: event.target.value })} disabled={readOnly} hint={`At most ${limitCeilings.maxToolCallsPerRun}.`} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-medium">MCP tools</h3>
        <p className="text-sm text-muted">A tool that is not listed always asks before it runs. Name it as connection:tool.</p>
        {draft.decisions.length === 0 ? <p className="text-sm text-muted">No tool is allowed without asking.</p> : null}
        <ul className="flex flex-col gap-2">
          {draft.decisions.map(([key, decision], index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Tool"
                value={key}
                disabled={readOnly}
                onChange={(event) => set({ decisions: draft.decisions.map((entry, i) => (i === index ? [event.target.value, entry[1]] : entry)) })}
                className="h-9 min-w-48 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-sm disabled:bg-surface-2"
              />
              <select
                aria-label={`Decision for ${key}`}
                value={decision}
                disabled={readOnly}
                onChange={(event) => set({ decisions: draft.decisions.map((entry, i) => (i === index ? [entry[0], event.target.value as Decision] : entry)) })}
                className="h-9 rounded-lg border border-border bg-surface px-2 text-sm disabled:bg-surface-2"
              >
                <option value="allow">Allow without asking</option>
                <option value="ask">Ask first</option>
              </select>
              <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => set({ decisions: draft.decisions.filter((_, i) => i !== index) })} aria-label={`Remove ${key}`}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button size="sm" disabled={readOnly} onClick={() => set({ decisions: [...draft.decisions, ["", "ask"]] })}>
            <Plus aria-hidden className="size-3.5" />
            Add a tool
          </Button>
        </div>
      </Card>

      {stale ? (
        <div role="alert" className="rounded-xl border border-border bg-warn-soft p-4 text-sm">
          Someone saved a newer version first. Load the latest version to see it, then make your change again.
          <div className="mt-2">
            <Button size="sm" onClick={onSaved}>
              Load the latest version
            </Button>
          </div>
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <TextField label="What changed (optional)" value={draft.comment} onChange={(event) => set({ comment: event.target.value })} maxLength={500} />
          </div>
          <Button type="button" onClick={() => setDraft(toDraft(data.policy))} disabled={!dirty}>
            Discard changes
          </Button>
          <Button type="submit" variant="primary" loading={save.pending} disabled={!dirty || stale}>
            Save as version {data.version + 1}
          </Button>
        </div>
      )}
      <InlineError>{save.error}</InlineError>
    </form>
  );
}

function History({ projectId, version }: { projectId: string; version: number }) {
  const versions = useQuery(`policy-versions:${projectId}:${version}`, (signal) => api<PolicyVersion[]>("GET", `/projects/${encodeURIComponent(projectId)}/policy/versions`, { signal }));
  if (!versions.data || versions.data.length === 0) return null;
  return (
    <Card className="p-5">
      <h3 className="mb-3 font-medium">History</h3>
      <ol className="flex flex-col gap-2 text-sm">
        {versions.data.map((entry) => (
          <li key={entry.version} className="flex flex-wrap gap-x-3">
            <span className="font-medium">Version {entry.version}</span>
            <span className="text-muted">
              {formatDateTime(entry.changedAt)} by {entry.changedBy}
            </span>
            {entry.comment ? <span>{entry.comment}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function PolicyView() {
  const { project } = useProject();
  const policy = useQuery(`policy:${project.id}`, (signal) => api<PolicyData>("GET", `/projects/${encodeURIComponent(project.id)}/policy`, { signal }));

  return (
    <section className="flex flex-col gap-5" aria-labelledby="policy-title">
      <div>
        <h2 id="policy-title" className="text-lg font-semibold">
          Policy
        </h2>
        <p className="text-sm text-muted">What a run in this project may do. You can add rules and loosen what is only a default; the baseline cannot be relaxed.</p>
      </div>
      {policy.error !== undefined && !policy.data ? (
        <ErrorState error={policy.error} onRetry={() => void policy.refresh()} title="Could not load the policy" />
      ) : !policy.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Baseline data={policy.data} />
          {/* Keyed by version: loading a newer version resets the editor to it. */}
          <Editor key={policy.data.version} data={policy.data} onSaved={() => void policy.refresh()} />
          <History projectId={project.id} version={policy.data.version} />
        </>
      )}
    </section>
  );
}
