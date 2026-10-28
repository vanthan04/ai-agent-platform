import { describe, expect, it } from "vitest";
import { ApiKey, InvalidModelSettingsError, ModelBaseUrl, ModelName, ModelSettings, ModelProvider, PROVIDERS, providerInfo } from "../../../src/agent";
import { ProjectId, TenantId, UserId } from "../../../src/shared-kernel";
import { SecretRef } from "../../../src/vault";
import { NOW } from "../../support/time";

const base = { tenantId: TenantId.parse("tenant-1"), projectId: ProjectId.parse("project-1"), updatedBy: UserId.parse("alice"), now: NOW };
const ref = (value: string) => SecretRef.parse(value);
const claude = { provider: ModelProvider.parse("anthropic"), model: ModelName.parse("claude-sonnet-5-5") };
const gemini = { provider: ModelProvider.parse("gemini"), model: ModelName.parse("gemini-model") };
const custom = (url: string) => ({ provider: ModelProvider.parse("openai_compatible"), model: ModelName.parse("some-model"), baseUrl: ModelBaseUrl.parse(url) });

describe("value objects", () => {
  it("lists every provider once and knows which one needs an address", () => {
    expect(PROVIDERS.map((provider) => provider.id).sort()).toEqual(["anthropic", "gemini", "openai_compatible"]);
    expect(providerInfo(ModelProvider.parse("openai_compatible")).needsBaseUrl).toBe(true);
    expect(providerInfo(ModelProvider.parse("anthropic")).needsBaseUrl).toBe(false);
    expect(() => ModelProvider.parse("other")).toThrow();
  });

  it.each(["claude-sonnet-5-5", "gemini-2.5-pro", "org/model:latest", "m"])("accepts the model name %s", (name) => {
    expect(ModelName.parse(name)).toBe(name);
  });

  it.each(["", " ", "-model", "a b", "a;b", "a\nb", "x".repeat(101)])("refuses the model name %j", (name) => {
    expect(() => ModelName.parse(name)).toThrow();
  });

  it.each(["http://api.example.com", "https://127.0.0.1/v1", "https://localhost/v1", "https://u:p@api.example.com", "https://api.example.com/v1?key=x", "https://api.internal/v1"])(
    "refuses the address %s",
    (url) => {
      expect(() => ModelBaseUrl.parse(url)).toThrow();
    },
  );

  it("accepts a public https address with a path", () => {
    expect(ModelBaseUrl.parse("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("accepts a printable key and refuses spaces, control characters and short keys", () => {
    expect(ApiKey.parse("sk-test-1234567890")).toBe("sk-test-1234567890");
    for (const key of ["short", "has space 12345", "line\nbreak12345", "x".repeat(513)]) expect(() => ApiKey.parse(key)).toThrow();
  });
});

describe("ModelSettings", () => {
  it("needs an address for an OpenAI-compatible server and refuses one for a provider with a fixed address", () => {
    expect(() => ModelSettings.create({ ...base, choice: { provider: ModelProvider.parse("openai_compatible"), model: ModelName.parse("m") }, secretRef: undefined })).toThrow(
      InvalidModelSettingsError,
    );
    expect(() => ModelSettings.create({ ...base, choice: { ...claude, baseUrl: ModelBaseUrl.parse("https://api.example.com") }, secretRef: undefined })).toThrow(
      InvalidModelSettingsError,
    );
    expect(ModelSettings.create({ ...base, choice: custom("https://api.example.com/v1"), secretRef: undefined }).provider).toBe("openai_compatible");
  });

  it("keeps the key when only the model changes", () => {
    const settings = ModelSettings.create({ ...base, choice: claude, secretRef: ref("secret-1") });
    const changed = settings.withChoice({ ...claude, model: ModelName.parse("claude-opus-5-5") }, undefined, UserId.parse("bob"), "2026-10-28T00:00:00Z");
    expect(changed.secretRef).toBe("secret-1");
    expect(changed.toProps()).toMatchObject({ model: "claude-opus-5-5", updatedBy: "bob", updatedAt: "2026-10-28T00:00:00Z" });
  });

  it("drops the key when the provider changes, so a key is never sent to a server it was not given for", () => {
    const settings = ModelSettings.create({ ...base, choice: claude, secretRef: ref("secret-1") });
    const changed = settings.withChoice(gemini, undefined, base.updatedBy, NOW);
    expect(changed.secretRef).toBeUndefined();
    expect(changed.hasKey).toBe(false);
  });

  it("drops the key when the address of an OpenAI-compatible server changes, and keeps it when it does not", () => {
    const settings = ModelSettings.create({ ...base, choice: custom("https://a.example.com/v1"), secretRef: ref("secret-1") });
    expect(settings.withChoice(custom("https://b.example.com/v1"), undefined, base.updatedBy, NOW).secretRef).toBeUndefined();
    expect(settings.withChoice(custom("https://a.example.com/v1"), undefined, base.updatedBy, NOW).secretRef).toBe("secret-1");
  });

  it("uses a new key when one is given, even with a new provider", () => {
    const settings = ModelSettings.create({ ...base, choice: claude, secretRef: ref("secret-1") });
    expect(settings.withChoice(gemini, ref("secret-2"), base.updatedBy, NOW).secretRef).toBe("secret-2");
  });
});
