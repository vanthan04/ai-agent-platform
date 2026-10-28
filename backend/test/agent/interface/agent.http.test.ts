import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_SETTINGS_REPOSITORY } from "../../../src/agent";
import { AppModule } from "../../../src/app/app.module";
import { APP_CONFIG, loadConfig } from "../../../src/config/config";
import { AUTHENTICATOR, type AuthUser, type AuthenticationRequest, type Authenticator } from "../../../src/identity";
import { PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY } from "../../../src/projects";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { SECRET_STORE, SecretStorageNotConfiguredError, type SecretStore } from "../../../src/vault";
import { InMemoryModelSettingsRepository } from "../../support/in-memory-model-settings.repository";
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

const KEY = "sk-ant-not-a-real-key-for-tests-12345";

async function startApp(secrets: SecretStore): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(loadConfig({ NODE_ENV: "test" }))
    .overrideProvider(AUTHENTICATOR)
    .useValue(new HeaderAuthenticator())
    .overrideProvider(PROJECT_REPOSITORY)
    .useValue(new InMemoryProjectRepository())
    .overrideProvider(PROJECT_POLICY_REPOSITORY)
    .useValue(new InMemoryProjectPolicyRepository())
    .overrideProvider(MODEL_SETTINGS_REPOSITORY)
    .useValue(new InMemoryModelSettingsRepository())
    .overrideProvider(SECRET_STORE)
    .useValue(secrets)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe("Model settings over HTTP", () => {
  let app: INestApplication;
  let secrets: InMemorySecretStore;
  const as = (user: string) => ({ "x-test-user": user });
  const http = () => request(app.getHttpServer());
  const newProject = async (name: string): Promise<string> => (await http().post("/projects").set(as("alice")).send({ name }).expect(201)).body.id as string;
  const claude = { provider: "anthropic", model: "claude-sonnet-5-5" };

  beforeAll(async () => {
    secrets = new InMemorySecretStore();
    app = await startApp(secrets);
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts unconfigured, lists the providers, and saves a choice with a key that never comes back", async () => {
    const id = await newProject("Model1");
    const first = await http().get(`/projects/${id}/model`).set(as("alice")).expect(200);
    expect(first.body.settings).toEqual({ configured: false });
    expect(first.body.providers.map((p: { id: string }) => p.id)).toEqual(["anthropic", "gemini", "openai_compatible"]);

    const saved = await http().put(`/projects/${id}/model`).set(as("alice")).send({ ...claude, apiKey: KEY }).expect(200);
    expect(saved.body).toMatchObject({ configured: true, ...claude, hasKey: true, updatedBy: "alice" });
    const read = await http().get(`/projects/${id}/model`).set(as("alice")).expect(200);
    expect(JSON.stringify([saved.body, read.body])).not.toContain(KEY);
    expect(Object.keys(read.body.settings).sort()).toEqual(["configured", "hasKey", "model", "provider", "updatedAt", "updatedBy"]);
  });

  it("switching provider drops the key; removing the choice deletes it", async () => {
    const id = await newProject("Model2");
    await http().put(`/projects/${id}/model`).set(as("alice")).send({ ...claude, apiKey: KEY }).expect(200);
    const switched = await http().put(`/projects/${id}/model`).set(as("alice")).send({ provider: "gemini", model: "gemini-model" }).expect(200);
    expect(switched.body).toMatchObject({ provider: "gemini", hasKey: false });
    await http().delete(`/projects/${id}/model`).set(as("alice")).expect(204);
    expect((await http().get(`/projects/${id}/model`).set(as("alice")).expect(200)).body.settings).toEqual({ configured: false });
    await http().delete(`/projects/${id}/model`).set(as("alice")).expect(204);
  });

  it("takes an OpenAI-compatible address and refuses a missing, unsafe or surplus one", async () => {
    const id = await newProject("Model3");
    const put = (body: object) => http().put(`/projects/${id}/model`).set(as("alice")).send(body);
    const ok = await put({ provider: "openai_compatible", model: "m", baseUrl: "https://api.example.com/v1" }).expect(200);
    expect(ok.body.baseUrl).toBe("https://api.example.com/v1");
    await put({ provider: "openai_compatible", model: "m" }).expect(400);
    await put({ ...claude, baseUrl: "https://api.example.com/v1" }).expect(400);
    for (const baseUrl of ["http://api.example.com", "https://127.0.0.1/v1", "https://u:hunter2@api.example.com/v1"]) {
      const response = await put({ provider: "openai_compatible", model: "m", baseUrl }).expect(400);
      expect(JSON.stringify(response.body)).not.toContain("hunter2");
    }
  });

  it("rejects bad input with field paths only, never echoing a key", async () => {
    const id = await newProject("Model4");
    const put = (body: object) => http().put(`/projects/${id}/model`).set(as("alice")).send(body);
    const badKey = await put({ ...claude, apiKey: "has a space and hunter2" }).expect(400);
    expect(JSON.stringify(badKey.body)).not.toContain("hunter2");
    await put({ provider: "other", model: "m" }).expect(400);
    await put({ ...claude, model: "bad model" }).expect(400);
    await put({ ...claude, extra: "x" }).expect(400);
    await put({}).expect(400);
  });

  it("lets a DEV read but not change, and shows a non-member and another tenant nothing", async () => {
    const id = await newProject("Model5");
    await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
    await http().put(`/projects/${id}/model`).set(as("alice")).send(claude).expect(200);
    await http().get(`/projects/${id}/model`).set(as("dev")).expect(200);
    await http().put(`/projects/${id}/model`).set(as("dev")).send(claude).expect(403);
    await http().delete(`/projects/${id}/model`).set(as("dev")).expect(403);
    await http().get(`/projects/${id}/model`).set(as("stranger")).expect(404);
    await http().get(`/projects/${id}/model`).set(as("alice@tenant-2")).expect(404);
    await http().get(`/projects/${id}/model`).expect(401);
  });

  it("answers 503 when a key is given but secrets cannot be stored, and nothing is saved", async () => {
    const broken = await startApp({
      put: async () => {
        throw new SecretStorageNotConfiguredError();
      },
      get: async () => undefined,
      delete: async () => {},
    });
    try {
      const id = (await request(broken.getHttpServer()).post("/projects").set(as("alice")).send({ name: "Model6" }).expect(201)).body.id as string;
      await request(broken.getHttpServer()).put(`/projects/${id}/model`).set(as("alice")).send({ ...claude, apiKey: KEY }).expect(503);
      expect((await request(broken.getHttpServer()).get(`/projects/${id}/model`).set(as("alice")).expect(200)).body.settings).toEqual({ configured: false });
    } finally {
      await broken.close();
    }
  });
});
