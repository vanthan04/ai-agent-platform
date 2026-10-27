import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/identity";
import {
  BearerToken,
  DuplicateMcpConnectionError,
  MAX_MCP_CONNECTIONS_PER_PROJECT,
  McpConnectionName,
  McpConnectionNotFoundError,
  McpConnectionsService,
  McpForbiddenError,
  McpProjectNotFoundError,
  McpServerUrl,
  TooManyMcpConnectionsError,
  type ProjectAccess,
} from "../../../src/mcp";
import { Role, TenantId, UserId } from "../../../src/shared-kernel";
import { SecretStorageNotConfiguredError, type SecretStore } from "../../../src/vault";
import { InMemoryMcpConnectionRepository } from "../../support/in-memory-mcp-connection.repository";
import { InMemorySecretStore } from "../../support/in-memory-secret-store";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const dev = user("dev");
const stranger = user("stranger");
const name = (value: string) => McpConnectionName.parse(value);
const url = (value = "https://mcp.example.com/sse") => McpServerUrl.parse(value);
const token = (value = "ghp_supersecrettoken123") => BearerToken.parse(value);

/** Roles by `<tenant>/<user>` in the one project `project-1`. */
const access = (roles: Record<string, Role>): ProjectAccess => ({
  async roleOf(who, projectId) {
    return projectId === "project-1" ? roles[`${who.tenantId}/${who.userId}`] : undefined;
  },
});

