import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../../../src/identity";
import {
  BearerToken,
  McpConnectionName,
  McpConnectionNotFoundError,
  McpConnectionsService,
  McpForbiddenError,
  McpProjectNotFoundError,
  McpRateLimitedError,
  McpServerUrl,
  type McpDiscovery,
  type McpServerClient,
  type ProjectAccess,
  type RateLimiter,
} from "../../../src/mcp";
import { InMemoryRateLimiter } from "../../../src/mcp/infrastructure/in-memory-rate-limiter";
import { Role, TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryMcpConnectionRepository } from "../../support/in-memory-mcp-connection.repository";
import { InMemorySecretStore } from "../../support/in-memory-secret-store";
import { NOW } from "../../support/time";

const user = (userId: string, tenantId = "tenant-1"): AuthUser => ({ userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) });
const alice = user("alice");
const dev = user("dev");
const stranger = user("stranger");
const TOKEN = "ghp_supersecrettoken123";
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const access = (roles: Record<string, Role>): ProjectAccess => ({
  async roleOf(who, projectId) {
    return projectId === "project-1" ? roles[`${who.tenantId}/${who.userId}`] : undefined;
  },
});

class FakeClient implements McpServerClient {
  calls: { url: string; bearerToken?: string }[] = [];
  result: McpDiscovery = { ok: true, protocolVersion: "2025-06-18", server: { name: "Demo", version: "1.2.3" }, tools: [], skipped: 0, truncated: false };

  async discover(target: { url: string; bearerToken?: string }): Promise<McpDiscovery> {
    this.calls.push(target);
    return this.result;
  }
}

const isPlain = (text: string): boolean => Array.from(text).every((character) => {
  const code = character.codePointAt(0) ?? 0;
  return code >= 32 && !(code >= 127 && code <= 159);
});

