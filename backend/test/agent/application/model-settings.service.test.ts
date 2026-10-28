import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentForbiddenError,
  AgentProjectNotFoundError,
  ApiKey,
  InvalidModelSettingsError,
  ModelBaseUrl,
  ModelName,
  ModelProvider,
  ModelSettingsService,
  type ProjectAccess,
} from "../../../src/agent";
import type { AuthUser } from "../../../src/identity";
import { Role, TenantId, UserId } from "../../../src/shared-kernel";
import type { SecretStore } from "../../../src/vault";
import { InMemoryModelSettingsRepository } from "../../support/in-memory-model-settings.repository";
import { InMemorySecretStore } from "../../support/in-memory-secret-store";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const dev = user("dev");
const stranger = user("stranger");
const provider = (value: string) => ModelProvider.parse(value);
const model = (value: string) => ModelName.parse(value);
const key = (value = "sk-ant-secret-key-12345") => ApiKey.parse(value);
const SECRET = "sk-ant-secret-key-12345";

const access = (roles: Record<string, Role>): ProjectAccess => ({
  async roleOf(who, projectId) {
    return projectId === "project-1" ? roles[`${who.tenantId}/${who.userId}`] : undefined;
  },
});

describe("ModelSettingsService", () => {
  let secrets: InMemorySecretStore;
  let service: ModelSettingsService;

  const build = (store: SecretStore = secrets) =>
    new ModelSettingsService(new InMemoryModelSettingsRepository(), access({ "tenant-1/alice": "PL", "tenant-1/dev": "DEV" }), store, { now: () => NOW });

  beforeEach(() => {
    secrets = new InMemorySecretStore();
    service = build();
  });

  it("shows the providers and no choice before anyone sets one", async () => {
    const overview = await service.get(dev, "project-1");
    expect(overview.settings).toEqual({ configured: false });
    expect(overview.providers.map((p) => p.id)).toContain("gemini");
  });

  it("saves the choice and the key in the vault, and a view never holds the key or its reference", async () => {
    const saved = await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("claude-sonnet-5-5"), apiKey: key() });
    expect(saved).toEqual({ configured: true, provider: "anthropic", model: "claude-sonnet-5-5", hasKey: true, updatedBy: "alice", updatedAt: NOW });
    expect(secrets.size).toBe(1);
    const everything = JSON.stringify([saved, await service.get(dev, "project-1")]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("secret-1");
  });

  it("saves a choice without a key and reports hasKey false", async () => {
    const saved = await service.save(alice, "project-1", { provider: provider("gemini"), model: model("gemini-model") });
    expect(saved).toMatchObject({ configured: true, hasKey: false });
    expect(secrets.size).toBe(0);
  });

  it("keeps the key when only the model changes", async () => {
    await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("claude-sonnet-5-5"), apiKey: key() });
    const changed = await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("claude-opus-5-5") });
    expect(changed).toMatchObject({ model: "claude-opus-5-5", hasKey: true });
    expect(secrets.size).toBe(1);
  });

  it("deletes the old key when a new one replaces it", async () => {
    await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key() });
    await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key("sk-ant-second-key-6789") });
    expect(secrets.size).toBe(1);
  });

  it("deletes the key when the provider changes without a new one", async () => {
    await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key() });
    const changed = await service.save(alice, "project-1", { provider: provider("gemini"), model: model("g1") });
    expect(changed).toMatchObject({ provider: "gemini", hasKey: false });
    expect(secrets.size).toBe(0);
  });

  it("stores the address of an OpenAI-compatible server and refuses a missing or surplus one without leaving a key behind", async () => {
    const saved = await service.save(alice, "project-1", { provider: provider("openai_compatible"), model: model("m"), baseUrl: ModelBaseUrl.parse("https://api.example.com/v1"), apiKey: key() });
    expect(saved).toMatchObject({ baseUrl: "https://api.example.com/v1", hasKey: true });
    const before = secrets.size;
    await expect(service.save(alice, "project-1", { provider: provider("openai_compatible"), model: model("m"), apiKey: key("sk-another-key-123456") })).rejects.toBeInstanceOf(InvalidModelSettingsError);
    await expect(service.save(alice, "project-1", { provider: provider("anthropic"), model: model("m"), baseUrl: ModelBaseUrl.parse("https://api.example.com"), apiKey: key("sk-another-key-654321") })).rejects.toBeInstanceOf(
      InvalidModelSettingsError,
    );
    expect(secrets.size).toBe(before);
  });

  it("removes the choice and its key, and removing nothing is fine", async () => {
    await service.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key() });
    await service.remove(alice, "project-1");
    expect((await service.get(alice, "project-1")).settings).toEqual({ configured: false });
    expect(secrets.size).toBe(0);
    await expect(service.remove(alice, "project-1")).resolves.toBeUndefined();
  });

  it("lets a DEV read but not change, and shows a non-member and another tenant nothing", async () => {
    const input = { provider: provider("anthropic"), model: model("m1") };
    await expect(service.save(dev, "project-1", input)).rejects.toBeInstanceOf(AgentForbiddenError);
    await expect(service.remove(dev, "project-1")).rejects.toBeInstanceOf(AgentForbiddenError);
    await expect(service.get(stranger, "project-1")).rejects.toBeInstanceOf(AgentProjectNotFoundError);
    await expect(service.save(user("alice", "tenant-2"), "project-1", input)).rejects.toBeInstanceOf(AgentProjectNotFoundError);
    await expect(service.get(alice, "project-2")).rejects.toBeInstanceOf(AgentProjectNotFoundError);
    expect(secrets.size).toBe(0);
  });

  it("deletes the new key when saving fails, and still saves when the old key cannot be deleted", async () => {
    const failing: SecretStore = {
      put: (tenantId, plaintext) => secrets.put(tenantId, plaintext),
      get: (tenantId, ref) => secrets.get(tenantId, ref),
      delete: async () => {
        throw new Error("vault down");
      },
    };
    const flaky = build(failing);
    await flaky.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key() });
    const replaced = await flaky.save(alice, "project-1", { provider: provider("anthropic"), model: model("m1"), apiKey: key("sk-ant-second-key-6789") });
    expect(replaced).toMatchObject({ hasKey: true });
  });
});
