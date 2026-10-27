import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/identity";
import { BASELINE_PROTECTED_BRANCHES, DEFAULT_EDITABLE_POLICY, EditablePolicy } from "../../../src/policy";
import {
  InsufficientRoleError,
  PolicyComment,
  PolicyUnchangedError,
  PolicyVersionConflictError,
  ProjectName,
  ProjectNotFoundError,
  ProjectPolicyService,
  ProjectsService,
} from "../../../src/projects";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryProjectPolicyRepository } from "../../support/in-memory-project-policy.repository";
import { InMemoryProjectRepository } from "../../support/in-memory-project.repository";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const bob = user("bob");
const policy = (overrides: Record<string, unknown> = {}) => EditablePolicy.parse({ ...DEFAULT_EDITABLE_POLICY, ...overrides });

describe("ProjectPolicyService", () => {
  let projects: ProjectsService;
  let service: ProjectPolicyService;
  let projectId: string;

  beforeEach(async () => {
    const repo = new InMemoryProjectRepository();
    const clock = { now: () => NOW };
    projects = new ProjectsService(repo, clock);
    service = new ProjectPolicyService(repo, new InMemoryProjectPolicyRepository(), clock);
    projectId = (await projects.create(alice, { name: ProjectName.parse("Shop") })).id;
  });

  it("shows the default policy as version 0 with the baseline next to it", async () => {
    const view = await service.current(alice, projectId);
    expect(view).toMatchObject({ version: 0, policy: DEFAULT_EDITABLE_POLICY });
    expect(view).not.toHaveProperty("changedBy");
    expect(view.effective.protectedBranches).toEqual([...BASELINE_PROTECTED_BRANCHES]);
    expect(view.baseline.rules.length).toBeGreaterThan(0);
    expect(await service.versions(alice, projectId)).toEqual([]);
  });

  it("saves a new version for a PL with who, when and why, and merges it with the baseline", async () => {
    const saved = await service.update(alice, projectId, {
      expectedVersion: 0,
      policy: policy({ allowedExecutables: ["node", "pnpm"], extraProtectedBranches: ["hotfix/*"] }),
      comment: PolicyComment.parse("let CI tools run"),
    });
    expect(saved).toMatchObject({ version: 1, changedBy: "alice", changedAt: NOW, comment: "let CI tools run" });
    expect(saved.effective.allowedExecutables).toEqual(["node", "pnpm"]);
    expect(saved.effective.protectedBranches).toEqual([...BASELINE_PROTECTED_BRANCHES, "hotfix/*"]);
    expect(await service.current(alice, projectId)).toMatchObject({ version: 1, policy: { allowedExecutables: ["node", "pnpm"] } });
  });

  it("keeps every version, newest first", async () => {
    await service.update(alice, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) });
    await service.update(alice, projectId, { expectedVersion: 1, policy: policy({ allowedExecutables: ["node", "pnpm"] }) });
    const versions = await service.versions(alice, projectId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1]?.policy.allowedExecutables).toEqual(["node"]);
    expect(versions.every((v) => v.changedBy === "alice")).toBe(true);
  });

  it("lets a DEV read the policy and its history but not change it", async () => {
    await projects.addMember(alice, projectId, { userId: bob.userId, role: "DEV" });
    await service.update(alice, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) });
    expect((await service.current(bob, projectId)).version).toBe(1);
    expect(await service.versions(bob, projectId)).toHaveLength(1);
    await expect(service.update(bob, projectId, { expectedVersion: 1, policy: policy({ allowedExecutables: ["pnpm"] }) })).rejects.toBeInstanceOf(InsufficientRoleError);
    expect((await service.current(alice, projectId)).version).toBe(1);
  });

  it("lets a PM change it", async () => {
    await projects.addMember(alice, projectId, { userId: bob.userId, role: "PM" });
    expect(await service.update(bob, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) })).toMatchObject({ version: 1, changedBy: "bob" });
  });

  it("hides the policy of a project from non-members and from other tenants", async () => {
    await expect(service.current(bob, projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.versions(bob, projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.update(bob, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.current(user("alice", "tenant-2"), projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("refuses a stale edit and an edit that changes nothing, leaving the history untouched", async () => {
    await service.update(alice, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) });
    await expect(service.update(alice, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["pnpm"] }) })).rejects.toBeInstanceOf(PolicyVersionConflictError);
    await expect(service.update(alice, projectId, { expectedVersion: 1, policy: policy({ allowedExecutables: ["node"] }) })).rejects.toBeInstanceOf(PolicyUnchangedError);
    expect(await service.versions(alice, projectId)).toHaveLength(1);
  });

  it("keeps the policies of two projects apart", async () => {
    const other = (await projects.create(alice, { name: ProjectName.parse("Other") })).id;
    await service.update(alice, projectId, { expectedVersion: 0, policy: policy({ allowedExecutables: ["node"] }) });
    expect((await service.current(alice, other)).version).toBe(0);
  });
});
