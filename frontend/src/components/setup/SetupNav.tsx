"use client";

import { useProject } from "@/components/project/ProjectContext";
import { TabNav } from "@/components/project/ProjectFrame";

export function SetupNav() {
  const { project, canManage } = useProject();
  const base = `/projects/${encodeURIComponent(project.id)}/setup`;
  return (
    <div className="flex flex-col gap-4">
      <TabNav
        label="Setup sections"
        tabs={[
          { href: `${base}/repositories`, label: "Repositories" },
          { href: `${base}/policy`, label: "Policy" },
          { href: `${base}/mcp`, label: "MCP servers" },
          { href: `${base}/members`, label: "Members" },
        ]}
      />
      {canManage ? null : <p className="text-sm text-muted">You can look at the setup of this project. Only a PM or PL can change it.</p>}
    </div>
  );
}
