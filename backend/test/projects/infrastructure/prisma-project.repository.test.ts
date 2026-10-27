import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../src/generated/prisma/client.js";
import {
  DuplicateProjectNameError,
  Project,
  ProjectDescription,
  ProjectName,
  RepositoryName,
  RepositoryUrl,
} from "../../../src/projects";
import { DEFAULT_EDITABLE_POLICY, EditablePolicy } from "../../../src/policy";
import { PolicyVersionConflictError, type PolicyVersion } from "../../../src/projects";
import { PrismaClientHolder } from "../../../src/database";
import { PrismaProjectPolicyRepository } from "../../../src/projects/infrastructure/prisma-project-policy.repository";
import { PrismaProjectRepository } from "../../../src/projects/infrastructure/prisma-project.repository";
import { BranchName, BranchPattern, TenantId, UserId } from "../../../src/shared-kernel";
import { NOW } from "../../support/time";

const url = process.env["DATABASE_URL"];

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("PrismaProjectRepository (Postgres)", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const alice = UserId.parse("alice");
  const bob = UserId.parse("bob");
  const holder = new PrismaClientHolder(url);
  const repo = new PrismaProjectRepository(holder);
  const cleanup = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "" }) });

  const newProject = (tenantId: TenantId, name: string, creator: UserId = alice): Project =>
    Project.create({
      id: repo.nextId(),
      tenantId,
      name: ProjectName.parse(name),
      description: ProjectDescription.parse(""),
      creator,
      now: NOW,
    });

  afterAll(async () => {
    await cleanup.project.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await cleanup.$disconnect();
    await holder.onModuleDestroy();
  });

  it("saves the aggregate with its members and reads it back for its tenant only", async () => {
    const project = newProject(tenantA, "Shop");
    project.addMember(alice, bob, "DEV", NOW);
    await repo.save(project);
    const loaded = await repo.findById(tenantA, project.id);
    expect(loaded?.toProps()).toMatchObject({ name: "Shop", members: [{ userId: "alice", role: "PL" }, { userId: "bob", role: "DEV" }] });
    // Same instants; the database returns them with milliseconds, so compare as dates, not as text.
    expect(new Date(loaded?.createdAt ?? "").getTime()).toBe(new Date(project.createdAt).getTime());
    expect(new Date(loaded?.updatedAt ?? "").getTime()).toBe(new Date(project.updatedAt).getTime());
    expect(await repo.findById(tenantB, project.id)).toBeUndefined();
    expect((await repo.listByMember(tenantA, bob)).map((p) => p.name)).toEqual(["Shop"]);
    expect(await repo.listByMember(tenantB, alice)).toEqual([]);
  });

  it("persists member changes: role change and removal", async () => {
    const project = newProject(tenantA, "Team");
    project.addMember(alice, bob, "DEV", NOW);
    await repo.save(project);
    const loaded = await repo.findById(tenantA, project.id);
    loaded?.changeMemberRole(alice, bob, "PM", NOW);
    await repo.save(loaded as Project);
    expect((await repo.findById(tenantA, project.id))?.roleOf(bob)).toBe("PM");
    const again = await repo.findById(tenantA, project.id);
    again?.removeMember(alice, bob, NOW);
    await repo.save(again as Project);
    expect((await repo.findById(tenantA, project.id))?.roleOf(bob)).toBeUndefined();
  });

  it("persists repository mappings: add, change branches, remove", async () => {
    const project = newProject(tenantA, "Mapped");
    const mappingId = repo.nextRepositoryMappingId();
    project.addRepository(
      alice,
      {
        id: mappingId,
        provider: "github",
        name: RepositoryName.parse("org/mapped"),
        url: RepositoryUrl.parse("https://github.com/org/mapped.git"),
        defaultBranch: BranchName.parse("develop"),
        allowedBranches: [BranchPattern.parse("develop"), BranchPattern.parse("release/*")],
      },
      NOW,
    );
    await repo.save(project);
    const loaded = (await repo.findById(tenantA, project.id)) as Project;
    expect(loaded.repositories()).toMatchObject([
      { id: mappingId, provider: "github", name: "org/mapped", defaultBranch: "develop", allowedBranches: ["develop", "release/*"] },
    ]);
    loaded.changeRepositoryBranches(alice, mappingId, { allowedBranches: [BranchPattern.parse("develop")] }, NOW);
    await repo.save(loaded);
    expect((await repo.findById(tenantA, project.id))?.repositories()[0]?.allowedBranches).toEqual(["develop"]);
    const again = (await repo.findById(tenantA, project.id)) as Project;
    again.removeRepository(alice, mappingId, NOW);
    await repo.save(again);
    expect((await repo.findById(tenantA, project.id))?.repositories()).toEqual([]);
  });

  it("appends policy versions, newest first, scoped by tenant, and refuses a repeated version number", async () => {
    const policies = new PrismaProjectPolicyRepository(holder);
    const project = newProject(tenantA, "Policies");
    await repo.save(project);
    const version = (n: number, executables: string[]): PolicyVersion => ({
      version: n,
      policy: EditablePolicy.parse({ ...DEFAULT_EDITABLE_POLICY, allowedExecutables: executables }),
      changedBy: alice,
      changedAt: NOW,
      comment: `v${n}`,
    });
    expect(await policies.findLatest(tenantA, project.id)).toBeUndefined();
    await policies.append(tenantA, project.id, version(1, ["node"]));
    await policies.append(tenantA, project.id, version(2, ["node", "pnpm"]));
    expect((await policies.findLatest(tenantA, project.id))?.policy.allowedExecutables).toEqual(["node", "pnpm"]);
    expect((await policies.listVersions(tenantA, project.id)).map((v) => v.version)).toEqual([2, 1]);
    expect((await policies.listVersions(tenantA, project.id))[1]).toMatchObject({ changedBy: "alice", comment: "v1" });
    await expect(policies.append(tenantA, project.id, version(2, ["tsc"]))).rejects.toBeInstanceOf(PolicyVersionConflictError);
    expect(await policies.findLatest(tenantB, project.id)).toBeUndefined();
    expect(await policies.listVersions(tenantB, project.id)).toEqual([]);
    await expect(policies.append(tenantB, project.id, version(3, ["tsc"]))).rejects.toThrow();
  });

  it("refuses to read a stored policy that breaks today's rules instead of applying it", async () => {
    const policies = new PrismaProjectPolicyRepository(holder);
    const project = newProject(tenantA, "Tampered");
    await repo.save(project);
    await cleanup.projectPolicyVersion.create({
      data: {
        projectId: project.id,
        version: 1,
        policy: { ...DEFAULT_EDITABLE_POLICY, allowedExecutables: ["bash"] },
        changedBy: "mallory",
        createdAt: new Date(NOW),
      },
    });
    await expect(policies.findLatest(tenantA, project.id)).rejects.toThrow();
  });

  it("enforces unique names per tenant, on create and on rename", async () => {
    await repo.save(newProject(tenantA, "Unique"));
    await expect(repo.save(newProject(tenantA, "Unique", bob))).rejects.toBeInstanceOf(DuplicateProjectNameError);
    await expect(repo.save(newProject(tenantB, "Unique", bob))).resolves.toBeUndefined();
    const other = newProject(tenantA, "Other");
    await repo.save(other);
    other.rename(alice, ProjectName.parse("Unique"), NOW);
    await expect(repo.save(other)).rejects.toBeInstanceOf(DuplicateProjectNameError);
  });
});
