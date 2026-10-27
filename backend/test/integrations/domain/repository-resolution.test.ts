import { describe, expect, it } from "vitest";
import { RepositoryResolution, ResolutionSource } from "../../../src/integrations";
import { NOW } from "../../support/time";

const resolution = {
  tenantId: "tenant-1",
  projectId: "project-1",
  runId: "run-1",
  repo: { provider: "github", name: "org/repo", url: "https://example.invalid/org/repo.git", baseBranch: "develop" },
  source: "project_mapping",
  baseCommitSha: "1".repeat(40),
  resolvedAt: NOW,
};

describe("RepositoryResolution", () => {
  it("accepts a SHA-1 and a SHA-256 commit id", () => {
    expect(RepositoryResolution.safeParse(resolution).success).toBe(true);
    expect(RepositoryResolution.safeParse({ ...resolution, baseCommitSha: "f".repeat(64) }).success).toBe(true);
  });

  it("rejects an abbreviated, upper-case or wrong-length commit id", () => {
    for (const baseCommitSha of ["abc1234", "A".repeat(40), "1".repeat(41), ""]) {
      expect(RepositoryResolution.safeParse({ ...resolution, baseCommitSha }).success).toBe(false);
    }
  });

  it("knows only three sources, none of them chosen by the model", () => {
    expect(ResolutionSource.options).toEqual(["user_selected", "project_mapping", "trusted_metadata"]);
    for (const source of ["model", "llm", "inferred_from_task"]) {
      expect(RepositoryResolution.safeParse({ ...resolution, source }).success).toBe(false);
    }
  });

  it("belongs to a project and a run", () => {
    expect(RepositoryResolution.safeParse({ ...resolution, projectId: undefined }).success).toBe(false);
    expect(RepositoryResolution.safeParse({ ...resolution, runId: undefined }).success).toBe(false);
  });
});
