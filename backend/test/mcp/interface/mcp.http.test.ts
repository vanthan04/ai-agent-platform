import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app/app.module";
import { APP_CONFIG, loadConfig } from "../../../src/config/config";
import { AUTHENTICATOR, type AuthUser, type AuthenticationRequest, type Authenticator } from "../../../src/identity";
import { MCP_CONNECTION_REPOSITORY, MCP_SERVER_CLIENT, TEST_RATE_LIMITER, type McpDiscovery, type McpServerClient } from "../../../src/mcp";
import { PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY } from "../../../src/projects";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { SECRET_STORE, SecretStorageNotConfiguredError, type SecretStore } from "../../../src/vault";
import { InMemoryMcpConnectionRepository } from "../../support/in-memory-mcp-connection.repository";
import { InMemoryProjectPolicyRepository } from "../../support/in-memory-project-policy.repository";
import { InMemoryProjectRepository } from "../../support/in-memory-project.repository";
import { InMemorySecretStore } from "../../support/in-memory-secret-store";

class HeaderAuthenticator implements Authenticator {
  authenticate(req: AuthenticationRequest): AuthUser | undefined {
    const header = req.headers["x-test-user"];
    if (typeof header !== "string") return undefined;
    const [userId, tenantId = "tenant-1"] = header.split("@");
    return { userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) };
  }
}

const TOKEN = "ghp_not-a-real-token-for-tests-12345";

/** A stand-in for a remote MCP server: records what it was asked and answers with whatever the test set. */
class FakeMcpClient implements McpServerClient {
  calls: { url: string; bearerToken?: string }[] = [];
  result: McpDiscovery = { ok: true, protocolVersion: "2025-06-18", server: { name: "Fake" }, tools: [{ name: "get_issue", description: "Reads an issue" }], skipped: 0, truncated: false };

  async discover(target: { url: string; bearerToken?: string }): Promise<McpDiscovery> {
    this.calls.push(target);
    return this.result;
  }
}

