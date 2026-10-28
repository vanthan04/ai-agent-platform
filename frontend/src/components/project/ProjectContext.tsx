"use client";

import { createContext, useContext } from "react";
import type { Project } from "@/lib/api/types";

interface ProjectContextValue {
  project: Project;
  /** Only a PM or PL change a project's settings (D10, D12); the server decides, this only decides what to enable. */
  canManage: boolean;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export const ProjectProvider = ProjectContext.Provider;

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used inside a project page");
  return value;
}

export const MANAGER_ONLY = "Only a PM or PL of this project can change this.";
