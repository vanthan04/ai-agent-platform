import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/identity";
import {
  DefaultBranchNotAllowedError,
  DuplicateProjectNameError,
  InsufficientRoleError,
  LastLeadError,
  ProjectDescription,
  ProjectName,
  ProjectNotFoundError,
  ProjectsService,
  RepositoryAlreadyMappedError,
  RepositoryMappingNotFoundError,
  RepositoryName,
  RepositoryUrl,
} from "../../../src/projects";
import { BranchName, BranchPattern, TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryProjectRepository } from "../../support/in-memory-project.repository";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const bob = user("bob");
const name = (value: string) => ProjectName.parse(value);

describe("ProjectsService", () => {
  let service: ProjectsService;

  beforeEach(() => {
    service = new ProjectsService(new InMemoryProjectRepository(), { now: () => NOW });
  });

  it("makes the creator the PL and does not expose the tenant", async () => {
    const project = await service.create(alice, { name: name("Shop"), description: ProjectDescription.parse("web shop") });
    expect(project).toMatchObject({ name: "Shop", description: "web shop", role: "PL", createdAt: NOW });
    expect(project).not.toHaveProperty("tenantId");
    expect((await service.create(alice, { name: name("No description") })).description).toBe("");
  });

  it("rejects a duplicate name inside a tenant but allows it in another tenant", async () => {
    await service.create(alice, { name: name("Shop") });
    await expect(service.create(bob, { name: name("Shop") })).rejects.toBeInstanceOf(DuplicateProjectNameError);
    await expect(service.create(user("carol", "tenant-2"), { name: name("Shop") })).resolves.toMatchObject({ name: "Shop" });
  });

  it("lists only the projects the caller is a member of", async () => {
    await service.create(alice, { name: name("A") });
    await service.create(bob, { name: name("B") });
    expect((await service.list(alice)).map((p) => p.name)).toEqual(["A"]);
    expect((await service.list(bob)).map((p) => p.name)).toEqual(["B"]);
  });

  it("treats a project of someone else exactly like a missing one", async () => {
    const mine = await service.create(alice, { name: name("A") });
    await expect(service.get(bob, mine.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.get(bob, "no-such-id")).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.update(bob, mine.id, { name: name("Hijack") })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(service.listMembers(bob, mine.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("does not cross tenants even for the same user id", async () => {
    const mine = await service.create(alice, { name: name("A") });
    const sameUserOtherTenant = user("alice", "tenant-2");
    await expect(service.get(sameUserOtherTenant, mine.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await service.list(sameUserOtherTenant)).toEqual([]);
  });

  it("lets a PL or PM edit and refuses a DEV", async () => {
    const project = await service.create(alice, { name: name("A") });
    await service.addMember(alice, project.id, { userId: bob.userId, role: "DEV" });
    await service.addMember(alice, project.id, { userId: UserId.parse("pm"), role: "PM" });
    await expect(service.update(bob, project.id, { name: name("Renamed") })).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(await service.update(alice, project.id, { name: name("Renamed") })).toMatchObject({ name: "Renamed", role: "PL" });
    expect(await service.update(user("pm"), project.id, { description: ProjectDescription.parse("by pm") })).toMatchObject({
      description: "by pm",
      role: "PM",
    });
    expect(await service.get(bob, project.id)).toMatchObject({ name: "Renamed", role: "DEV" });
  });

  it("refuses to rename onto a name already used in the tenant", async () => {
    await service.create(alice, { name: name("A") });
    const second = await service.create(alice, { name: name("B") });
    await expect(service.update(alice, second.id, { name: name("A") })).rejects.toBeInstanceOf(DuplicateProjectNameError);
  });

  it("manages members through the aggregate and persists every change", async () => {
    const project = await service.create(alice, { name: name("Team") });
    expect(await service.addMember(alice, project.id, { userId: bob.userId, role: "DEV" })).toEqual({ userId: "bob", role: "DEV", addedAt: NOW });
    expect((await service.listMembers(bob, project.id)).map((m) => `${m.userId}:${m.role}`)).toEqual(["alice:PL", "bob:DEV"]);
    expect(await service.changeMemberRole(alice, project.id, bob.userId, "PM")).toMatchObject({ userId: "bob", role: "PM" });
    expect((await service.get(bob, project.id)).role).toBe("PM");
    await service.removeMember(alice, project.id, bob.userId);
    await expect(service.get(bob, project.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("keeps the last PL and refuses a DEV who tries to manage members", async () => {
    const project = await service.create(alice, { name: name("Team") });
    await service.addMember(alice, project.id, { userId: bob.userId, role: "DEV" });
    await expect(service.removeMember(alice, project.id, alice.userId)).rejects.toBeInstanceOf(LastLeadError);
    await expect(service.addMember(bob, project.id, { userId: UserId.parse("eve"), role: "PL" })).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(service.changeMemberRole(bob, project.id, bob.userId, "PL")).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  describe("repositories", () => {
    const shop = {
      provider: "github" as const,
      name: RepositoryName.parse("org/shop"),
      url: RepositoryUrl.parse("https://github.com/org/shop.git"),
      defaultBranch: BranchName.parse("develop"),
      allowedBranches: [BranchPattern.parse("develop"), BranchPattern.parse("release/*")],
    };

    it("connects, lists, changes and removes a repository, saving every change", async () => {
      const project = await service.create(alice, { name: name("Team") });
      const added = await service.addRepository(alice, project.id, shop);
      expect(added).toMatchObject({ provider: "github", name: "org/shop", defaultBranch: "develop", allowedBranches: ["develop", "release/*"], addedAt: NOW });
      await service.addRepository(alice, project.id, { ...shop, provider: "codecommit" });
      expect((await service.listRepositories(alice, project.id)).map((r) => `${r.provider}:${r.name}`)).toEqual(["github:org/shop", "codecommit:org/shop"]);
      const changed = await service.changeRepositoryBranches(alice, project.id, added.id as never, { allowedBranches: [BranchPattern.parse("develop")] });
      expect(changed.allowedBranches).toEqual(["develop"]);
      await service.removeRepository(alice, project.id, added.id as never);
      expect((await service.listRepositories(alice, project.id)).map((r) => r.provider)).toEqual(["codecommit"]);
    });

    it("lets any member see the repositories but only a PM or PL change them", async () => {
      const project = await service.create(alice, { name: name("Team") });
      await service.addMember(alice, project.id, { userId: bob.userId, role: "DEV" });
      const added = await service.addRepository(alice, project.id, shop);
      expect(await service.listRepositories(bob, project.id)).toHaveLength(1);
      await expect(service.addRepository(bob, project.id, { ...shop, name: RepositoryName.parse("org/other") })).rejects.toBeInstanceOf(InsufficientRoleError);
      await expect(service.removeRepository(bob, project.id, added.id as never)).rejects.toBeInstanceOf(InsufficientRoleError);
    });

    it("hides the repositories of a project from non-members and applies the aggregate rules", async () => {
      const project = await service.create(alice, { name: name("Team") });
      await expect(service.listRepositories(bob, project.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
      await expect(service.addRepository(bob, project.id, shop)).rejects.toBeInstanceOf(ProjectNotFoundError);
      await service.addRepository(alice, project.id, shop);
      await expect(service.addRepository(alice, project.id, shop)).rejects.toBeInstanceOf(RepositoryAlreadyMappedError);
      await expect(
        service.addRepository(alice, project.id, { ...shop, name: RepositoryName.parse("org/x"), defaultBranch: BranchName.parse("main") }),
      ).rejects.toBeInstanceOf(DefaultBranchNotAllowedError);
      await expect(service.removeRepository(alice, project.id, "unknown" as never)).rejects.toBeInstanceOf(RepositoryMappingNotFoundError);
    });
  });
});
