import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ModelBaseUrl, ModelName, ModelProvider, ModelSettings } from "../../../src/agent";
import { PrismaModelSettingsRepository } from "../../../src/agent/infrastructure/prisma-model-settings.repository";
import { PrismaClientHolder } from "../../../src/database";
import { Project, ProjectDescription, ProjectName } from "../../../src/projects";
import { PrismaProjectRepository } from "../../../src/projects/infrastructure/prisma-project.repository";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { SecretRef } from "../../../src/vault";
import { NOW } from "../../support/time";

const url = process.env["DATABASE_URL"];

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("PrismaModelSettingsRepository (Postgres)", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const alice = UserId.parse("alice");
  const holder = new PrismaClientHolder(url);
  const projects = new PrismaProjectRepository(holder);
  const repo = new PrismaModelSettingsRepository(holder);

  afterAll(async () => {
    await holder.db().project.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await holder.onModuleDestroy();
  });

  const newProject = async (tenantId: TenantId, name: string): Promise<Project> => {
    const project = Project.create({ id: projects.nextId(), tenantId, name: ProjectName.parse(name), description: ProjectDescription.parse(""), creator: alice, now: NOW });
    await projects.save(project);
    return project;
  };

  const settings = (project: Project, model: string, secret?: string, baseUrl?: string): ModelSettings =>
    ModelSettings.create({
      tenantId: project.tenantId,
      projectId: project.id,
      choice: baseUrl
        ? { provider: ModelProvider.parse("openai_compatible"), model: ModelName.parse(model), baseUrl: ModelBaseUrl.parse(baseUrl) }
        : { provider: ModelProvider.parse("anthropic"), model: ModelName.parse(model) },
      secretRef: secret ? SecretRef.parse(secret) : undefined,
      updatedBy: alice,
      now: NOW,
    });

  it("saves, reads back and replaces the one record of a project, keeping only the reference to the key", async () => {
    const project = await newProject(tenantA, "Model repo 1");
    expect(await repo.find(tenantA, project.id)).toBeUndefined();
    await repo.save(settings(project, "m1", "secret-1"));
    expect((await repo.find(tenantA, project.id))?.toProps()).toMatchObject({ provider: "anthropic", model: "m1", secretRef: "secret-1", baseUrl: undefined });
    await repo.save(settings(project, "m2", undefined, "https://api.example.com/v1"));
    expect((await repo.find(tenantA, project.id))?.toProps()).toMatchObject({ provider: "openai_compatible", model: "m2", secretRef: undefined, baseUrl: "https://api.example.com/v1" });
    expect(await holder.db().projectModelSettings.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("is scoped by tenant", async () => {
    const project = await newProject(tenantA, "Model repo 2");
    await repo.save(settings(project, "m1"));
    expect(await repo.find(tenantB, project.id)).toBeUndefined();
    await repo.delete(tenantB, project.id);
    expect(await repo.find(tenantA, project.id)).toBeDefined();
    await repo.delete(tenantA, project.id);
    expect(await repo.find(tenantA, project.id)).toBeUndefined();
  });

  it("refuses to save for a project of another tenant", async () => {
    const project = await newProject(tenantA, "Model repo 3");
    const foreign = ModelSettings.create({ tenantId: tenantB, projectId: project.id, choice: { provider: ModelProvider.parse("gemini"), model: ModelName.parse("m") }, secretRef: undefined, updatedBy: alice, now: NOW });
    await expect(repo.save(foreign)).rejects.toThrow();
  });

  it("is removed with its project", async () => {
    const project = await newProject(tenantA, "Model repo 4");
    await repo.save(settings(project, "m1"));
    await holder.db().project.delete({ where: { id: project.id } });
    expect(await holder.db().projectModelSettings.count({ where: { projectId: project.id } })).toBe(0);
  });
});
