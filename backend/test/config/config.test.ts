import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config";

describe("loadConfig", () => {
  it("uses safe local defaults: loopback host, dev auth, one fixed user", () => {
    expect(loadConfig({})).toMatchObject({
      nodeEnv: "development",
      port: 3001,
      host: "127.0.0.1",
      databaseUrl: undefined,
      auth: { mode: "dev", userId: "dev-user", tenantId: "default" },
    });
  });

  it("refuses to start in production while only dev authentication exists", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow("not allowed in production");
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow("not allowed in production");
  });

  it("reads the secrets key as base64 of 32 bytes and refuses any other length without printing it", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(loadConfig({}).secretsKey).toBeUndefined();
    expect(loadConfig({ SECRETS_ENCRYPTION_KEY: key }).secretsKey?.length).toBe(32);
    const bad = Buffer.alloc(16, 7).toString("base64");
    let message = "";
    try {
      loadConfig({ SECRETS_ENCRYPTION_KEY: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("SECRETS_ENCRYPTION_KEY");
    expect(message).not.toContain(bad);
  });

  it("names the invalid variables without printing their values", () => {
    let message = "";
    try {
      loadConfig({ PORT: "not-a-number-secret-123", AUTH_MODE: "none" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("PORT");
    expect(message).toContain("AUTH_MODE");
    expect(message).not.toContain("secret-123");
  });
});