describe("McpConnectionsService.test", () => {
  let repo: InMemoryMcpConnectionRepository;
  let secrets: InMemorySecretStore;
  let client: FakeClient;
  let limiter: RateLimiter;
  let service: McpConnectionsService;
  let open: string;
  let signedIn: string;

  const build = (store: InMemorySecretStore, roles: Record<string, Role>) =>
    new McpConnectionsService(repo, access(roles), store, { now: () => NOW }, client, { tryAcquire: (key) => limiter.tryAcquire(key) });

  beforeEach(async () => {
    repo = new InMemoryMcpConnectionRepository();
    secrets = new InMemorySecretStore();
    client = new FakeClient();
    limiter = { tryAcquire: () => true };
    service = build(secrets, { "tenant-1/alice": "PL", "tenant-1/dev": "DEV" });
    open = (await service.create(alice, "project-1", { name: McpConnectionName.parse("docs"), url: McpServerUrl.parse("https://docs.example.com/mcp") })).id;
    signedIn = (
      await service.create(alice, "project-1", {
        name: McpConnectionName.parse("github"),
        url: McpServerUrl.parse("https://mcp.example.com/sse"),
        bearerToken: BearerToken.parse(TOKEN),
      })
    ).id;
  });

  it("lists the tools of a server that needs no sign-in, sending no token", async () => {
    client.result = { ok: true, protocolVersion: "2025-06-18", server: { name: "Docs", version: "2.0" }, tools: [{ name: "search_docs", description: "Search the docs" }], skipped: 0, truncated: false };
    expect(await service.test(alice, "project-1", open)).toEqual({
      ok: true,
      testedAt: NOW,
      protocolVersion: "2025-06-18",
      server: { name: "Docs", version: "2.0" },
      tools: [{ name: "search_docs", description: "Search the docs" }],
      skippedTools: 0,
      truncated: false,
    });
    expect(client.calls).toEqual([{ url: "https://docs.example.com/mcp" }]);
  });

  it("sends the stored token to the server of that connection and never lets it into the result", async () => {
    const result = await service.test(alice, "project-1", signedIn);
    expect(client.calls).toEqual([{ url: "https://mcp.example.com/sse", bearerToken: TOKEN }]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("treats what the server says as untrusted: cuts text, strips control characters, drops bad and repeated names", async () => {
    client.result = {
      ok: true,
      protocolVersion: "2025-06-18",
      server: { name: `Evil\nServer${BEL}`.padEnd(200, "x"), version: "1.0" },
      tools: [
        { name: "good_tool", description: `line one\nline two\t${ESC}[31mred${ESC}[0m   spaced` },
        { name: "good_tool", description: "a repeat" },
        { name: "has space", description: "x" },
        { name: "x".repeat(65), description: "x" },
        { name: "../etc/passwd", description: "x" },
        { name: "long_description", description: "d".repeat(1_000) },
        { name: "with:colon", description: "x" },
      ],
      skipped: 2,
      truncated: true,
    };
    const result = await service.test(alice, "project-1", open);
    if (!result.ok) throw new Error("expected a result");
    expect(result.tools.map((tool) => tool.name)).toEqual(["good_tool", "long_description"]);
    expect(result.tools[0]?.description).toBe("line one line two [31mred [0m spaced");
    expect(result.tools[1]?.description).toHaveLength(300);
    expect(result.server.name).toHaveLength(100);
    expect(result.server.name).toMatch(/^Evil Server x+$/);
    expect(result.skippedTools).toBe(2 + 5);
    expect(result.truncated).toBe(true);
    expect(result.tools.every((tool) => isPlain(tool.description))).toBe(true);
    expect(isPlain(result.server.name ?? "")).toBe(true);
  });

  it("reports a failure as a result with one word, never what the server said", async () => {
    for (const failure of ["unreachable", "blocked_address", "timeout", "response_too_large", "unauthorized", "bad_status", "invalid_response", "server_error"] as const) {
      client.result = { ok: false, failure };
      expect(await service.test(alice, "project-1", open)).toEqual({ ok: false, testedAt: NOW, error: failure });
    }
  });

  it("says so when the vault can no longer give back the token (for example after a key change), without calling the server", async () => {
    const withoutTheToken = build(new InMemorySecretStore(), { "tenant-1/alice": "PL" });
    expect(await withoutTheToken.test(alice, "project-1", signedIn)).toEqual({ ok: false, testedAt: NOW, error: "token_unavailable" });
    expect(client.calls).toEqual([]);
  });

  it("lets only a PM or PL test, and shows a non-member nothing", async () => {
    await expect(service.test(dev, "project-1", open)).rejects.toBeInstanceOf(McpForbiddenError);
    await expect(service.test(stranger, "project-1", open)).rejects.toBeInstanceOf(McpProjectNotFoundError);
    await expect(service.test(user("alice", "tenant-2"), "project-1", open)).rejects.toBeInstanceOf(McpProjectNotFoundError);
    await expect(service.test(alice, "project-1", "unknown")).rejects.toBeInstanceOf(McpConnectionNotFoundError);
    expect(client.calls).toEqual([]);
  });

  it("limits the tests of a project and counts only the ones that were allowed to try", async () => {
    const real = new InMemoryRateLimiter(2, 60_000, () => 0);
    limiter = { tryAcquire: (key) => real.tryAcquire(key) };
    await service.test(alice, "project-1", open);
    await service.test(alice, "project-1", open);
    await expect(service.test(alice, "project-1", open)).rejects.toBeInstanceOf(McpRateLimitedError);
    expect(client.calls).toHaveLength(2);
    await expect(service.test(dev, "project-1", open)).rejects.toBeInstanceOf(McpForbiddenError);
  });
});

describe("InMemoryRateLimiter", () => {
  it("allows a few attempts per window per key and recovers as time passes", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(3, 1_000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.tryAcquire("a"))).toEqual([true, true, true, false]);
    expect(limiter.tryAcquire("b")).toBe(true);
    now = 999;
    expect(limiter.tryAcquire("a")).toBe(false);
    now = 1_000;
    expect(limiter.tryAcquire("a")).toBe(true);
  });
});
