"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { OutputKind, RepositoryMapping, Task } from "@/lib/api/types";
import { OUTPUT_LABELS } from "@/lib/execution";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { InlineError, Spinner } from "@/components/ui/States";

const OUTPUTS: OutputKind[] = ["report", "diff", "test_report", "pull_request"];

function Form({ projectId, repositories, onCreated, onClose }: { projectId: string; repositories: RepositoryMapping[]; onCreated: (task: Task) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? "");
  const repository = repositories.find((candidate) => candidate.id === repositoryId);
  const [baseBranch, setBaseBranch] = useState(repositories[0]?.defaultBranch ?? "");
  const [outputs, setOutputs] = useState<OutputKind[]>(["report"]);

  const create = useAction(async () => {
    const task = await api<Task>("POST", `/projects/${encodeURIComponent(projectId)}/tasks`, { body: { title, description, repositoryId, baseBranch, outputs } });
    onCreated(task);
  });

  const toggle = (output: OutputKind): void => setOutputs((current) => (current.includes(output) ? current.filter((value) => value !== output) : [...current, output]));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create.run();
      }}
    >
      <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} autoFocus />
      <TextArea label="What should be done" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={20000} hint="The agent treats this as the task; keep secrets out of it." />
      <SelectField
        label="Repository"
        value={repositoryId}
        onChange={(event) => {
          setRepositoryId(event.target.value);
          setBaseBranch(repositories.find((candidate) => candidate.id === event.target.value)?.defaultBranch ?? "");
        }}
      >
        {repositories.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} ({candidate.provider})
          </option>
        ))}
      </SelectField>
      <TextField
        label="Base branch"
        value={baseBranch}
        onChange={(event) => setBaseBranch(event.target.value)}
        required
        hint={repository ? `Allowed in this repository: ${repository.allowedBranches.join(", ")}` : undefined}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What the run should hand back</legend>
        {OUTPUTS.map((output) => (
          <label key={output} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={outputs.includes(output)} onChange={() => toggle(output)} className="size-4 accent-[var(--color-accent-strong)]" />
            {OUTPUT_LABELS[output]}
            {output === "pull_request" ? <span className="text-xs text-muted">needs a PM or PL to approve before anything is published</span> : null}
          </label>
        ))}
      </fieldset>
      <InlineError>{create.error}</InlineError>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.pending} disabled={title.trim() === "" || baseBranch.trim() === "" || outputs.length === 0 || repositoryId === ""}>
          Create task
        </Button>
      </div>
    </form>
  );
}

export function NewTaskDialog({ projectId, open, onClose, onCreated }: { projectId: string; open: boolean; onClose: () => void; onCreated: (task: Task) => void }) {
  // Loaded each time the dialog opens, so a repository connected meanwhile is there.
  const repositories = useQuery(open ? `repositories:${projectId}` : null, (signal) => api<RepositoryMapping[]>("GET", `/projects/${encodeURIComponent(projectId)}/repositories`, { signal }));

  return (
    <Dialog open={open} onClose={onClose} title="New task">
      {repositories.data === undefined ? (
        repositories.error === undefined ? (
          <Spinner label="Loading repositories" />
        ) : (
          <InlineError>The repositories could not be loaded.</InlineError>
        )
      ) : repositories.data.length === 0 ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>A task works on a repository the project has connected, and there is none yet.</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/setup/repositories`} className="font-medium text-accent-strong underline">
            Connect a repository
          </Link>
        </div>
      ) : (
        <Form projectId={projectId} repositories={repositories.data} onClose={onClose} onCreated={onCreated} />
      )}
    </Dialog>
  );
}