async function startApp(secrets: SecretStore, client: McpServerClient = new FakeMcpClient(), tests = 100): Promise<INestApplication> {
  let attempts = 0;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(loadConfig({ NODE_ENV: "test" }))
    .overrideProvider(AUTHENTICATOR)
    .useValue(new HeaderAuthenticator())
    .overrideProvider(PROJECT_REPOSITORY)
    .useValue(new InMemoryProjectRepository())
    .overrideProvider(PROJECT_POLICY_REPOSITORY)
    .useValue(new InMemoryProjectPolicyRepository())
    .overrideProvider(MCP_CONNECTION_REPOSITORY)
    .useValue(new InMemoryMcpConnectionRepository())
    .overrideProvider(SECRET_STORE)
    .useValue(secrets)
    .overrideProvider(MCP_SERVER_CLIENT)
    .useValue(client)
    .overrideProvider(TEST_RATE_LIMITER)
    .useValue({ tryAcquire: () => ++attempts <= tests })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe("MCP connections over HTTP", () => {
  let app: INestApplication;
  let secrets: InMemorySecretStore;
  const as = (user: string) => ({ "x-test-user": user });
  const http = () => request(app.getHttpServer());
  const server = { name: "github", url: "https://mcp.example.com/sse" };

  const newProject = async (name: string): Promise<string> => (await http().post("/projects").set(as("alice")).send({ name }).expect(201)).body.id as string;

  beforeAll(async () => {
    secrets = new InMemorySecretStore();
    app = await startApp(secrets);
  });

  afterAll(async () => {
    await app.close();
  });

  it("connects, lists and removes a server, and a token never appears in any response", async () => {
    const id = await newProject("Mcp1");
    const created = await http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send({ ...server, bearerToken: TOKEN }).expect(201);
    expect(created.body).toMatchObject({ name: "github", url: "https://mcp.example.com/sse", auth: "bearer", createdBy: "alice" });
    const list = await http().get(`/projects/${id}/mcp-connections`).set(as("alice")).expect(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify([created.body, list.body])).not.toContain(TOKEN);
    expect(Object.keys(list.body[0]).sort()).toEqual(["auth", "createdAt", "createdBy", "id", "name", "updatedAt", "url"]);
    await http().delete(`/projects/${id}/mcp-connections/${created.body.id}`).set(as("alice")).expect(204);
    await http().delete(`/projects/${id}/mcp-connections/${created.body.id}`).set(as("alice")).expect(404);
  });

  it("rejects an unsafe address or token with field paths only, never echoing what was sent", async () => {
    const id = await newProject("Mcp2");
    const post = (body: object) => http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send(body);
    for (const url of ["http://mcp.example.com", "https://127.0.0.1/", "https://localhost/", "https://user:hunter2@mcp.example.com/", "https://mcp.example.com/?token=hunter2"]) {
      const response = await post({ ...server, url }).expect(400);
      expect(JSON.stringify(response.body)).not.toContain("hunter2");
    }
    const badToken = await post({ ...server, bearerToken: "has a space and hunter2" }).expect(400);
    expect(JSON.stringify(badToken.body)).not.toContain("hunter2");
    await post({ ...server, name: "Not Valid" }).expect(400);
    await post({ ...server, extra: "x" }).expect(400);
    await post({ name: "github" }).expect(400);
  });

  it("answers 409 for a repeated name", async () => {
    const id = await newProject("Mcp3");
    await http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send(server).expect(201);
    await http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send({ ...server, url: "https://other.example.com" }).expect(409);
  });

  it("lets a DEV read but not change, and shows a non-member nothing", async () => {
    const id = await newProject("Mcp4");
    await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
    const created = await http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send(server).expect(201);
    await http().get(`/projects/${id}/mcp-connections`).set(as("dev")).expect(200);
    await http().post(`/projects/${id}/mcp-connections`).set(as("dev")).send({ ...server, name: "other" }).expect(403);
    await http().put(`/projects/${id}/mcp-connections/${created.body.id}/token`).set(as("dev")).send({ bearerToken: TOKEN }).expect(403);
    await http().delete(`/projects/${id}/mcp-connections/${created.body.id}`).set(as("dev")).expect(403);
    await http().get(`/projects/${id}/mcp-connections`).set(as("stranger")).expect(404);
    await http().get(`/projects/${id}/mcp-connections`).set(as("alice@tenant-2")).expect(404);
    await http().get(`/projects/${id}/mcp-connections`).expect(401);
  });

  it("replaces a token without ever returning it", async () => {
    const id = await newProject("Mcp5");
    const created = await http().post(`/projects/${id}/mcp-connections`).set(as("alice")).send(server).expect(201);
    expect(created.body.auth).toBe("none");
    const replaced = await http().put(`/projects/${id}/mcp-connections/${created.body.id}/token`).set(as("alice")).send({ bearerToken: TOKEN }).expect(200);
    expect(replaced.body.auth).toBe("bearer");
    expect(JSON.stringify(replaced.body)).not.toContain(TOKEN);
    await http().put(`/projects/${id}/mcp-connections/unknown/token`).set(as("alice")).send({ bearerToken: TOKEN }).expect(404);
    await http().put(`/projects/${id}/mcp-connections/${created.body.id}/token`).set(as("alice")).send({}).expect(400);
  });

  describe("testing a connection", () => {
    it("lists the tools, sends the stored token to the server, and never returns it", async () => {
      const client = new FakeMcpClient();
      const testApp = await startApp(new InMemorySecretStore(), client);
      try {
        const api = () => request(testApp.getHttpServer());
        const project = await api().post("/projects").set(as("alice")).send({ name: "TestIt" }).expect(201);
        const path = `/projects/${project.body.id}/mcp-connections`;
        const created = await api().post(path).set(as("alice")).send({ ...server, bearerToken: TOKEN }).expect(201);
        const result = await api().post(`${path}/${created.body.id}/test`).set(as("alice")).expect(200);
        expect(result.body).toMatchObject({ ok: true, protocolVersion: "2025-06-18", server: { name: "Fake" }, tools: [{ name: "get_issue", description: "Reads an issue" }], skippedTools: 0, truncated: false });
        expect(JSON.stringify(result.body)).not.toContain(TOKEN);
        expect(client.calls).toEqual([{ url: "https://mcp.example.com/sse", bearerToken: TOKEN }]);
      } finally {
        await testApp.close();
      }
    });

    it("answers 200 with a one-word reason when the server cannot be used", async () => {
      const client = new FakeMcpClient();
      const testApp = await startApp(new InMemorySecretStore(), client);
      try {
        const api = () => request(testApp.getHttpServer());
        const project = await api().post("/projects").set(as("alice")).send({ name: "TestFail" }).expect(201);
        const path = `/projects/${project.body.id}/mcp-connections`;
        const created = await api().post(path).set(as("alice")).send(server).expect(201);
        client.result = { ok: false, failure: "blocked_address" };
        const result = await api().post(`${path}/${created.body.id}/test`).set(as("alice")).expect(200);
        expect(result.body).toMatchObject({ ok: false, error: "blocked_address" });
        expect(Object.keys(result.body).sort()).toEqual(["error", "ok", "testedAt"]);
      } finally {
        await testApp.close();
      }
    });

    it("refuses a DEV with 403, a non-member with 404, an unknown connection with 404 and calls nothing", async () => {
      const client = new FakeMcpClient();
      const testApp = await startApp(new InMemorySecretStore(), client);
      try {
        const api = () => request(testApp.getHttpServer());
        const project = await api().post("/projects").set(as("alice")).send({ name: "TestAccess" }).expect(201);
        const path = `/projects/${project.body.id}/mcp-connections`;
        await api().post(`/projects/${project.body.id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
        const created = await api().post(path).set(as("alice")).send(server).expect(201);
        await api().post(`${path}/${created.body.id}/test`).set(as("dev")).expect(403);
        await api().post(`${path}/${created.body.id}/test`).set(as("stranger")).expect(404);
        await api().post(`${path}/${created.body.id}/test`).expect(401);
        await api().post(`${path}/unknown/test`).set(as("alice")).expect(404);
        expect(client.calls).toEqual([]);
      } finally {
        await testApp.close();
      }
    });

    it("answers 429 once a project has used up its tests", async () => {
      const testApp = await startApp(new InMemorySecretStore(), new FakeMcpClient(), 2);
      try {
        const api = () => request(testApp.getHttpServer());
        const project = await api().post("/projects").set(as("alice")).send({ name: "TestLimit" }).expect(201);
        const path = `/projects/${project.body.id}/mcp-connections`;
        const created = await api().post(path).set(as("alice")).send(server).expect(201);
        await api().post(`${path}/${created.body.id}/test`).set(as("alice")).expect(200);
        await api().post(`${path}/${created.body.id}/test`).set(as("alice")).expect(200);
        await api().post(`${path}/${created.body.id}/test`).set(as("alice")).expect(429);
      } finally {
        await testApp.close();
      }
    });
  });

  it("answers 503 when secret storage is not configured, and still connects a server without a token", async () => {
    const bare = await startApp({
      put: async () => {
        throw new SecretStorageNotConfiguredError();
      },
      get: async () => undefined,
      delete: async () => undefined,
    });
    try {
      const created = await request(bare.getHttpServer()).post("/projects").set(as("alice")).send({ name: "NoKey" }).expect(201);
      const path = `/projects/${created.body.id}/mcp-connections`;
      const failed = await request(bare.getHttpServer()).post(path).set(as("alice")).send({ ...server, bearerToken: TOKEN }).expect(503);
      expect(JSON.stringify(failed.body)).not.toContain(TOKEN);
      await request(bare.getHttpServer()).post(path).set(as("alice")).send(server).expect(201);
    } finally {
      await bare.close();
    }
  });
});
