import { describe, expect, it } from "vitest";
import { ConfigSchema, ProviderDescriptor } from "../../src/domain";

const jira = {
  id: "jira",
  displayName: "Jira",
  category: "input",
  version: "1.0.0",
  capabilities: ["read_issue"],
  configSchema: {
    fields: [
      { type: "string", key: "baseUrl", label: "Site URL", required: true },
      { type: "select", key: "auth", label: "Authentication", options: [{ value: "token", label: "API token" }, { value: "oauth", label: "OAuth" }] },
      { type: "secret", key: "token", label: "API token", visibleWhen: { field: "auth", equals: "token" } },
    ],
  },
  requiredPermissions: ["jira:read"],
  setupStatus: "not_configured",
  limitations: ["read only"],
};

describe("ProviderDescriptor", () => {
  it("accepts a complete descriptor and defaults `required` to false", () => {
    const parsed = ProviderDescriptor.parse(jira);
    expect(parsed.configSchema.fields[1]?.required).toBe(false);
  });

  it("accepts an input provider with no config fields", () => {
    expect(
      ProviderDescriptor.safeParse({ ...jira, id: "custom_prompt", configSchema: { fields: [] }, requiredPermissions: [], limitations: [] }).success,
    ).toBe(true);
  });

  it("rejects a bad id, version, category or setup status", () => {
    expect(ProviderDescriptor.safeParse({ ...jira, id: "Jira Cloud" }).success).toBe(false);
    expect(ProviderDescriptor.safeParse({ ...jira, version: "1.0" }).success).toBe(false);
    expect(ProviderDescriptor.safeParse({ ...jira, category: "database" }).success).toBe(false);
    expect(ProviderDescriptor.safeParse({ ...jira, setupStatus: "maybe" }).success).toBe(false);
  });
});

describe("ConfigSchema", () => {
  const field = (key: string, extra: Record<string, unknown> = {}) => ({ type: "string", key, label: key, ...extra });

  it("rejects a field type outside the allowed set, so a schema cannot carry code", () => {
    expect(ConfigSchema.safeParse({ fields: [{ type: "script", key: "run", label: "Run", source: "alert(1)" }] }).success).toBe(false);
    expect(ConfigSchema.safeParse({ fields: [{ type: "string", key: "a b", label: "x" }] }).success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    expect(ConfigSchema.safeParse({ fields: [field("a"), field("a")] }).success).toBe(false);
  });

  it("allows visibleWhen only toward another field of the same schema", () => {
    expect(ConfigSchema.safeParse({ fields: [field("a"), field("b", { visibleWhen: { field: "a", equals: "x" } })] }).success).toBe(true);
    expect(ConfigSchema.safeParse({ fields: [field("b", { visibleWhen: { field: "missing", equals: "x" } })] }).success).toBe(false);
    expect(ConfigSchema.safeParse({ fields: [field("b", { visibleWhen: { field: "b", equals: "x" } })] }).success).toBe(false);
  });

  it("rejects a select without options and a number whose min exceeds max", () => {
    expect(ConfigSchema.safeParse({ fields: [{ type: "select", key: "s", label: "s", options: [] }] }).success).toBe(false);
    expect(ConfigSchema.safeParse({ fields: [{ type: "number", key: "n", label: "n", min: 5, max: 1 }] }).success).toBe(false);
    expect(ConfigSchema.safeParse({ fields: [{ type: "number", key: "n", label: "n", min: 1, max: 5 }] }).success).toBe(true);
  });
});
