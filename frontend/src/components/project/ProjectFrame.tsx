"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api, ApiError } from "@/lib/api/client";
import { useQuery } from "@/lib/api/hooks";
import type { Project } from "@/lib/api/types";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { ProjectProvider } from "./ProjectContext";

export function TabNav({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border pb-px">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap", active ? "border-accent-strong text-accent-strong" : "border-transparent text-muted hover:text-text")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The header and tabs of one project, and the project itself for the pages below it. */
export function ProjectFrame({ projectId, children }: { projectId: string; children: ReactNode }) {
  const project = useQuery(`project:${projectId}`, (signal) => api<Project>("GET", `/projects/${encodeURIComponent(projectId)}`, { signal }));

  if (project.loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading project">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (project.error !== undefined && project.data === undefined) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    return missing ? (
      <ErrorState error={project.error} title="Project not found" />
    ) : (
      <ErrorState error={project.error} onRetry={() => void project.refresh()} title="Could not load this project" />
    );
  }
  const loaded = project.data;
  if (!loaded) return null;

  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <ProjectProvider value={{ project: loaded, canManage: loaded.role === "PM" || loaded.role === "PL" }}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-words">{loaded.name}</h1>
          <Badge tone={loaded.role === "DEV" ? "neutral" : "info"} title="Your role in this project">
            {loaded.role}
          </Badge>
        </div>
        {loaded.description ? <p className="-mt-3 max-w-3xl text-muted">{loaded.description}</p> : null}
        <TabNav
          label="Project sections"
          tabs={[
            { href: `${base}/execution`, label: "Execution" },
            { href: `${base}/setup`, label: "Setup" },
          ]}
        />
        {children}
      </div>
    </ProjectProvider>
  );
}
