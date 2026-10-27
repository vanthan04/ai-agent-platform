import { describe, expect, it } from "vitest";
import {
  DefaultBranchNotAllowedError,
  InsufficientRoleError,
  MAX_REPOSITORIES_PER_PROJECT,
  Project,
  ProjectDescription,
  ProjectName,
  RepositoryAlreadyMappedError,
  RepositoryMappingNotFoundError,
  RepositoryName,
  RepositoryUrl,
  TooManyRepositoriesError,
  type NewRepositoryMapping,
} from "../../../src/projects";
import { BranchName, BranchPattern, ProjectId, RepositoryMappingId, TenantId, UserId } from "../../../src/shared-kernel";
import { NOW } from "../../support/time";

const alice = UserId.parse("alice");
const bob = UserId.parse("bob");

const newProject = (): Project => {
  const project = Project.create({
    id: ProjectId.parse("project-1"),
    tenantId: TenantId.parse("tenant-1"),
    name: ProjectName.parse("Shop"),
    description: ProjectDescription.parse(""),
    creator: alice,
    now: NOW,
  });
  project.addMember(alice, bob, "DEV", NOW);
  return project;
};

let counter = 0;
const mapping = (overrides: { name?: string; provider?: "github" | "codecommit"; defaultBranch?: string; allowed?: string[] } = {}): NewRepositoryMapping => ({
  id: RepositoryMappingId.parse(`mapping-${++counter}`),
  provider: overrides.provider ?? "github",
  name: RepositoryName.parse(overrides.name ?? "org/shop"),
  url: RepositoryUrl.parse("https://github.com/org/shop.git"),
  defaultBranch: BranchName.parse(overrides.defaultBranch ?? "develop"),
  allowedBranches: (overrides.allowed ?? ["develop", "release/*"]).map((pattern) => BranchPattern.parse(pattern)),
});