describe("McpConnectionsService", () => {
  let secrets: InMemorySecretStore;
  let service: McpConnectionsService;

  const build = (store: SecretStore = secrets) =>
    new McpConnectionsService(
      new InMemoryMcpConnectionRepository(),
      access({ "tenant-1/alice": "PL", "tenant-1/dev": "DEV" }),
      store,
      { now: () => NOW },
      { discover: async () => ({ ok: false, failure: 'unreachable' }) },
      { tryAcquire: () => true },
    );

  beforeEach(() => {
    secrets = new InMemorySecretStore();
    service = build();
  });

  it("connects a server that needs no sign-in without storing any secret", async () => {
    const created = await service.create(alice, "project-1", { name: name("docs"), url: url() });
    expect(created).toMatchObject({ name: "docs", url: "https://mcp.example.com/sse", auth: "none", createdBy: "alice", createdAt: NOW });
    expect(secrets.size).toBe(0);
  });

  it("stores the token as a secret and never lets it, or its reference, out in a view", async () => {
    const created = await service.create(alice, "project-1", { name: name("github"), url: url(), bearerToken: token() });
    expect(created.auth).toBe("bearer");
    expect(secrets.size).toBe(1);
    const everything = JSON.stringify([created, await service.list(alice, "project-1")]);
    expect(everything).not.toContain("ghp_supersecrettoken123");
    expect(everything).not.toContain("secret-1");
    expect(Object.keys(created).sort()).toEqual(["auth", "createdAt", "createdBy", "id", "name", "updatedAt", "url"]);
  });

  it("refuses a repeated name and leaves no orphan secret behind", async () => {
    await service.create(alice, "project-1", { name: name("github"), url: url() });
    await expect(service.create(alice, "project-1", { name: name("github"), url: url("https://other.example.com"), bearerToken: token() })).rejects.toBeInstanceOf(
      DuplicateMcpConnectionError,
    );
    expect(secrets.size).toBe(0);
  });

  it("limits the connections of a project", async () => {
    for (let i = 0; i < MAX_MCP_CONNECTIONS_PER_PROJECT; i++) await service.create(alice, "project-1", { name: name(`server-${i}`), url: url() });
    await expect(service.create(alice, "project-1", { name: name("one-too-many"), url: url() })).rejects.toBeInstanceOf(TooManyMcpConnectionsError);
  });

  it("lets a DEV see the connections but not change them, and shows a non-member nothing", async () => {
    const created = await service.create(alice, "project-1", { name: name("github"), url: url(), bearerToken: token() });
    expect(await service.list(dev, "project-1")).toHaveLength(1);
    await expect(service.create(dev, "project-1", { name: name("x"), url: url() })).rejects.toBeInstanceOf(McpForbiddenError);
    await expect(service.replaceToken(dev, "project-1", created.id, token("another-token-12345"))).rejects.toBeInstanceOf(McpForbiddenError);
    await expect(service.remove(dev, "project-1", created.id)).rejects.toBeInstanceOf(McpForbiddenError);
    await expect(service.list(stranger, "project-1")).rejects.toBeInstanceOf(McpProjectNotFoundError);
    await expect(service.create(stranger, "project-1", { name: name("x"), url: url() })).rejects.toBeInstanceOf(McpProjectNotFoundError);
    await expect(service.list(alice, "no-such-project")).rejects.toBeInstanceOf(McpProjectNotFoundError);
    expect(secrets.size).toBe(1);
  });

  it("does not cross tenants even for the same user id", async () => {
    await service.create(alice, "project-1", { name: name("github"), url: url() });
    await expect(service.list(user("alice", "tenant-2"), "project-1")).rejects.toBeInstanceOf(McpProjectNotFoundError);
  });

  it("replaces a token: the old secret is removed, a server without sign-in gains one", async () => {
    const withToken = await service.create(alice, "project-1", { name: name("github"), url: url(), bearerToken: token() });
    const replaced = await service.replaceToken(alice, "project-1", withToken.id, token("a-brand-new-token-999"));
    expect(replaced.auth).toBe("bearer");
    expect(replaced.updatedAt).toBe(NOW);
    expect(secrets.size).toBe(1);
    const open = await service.create(alice, "project-1", { name: name("docs"), url: url("https://docs.example.com") });
    expect((await service.replaceToken(alice, "project-1", open.id, token("token-for-docs-12345"))).auth).toBe("bearer");
    expect(secrets.size).toBe(2);
  });

  it("removes a connection together with its secret", async () => {
    const created = await service.create(alice, "project-1", { name: name("github"), url: url(), bearerToken: token() });
    await service.remove(alice, "project-1", created.id);
    expect(await service.list(alice, "project-1")).toEqual([]);
    expect(secrets.size).toBe(0);
    await expect(service.remove(alice, "project-1", created.id)).rejects.toBeInstanceOf(McpConnectionNotFoundError);
    await expect(service.replaceToken(alice, "project-1", "unknown", token())).rejects.toBeInstanceOf(McpConnectionNotFoundError);
  });

  it("cannot reach a connection through another project's id", async () => {
    const created = await service.create(alice, "project-1", { name: name("github"), url: url() });
    const elsewhere = new McpConnectionsService(
      new InMemoryMcpConnectionRepository(),
      { roleOf: async () => "PL" },
      secrets,
      { now: () => NOW },
      { discover: async () => ({ ok: false, failure: 'unreachable' }) },
      { tryAcquire: () => true },
    );
    await expect(elsewhere.remove(alice, "project-2", created.id)).rejects.toBeInstanceOf(McpConnectionNotFoundError);
  });

  it("fails cleanly when secret storage is not configured, and still connects a server that needs no token", async () => {
    const unconfigured: SecretStore = {
      put: async () => {
        throw new SecretStorageNotConfiguredError();
      },
      get: async (): Promise<string | undefined> => {
        throw new SecretStorageNotConfiguredError();
      },
      delete: async () => undefined,
    };
    const bare = build(unconfigured);
    await expect(bare.create(alice, "project-1", { name: name("github"), url: url(), bearerToken: token() })).rejects.toBeInstanceOf(SecretStorageNotConfiguredError);
    expect(await bare.list(alice, "project-1")).toEqual([]);
    await expect(bare.create(alice, "project-1", { name: name("docs"), url: url() })).resolves.toMatchObject({ auth: "none" });
  });
});
