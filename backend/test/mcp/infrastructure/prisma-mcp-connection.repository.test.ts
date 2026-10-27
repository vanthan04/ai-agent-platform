import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClientHolder } from "../../../src/database";
import { DuplicateMcpConnectionError, McpConnection, McpConnectionName, McpServerUrl } from "../../../src/mcp";
import { PrismaMcpConnectionRepository } from "../../../src/mcp/infrastructure/prisma-mcp-connection.repository";
import { ProjectDescription, ProjectName, Project } from "../../../src/projects";
import { PrismaProjectRepository } from "../../../src/projects/infrastructure/prisma-project.repository";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { SecretRef } from "../../../src/vault";
import { NOW } from "../../support/time";

const url = process.env["DATABASE_URL"];

// Runs only when DATABASE_URL points at a database where `pnpm db:deploy` was applied; otherwise vitest reports it as skipped.
describe.skipIf(!url)("PrismaMcpConnectionRepository (Postgres)", () => {
  const tenantA = TenantId.parse(`test-${randomUUID()}`);
  const tenantB = TenantId.parse(`test-${randomUUID()}`);
  const alice = UserId.parse("alice");
  const holder = new PrismaClientHolder(url);
  const projects = new PrismaProjectRepository(holder);
  const repo = new PrismaMcpConnectionRepository(holder);

  afterAll(async () => {
    await holder.db().project.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await holder.onModuleDestroy();
  });

  const newProject = async (tenantId: TenantId, name: string): Promise<Project> => {
    const project = Project.create({ id: projects.nextId(), tenantId, name: ProjectName.parse(name), description: ProjectDescription.parse(""), creator: alice, now: NOW });
    await projects.save(project);
    return project;
  };

  const connection = (project: Project, name: string, secret?: string): McpConnection =>
    McpConnection.create({
      id: repo.nextId(),
      tenantId: project.tenantId,
      projectId: project.id,
      name: McpConnectionName.parse(name),
      url: McpServerUrl.parse("https://mcp.example.com/sse"),
      secretRef: secret ? SecretRef.parse(secret) : undefined,
      createdBy: alice,
      now: NOW,
    });

  it("saves, finds and lists connections of a project, keeping only the reference to the token", async () => {
    const project = await newProject(tenantA, "McpRepo");
    const withToken = connection(project, "github", "secret-ref-1");
    await repo.save(withToken);
    await repo.save(connection(project, "docs"));
    const found = await repo.findById(tenantA, project.id, withToken.id);
    expect(found?.toProps()).toMatchObject({ name: "github", url: "https://mcp.example.com/sse", secretRef: "secret-ref-1", createdBy: "alice" });
    expect((await repo.listByProject(tenantA, project.id)).map((c) => c.name)).toEqual(["github", "docs"]);
    expect((await repo.findById(tenantA, project.id, (await repo.listByProject(tenantA, project.id))[1]?.id ?? ""))?.secretRef).toBeUndefined();
  });

  it("is scoped by tenant and by project", async () => {
    const project = await newProject(tenantA, "McpScope");
    const other = await newProject(tenantA, "McpScopeOther");
    const saved = connection(project, "github");
    await repo.save(saved);
    expect(await repo.findById(tenantB, project.id, saved.id)).toBeUndefined();
    expect(await repo.findById(tenantA, other.id, saved.id)).toBeUndefined();
    expect(await repo.listByProject(tenantB, project.id)).toEqual([]);
    await repo.delete(tenantB, project.id, saved.id);
    await repo.delete(tenantA, other.id, saved.id);
    expect(await repo.findById(tenantA, project.id, saved.id)).toBeDefined();
    await expect(repo.save(connection(await newProject(tenantB, "McpOtherTenant"), "x").withSecret(SecretRef.parse("s"), NOW))).resolves.toBeUndefined();
  });

  it("refuses a repeated name in one project but allows it in another, and persists a swapped token", async () => {
    const project = await newProject(tenantA, "McpNames");
    const other = await newProject(tenantA, "McpNamesOther");
    const first = connection(project, "github");
    await repo.save(first);
    await expect(repo.save(connection(project, "github"))).rejects.toBeInstanceOf(DuplicateMcpConnectionError);
    await expect(repo.save(connection(other, "github"))).resolves.toBeUndefined();
    await repo.save(first.withSecret(SecretRef.parse("secret-ref-2"), "2026-10-27T12:00:00Z"));
    expect((await repo.findById(tenantA, project.id, first.id))?.secretRef).toBe("secret-ref-2");
    await repo.delete(tenantA, project.id, first.id);
    expect(await repo.findById(tenantA, project.id, first.id)).toBeUndefined();
  });

  it("refuses to save a connection for a project of another tenant", async () => {
    const project = await newProject(tenantA, "McpWrongTenant");
    const forged = McpConnection.create({ ...connection(project, "github").toProps(), tenantId: tenantB, now: NOW });
    await expect(repo.save(forged)).rejects.toThrow();
  });
});