describe("repository address and branch value objects", () => {
  it("accepts https, ssh and scp-style addresses and refuses anything that carries credentials", () => {
    for (const ok of ["https://github.com/org/repo.git", "ssh://git@host.example/v1/repos/x", "git@github.com:org/repo.git"]) {
      expect(RepositoryUrl.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      "https://user:token@github.com/org/repo.git",
      "https://token@github.com/org/repo.git",
      "ssh://git:secret@host.example/x",
      "http://github.com/org/repo.git",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not an address",
      "",
    ]) {
      expect(RepositoryUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts repository names with an owner and refuses path tricks", () => {
    expect(RepositoryName.safeParse("org/repo").success).toBe(true);
    expect(RepositoryName.safeParse("moudouken-backend").success).toBe(true);
    for (const bad of ["../repo", "org/../repo", "org repo", "org//repo", "/repo", ""]) {
      expect(RepositoryName.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts concrete branch names and refuses wildcards and unsafe names", () => {
    for (const ok of ["develop", "feat/ABC-1-thing", "release/1.0"]) expect(BranchName.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["feat/*", "-rf", "a..b", "/x", "x/", "x.lock", "a b", "a//b", ""]) {
      expect(BranchName.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts branch patterns but never one that matches everything", () => {
    for (const ok of ["develop", "release/*", "feat/*-hotfix"]) expect(BranchPattern.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["*", "**", "*/*", "-x*", "a b*"]) expect(BranchPattern.safeParse(bad).success, bad).toBe(false);
  });
});

describe("repository mappings of a Project", () => {
  it("lets a PL connect a repository and shows it in the project", () => {
    const project = newProject();
    const added = project.addRepository(alice, mapping(), NOW);
    expect(added).toMatchObject({ provider: "github", name: "org/shop", defaultBranch: "develop", addedAt: NOW });
    expect(project.repositories()).toHaveLength(1);
  });

  it("refuses a DEV and an outsider", () => {
    const project = newProject();
    expect(() => project.addRepository(bob, mapping(), NOW)).toThrow(InsufficientRoleError);
    expect(() => project.addRepository(UserId.parse("stranger"), mapping(), NOW)).toThrow(InsufficientRoleError);
    expect(project.repositories()).toHaveLength(0);
  });

  it("connects a repository once per provider, ignoring case, but the same name on another provider is fine", () => {
    const project = newProject();
    project.addRepository(alice, mapping({ name: "Org/Shop" }), NOW);
    expect(() => project.addRepository(alice, mapping({ name: "org/shop" }), NOW)).toThrow(RepositoryAlreadyMappedError);
    expect(() => project.addRepository(alice, mapping({ name: "org/shop", provider: "codecommit" }), NOW)).not.toThrow();
  });

  it("requires the default branch to be one of the allowed branches", () => {
    const project = newProject();
    expect(() => project.addRepository(alice, mapping({ defaultBranch: "main", allowed: ["develop"] }), NOW)).toThrow(DefaultBranchNotAllowedError);
    expect(() => project.addRepository(alice, mapping({ defaultBranch: "release/1.2", allowed: ["release/*"] }), NOW)).not.toThrow();
  });

  it("keeps each allowed pattern once", () => {
    const project = newProject();
    const added = project.addRepository(alice, mapping({ allowed: ["develop", "develop", "release/*"] }), NOW);
    expect(added.allowedBranches).toEqual(["develop", "release/*"]);
  });

  it("answers which branches a run may start from", () => {
    const project = newProject();
    const { id } = project.addRepository(alice, mapping({ allowed: ["develop", "release/*"] }), NOW);
    expect(project.isBranchAllowed(id, "develop")).toBe(true);
    expect(project.isBranchAllowed(id, "release/2.0/x")).toBe(true);
    expect(project.isBranchAllowed(id, "refs/heads/develop")).toBe(true);
    expect(project.isBranchAllowed(id, "main")).toBe(false);
    expect(project.isBranchAllowed(RepositoryMappingId.parse("unknown"), "develop")).toBe(false);
  });

  it("changes branches while keeping the default branch allowed", () => {
    const project = newProject();
    const { id } = project.addRepository(alice, mapping(), NOW);
    expect(project.changeRepositoryBranches(alice, id, { allowedBranches: [BranchPattern.parse("develop"), BranchPattern.parse("staging")] }, NOW).allowedBranches).toEqual([
      "develop",
      "staging",
    ]);
    expect(() => project.changeRepositoryBranches(alice, id, { allowedBranches: [BranchPattern.parse("staging")] }, NOW)).toThrow(DefaultBranchNotAllowedError);
    expect(project.changeRepositoryBranches(alice, id, { defaultBranch: BranchName.parse("staging"), allowedBranches: [BranchPattern.parse("staging")] }, NOW)).toMatchObject({
      defaultBranch: "staging",
    });
    expect(() => project.changeRepositoryBranches(bob, id, { defaultBranch: BranchName.parse("staging") }, NOW)).toThrow(InsufficientRoleError);
    expect(() => project.changeRepositoryBranches(alice, RepositoryMappingId.parse("unknown"), {}, NOW)).toThrow(RepositoryMappingNotFoundError);
  });

  it("removes a repository and refuses an unknown one", () => {
    const project = newProject();
    const { id } = project.addRepository(alice, mapping(), NOW);
    expect(() => project.removeRepository(bob, id, NOW)).toThrow(InsufficientRoleError);
    project.removeRepository(alice, id, NOW);
    expect(project.repositories()).toEqual([]);
    expect(() => project.removeRepository(alice, id, NOW)).toThrow(RepositoryMappingNotFoundError);
  });

  it("limits how many repositories one project connects", () => {
    const project = newProject();
    for (let i = 0; i < MAX_REPOSITORIES_PER_PROJECT; i++) project.addRepository(alice, mapping({ name: `org/repo-${i}` }), NOW);
    expect(() => project.addRepository(alice, mapping({ name: "org/one-too-many" }), NOW)).toThrow(TooManyRepositoriesError);
  });

  it("is rebuilt with its repositories without sharing state", () => {
    const project = newProject();
    project.addRepository(alice, mapping(), NOW);
    const copy = Project.restore(project.toProps());
    copy.addRepository(alice, mapping({ name: "org/other" }), NOW);
    expect(project.repositories()).toHaveLength(1);
    expect(copy.repositories()).toHaveLength(2);
  });
});
