"use client";

import { useState } from "react";
import { GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { RepoProvider, RepositoryMapping } from "@/lib/api/types";
import { lines } from "@/lib/text";
import { MANAGER_ONLY, useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const PROVIDERS: { value: RepoProvider; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "codecommit", label: "AWS CodeCommit" },
];

const BRANCH_HINT = "One branch or pattern per line, for example develop or feat/*.";

/** Adds a repository (no `repository`) or changes the branches of one. */
function RepositoryDialog({ open, repository, onClose, onSaved }: { open: boolean; repository?: RepositoryMapping; onClose: () => void; onSaved: () => void }) {
  const { project } = useProject();
  const [provider, setProvider] = useState<RepoProvider>(repository?.provider ?? "github");
  const [name, setName] = useState(repository?.name ?? "");
  const [url, setUrl] = useState(repository?.url ?? "");
  const [defaultBranch, setDefaultBranch] = useState(repository?.defaultBranch ?? "develop");
  const [allowed, setAllowed] = useState((repository?.allowedBranches ?? ["develop", "feat/*"]).join("\n"));

  const base = `/projects/${encodeURIComponent(project.id)}/repositories`;
  const save = useAction(async () => {
    const allowedBranches = lines(allowed);
    if (repository) await api<RepositoryMapping>("PATCH", `${base}/${encodeURIComponent(repository.id)}`, { body: { defaultBranch, allowedBranches } });
    else await api<RepositoryMapping>("POST", base, { body: { provider, name, url, defaultBranch, allowedBranches } });
    onSaved();
  });

  return (
    <Dialog open={open} onClose={onClose} title={repository ? `Branches of ${repository.name}` : "Connect a repository"}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run();
        }}
      >
        {repository ? null : (
          <>
            <SelectField label="Provider" value={provider} onChange={(event) => setProvider(event.target.value as RepoProvider)}>
              {PROVIDERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus hint="For example owner/repo." />
            <TextField label="Address" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required hint="An https address without a user name or password." />
          </>
        )}
        <TextField label="Default branch" value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} required />
        <TextArea label="Branches a task may start from" value={allowed} onChange={(event) => setAllowed(event.target.value)} hint={BRANCH_HINT} rows={4} />
        <InlineError>{save.error}</InlineError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.pending} disabled={defaultBranch.trim() === "" || lines(allowed).length === 0 || (!repository && (name.trim() === "" || url.trim() === ""))}>
            {repository ? "Save" : "Connect"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RepositoryRow({ repository, onEdit, onChanged }: { repository: RepositoryMapping; onEdit: () => void; onChanged: () => void }) {
  const { project, canManage } = useProject();
  const remove = useAction(async () => {
    await api<void>("DELETE", `/projects/${encodeURIComponent(project.id)}/repositories/${encodeURIComponent(repository.id)}`);
    onChanged();
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <GitBranch aria-hidden className="size-5 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-all">{repository.name}</p>
          <p className="text-sm break-all text-muted">{repository.url}</p>
        </div>
        <Badge>{repository.provider === "github" ? "GitHub" : "CodeCommit"}</Badge>
        <Button size="sm" disabled={!canManage} title={canManage ? undefined : MANAGER_ONLY} onClick={onEdit} aria-label={`Edit branches of ${repository.name}`}>
          <Pencil aria-hidden className="size-3.5" />
          Branches
        </Button>
        <Button size="sm" variant="danger" disabled={!canManage} title={canManage ? undefined : MANAGER_ONLY} loading={remove.pending} onClick={() => void remove.run()} aria-label={`Disconnect ${repository.name}`}>
          <Trash2 aria-hidden className="size-3.5" />
          Disconnect
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Default</span>
        <Badge tone="info">{repository.defaultBranch}</Badge>
        <span className="ml-2 text-muted">Allowed</span>
        {repository.allowedBranches.map((branch) => (
          <Badge key={branch}>{branch}</Badge>
        ))}
      </div>
      <InlineError>{remove.error}</InlineError>
    </li>
  );
}

export function RepositoriesView() {
  const { project, canManage } = useProject();
  const repositories = useQuery(`repositories:${project.id}`, (signal) => api<RepositoryMapping[]>("GET", `/projects/${encodeURIComponent(project.id)}/repositories`, { signal }));
  const [dialog, setDialog] = useState<{ repository?: RepositoryMapping } | undefined>(undefined);
  const close = (): void => setDialog(undefined);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="repositories-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="repositories-title" className="text-lg font-semibold">
            Repositories
          </h2>
          <p className="text-sm text-muted">A task can only work on a repository connected here, and only from the branches allowed for it.</p>
        </div>
        <Button variant="primary" disabled={!canManage} title={canManage ? undefined : MANAGER_ONLY} onClick={() => setDialog({})}>
          <Plus aria-hidden className="size-4" />
          Connect repository
        </Button>
      </div>
      {repositories.error !== undefined && !repositories.data ? (
        <ErrorState error={repositories.error} onRetry={() => void repositories.refresh()} title="Could not load the repositories" />
      ) : !repositories.data ? (
        <Skeleton className="h-32" />
      ) : repositories.data.length === 0 ? (
        <EmptyState title="No repository connected" action={canManage ? <Button variant="primary" onClick={() => setDialog({})}>Connect repository</Button> : undefined}>
          Connect the repository the agents should work on. Without one, tasks cannot be created.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {repositories.data.map((repository) => (
              <RepositoryRow key={repository.id} repository={repository} onEdit={() => setDialog({ repository })} onChanged={() => void repositories.refresh()} />
            ))}
          </ul>
        </Card>
      )}
      {dialog ? (
        <RepositoryDialog
          key={dialog.repository?.id ?? "new"}
          open
          repository={dialog.repository}
          onClose={close}
          onSaved={() => {
            close();
            void repositories.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
