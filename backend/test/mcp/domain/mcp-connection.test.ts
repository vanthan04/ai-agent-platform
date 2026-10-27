import { describe, expect, it } from "vitest";
import { BearerToken, McpConnection, McpConnectionId, McpConnectionName, McpServerUrl } from "../../../src/mcp";
import { ProjectId, TenantId, UserId } from "../../../src/shared-kernel";
import { SecretRef } from "../../../src/vault";
import { NOW } from "../../support/time";

describe("McpServerUrl (D11: a remote https server)", () => {
  it("accepts an https address of a named public server, with a path or port", () => {
    for (const ok of ["https://mcp.example.com", "https://mcp.example.com/sse", "https://mcp.example.com:8443/v1/mcp", "https://api.vendor.io/mcp"]) {
      expect(McpServerUrl.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses http, other schemes and anything that is not an address", () => {
    for (const bad of ["http://mcp.example.com", "ftp://mcp.example.com", "file:///etc/passwd", "javascript:alert(1)", "mcp.example.com", "not a url", ""]) {
      expect(McpServerUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("refuses an IP address in every notation, so private and link-local ranges are out of reach", () => {
    for (const bad of [
      "https://127.0.0.1/",
      "https://10.0.0.5/mcp",
      "https://192.168.1.10/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://2130706433/",
      "https://0x7f.0.0.1/",
      "https://8.8.8.8/",
    ]) {
      expect(McpServerUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("refuses single-label and internal names", () => {
    for (const bad of ["https://localhost/", "https://mcp/", "https://printer.local/", "https://metadata.google.internal/", "https://app.localhost/", "https://wiki.corp/", "https://nas.lan/"]) {
      expect(McpServerUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("refuses credentials, a query and a fragment, where a token could leak", () => {
    for (const bad of ["https://user:pw@mcp.example.com/", "https://token@mcp.example.com/", "https://mcp.example.com/?token=abc", "https://mcp.example.com/#abc"]) {
      expect(McpServerUrl.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("connection name and bearer token", () => {
  it("names a connection with a short lower-case slug, which keeps `<name>:<tool>` unambiguous", () => {
    for (const ok of ["github", "jira-cloud", "a1"]) expect(McpConnectionName.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["GitHub", "1github", "git hub", "git:hub", "a".repeat(33), "-x", ""]) {
      expect(McpConnectionName.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("takes a token of printable characters without spaces and refuses anything that could break a header", () => {
    expect(BearerToken.safeParse("ghp_abcdefghijklmnop1234").success).toBe(true);
    expect(BearerToken.safeParse("eyJhbGciOi.eyJzdWIi.sig-_=").success).toBe(true);
    for (const bad of ["short", "has space in it", "line\nbreak-123", "tab\there-123", "ünïcode-token-123", "x".repeat(4_097), ""]) {
      expect(BearerToken.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("McpConnection", () => {
  const base = {
    id: McpConnectionId.parse("mcp-1"),
    tenantId: TenantId.parse("tenant-1"),
    projectId: ProjectId.parse("project-1"),
    name: McpConnectionName.parse("github"),
    url: McpServerUrl.parse("https://mcp.example.com/sse"),
    createdBy: UserId.parse("alice"),
    now: NOW,
  };

  it("needs no sign-in without a secret and uses bearer auth with one", () => {
    const open = McpConnection.create({ ...base, secretRef: undefined });
    expect(open.auth).toBe("none");
    const signedIn = McpConnection.create({ ...base, secretRef: SecretRef.parse("secret-1") });
    expect(signedIn.auth).toBe("bearer");
  });

  it("swaps the secret in a copy and leaves the original alone", () => {
    const original = McpConnection.create({ ...base, secretRef: undefined });
    const later = "2026-10-27T12:00:00Z";
    const updated = original.withSecret(SecretRef.parse("secret-2"), later);
    expect(updated.secretRef).toBe("secret-2");
    expect(updated.toProps()).toMatchObject({ createdAt: NOW, updatedAt: later });
    expect(original.secretRef).toBeUndefined();
  });
});
