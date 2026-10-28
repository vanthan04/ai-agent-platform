"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { Project } from "@/lib/api/types";
import { formatDateTime } from "@/lib/status";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useAction(async () => {
    const project = await api<Project>("POST", "/projects", { body: { name, ...(description.trim() ? { description } : {}) } });
    onClose();
    router.push(`/projects/${project.id}/execution`);
  });

  return (
    <Dialog open={open} onClose={onClose} title="New project">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create.run();
        }}
      >
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} autoFocus hint="Shown in the project list. Must be unique." />
        <TextArea label="Description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} hint="Optional." />
        <InlineError>{create.error}</InlineError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.pending} disabled={name.trim() === ""}>
            Create project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectsView() {
  const projects = useQuery("projects", (signal) => api<Project[]>("GET", "/projects", { signal }));
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-muted">Each project has its own repositories, policy, tools, tasks and runs.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" />
          New project
        </Button>
      </div>

      {projects.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : projects.error !== undefined && projects.data === undefined ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refresh()} title="Could not load your projects" />
      ) : projects.data && projects.data.length === 0 ? (
        <EmptyState
          title="No projects yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first project
            </Button>
          }
        >
          A project holds the repositories an agent may work on, the rules it must follow, and the history of its runs.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data?.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}/execution`} className="block h-full">
                <Card className="flex h-full flex-col gap-3 p-5 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-3">
                    <span aria-hidden className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-strong">
                      <FolderKanban className="size-5" />
                    </span>
                    <Badge tone={project.role === "DEV" ? "neutral" : "info"} title="Your role in this project">
                      {project.role}
                    </Badge>
                  </div>
                  <h2 className="text-lg font-semibold break-words">{project.name}</h2>
                  {project.description ? <p className="line-clamp-2 text-sm text-muted">{project.description}</p> : null}
                  <p className="mt-auto text-xs text-muted">Created {formatDateTime(project.createdAt)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
