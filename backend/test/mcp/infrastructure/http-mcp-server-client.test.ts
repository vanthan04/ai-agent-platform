import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SafeHttpClient } from "../../../src/network";
import { HttpMcpServerClient, type DiscoveryLimits } from "../../../src/mcp/infrastructure/http-mcp-server-client";

interface Seen {
  method: string;
  rpc?: string;
  headers: http.IncomingHttpHeaders;
}

interface Behaviour {
  requireToken?: string;
  session?: string;
  sse?: boolean;
  version?: string;
  pages?: unknown[][];
  initializeStatus?: number;
  initializeRpcError?: boolean;
  initializeBody?: string;
  contentType?: string;
  wrongId?: boolean;
  deleteStatus?: number;
  delayMs?: number;
  bigBody?: number;
  redirectTo?: string;
  secretInErrors?: string;
}

const running: http.Server[] = [];

async function startFake(behaviour: Behaviour = {}): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const rpc = raw === "" ? undefined : (JSON.parse(raw) as { id?: number; method: string; params?: { cursor?: string } });
      seen.push({ method: req.method ?? "", rpc: rpc?.method, headers: req.headers });
      const reply = (status: number, body: string, type = "application/json", extra: Record<string, string> = {}): void => {
        res.writeHead(status, { "content-type": type, ...extra });
        res.end(body);
      };
      const rpcResult = (id: number | undefined, result: unknown): string => {
        const message = JSON.stringify({ jsonrpc: "2.0", id: behaviour.wrongId ? 999 : id, result });
        return behaviour.sse ? `event: ping\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\n\nevent: message\ndata: ${message}\n\n` : message;
      };
      const type = behaviour.contentType ?? (behaviour.sse ? "text/event-stream" : "application/json");
      const run = (): void => {
        if (behaviour.redirectTo) return reply(302, "", "text/plain", { location: behaviour.redirectTo });
        if (behaviour.requireToken !== undefined && req.headers["authorization"] !== `Bearer ${behaviour.requireToken}`) {
          return reply(401, behaviour.secretInErrors ?? "unauthorized");
        }
        if (req.method === "DELETE") return reply(behaviour.deleteStatus ?? 200, "");
        if (behaviour.bigBody) return reply(200, "x".repeat(behaviour.bigBody));
        switch (rpc?.method) {
          case "initialize": {
            if (behaviour.initializeStatus) return reply(behaviour.initializeStatus, behaviour.secretInErrors ?? "boom");
            if (behaviour.initializeBody !== undefined) return reply(200, behaviour.initializeBody, type);
            if (behaviour.initializeRpcError) {
              return reply(200, JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: behaviour.secretInErrors ?? "nope" } }));
            }
            const extra: Record<string, string> = behaviour.session === undefined ? {} : { "mcp-session-id": behaviour.session };
            return reply(200, rpcResult(rpc.id, { protocolVersion: behaviour.version ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Fake", version: "9" } }), type, extra);
          }
          case "notifications/initialized":
            return reply(202, "");
          case "tools/list": {
            const pages = behaviour.pages ?? [[{ name: "echo", description: "Echoes" }]];
            const index = rpc.params?.cursor === undefined ? 0 : Number(rpc.params.cursor.replace("p", ""));
            const next = index + 1 < pages.length ? { nextCursor: `p${index + 1}` } : {};
            return reply(200, rpcResult(rpc.id, { tools: pages[index] ?? [], ...next }), type);
          }
          default:
            return reply(404, "");
        }
      };
      if (behaviour.delayMs) setTimeout(run, behaviour.delayMs);
      else run();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, seen };
}

afterEach(async () => {
  while (running.length > 0) {
    const server = running.pop();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

const LIMITS: DiscoveryLimits = { timeoutMs: 2_000, maxResponseBytes: 1_000_000, maxPages: 10, maxTools: 500 };
const local = (limits: Partial<DiscoveryLimits> = {}) => new HttpMcpServerClient(new SafeHttpClient({ protocol: "http:", allowNonPublic: true }), { ...LIMITS, ...limits });

describe("HttpMcpServerClient against a server that speaks MCP over HTTP", () => {
  it("initializes, tells the server it is ready, lists the tools and ends the session, in that order", async () => {
    const fake = await startFake({ session: "sess-123" });
    const result = await local().discover({ url: fake.url });
    expect(result).toEqual({
      ok: true,
      protocolVersion: "2025-06-18",
      server: { name: "Fake", version: "9" },
      tools: [{ name: "echo", description: "Echoes" }],
      skipped: 0,
      truncated: false,
    });
    expect(fake.seen.map((entry) => entry.rpc ?? entry.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "DELETE"]);
    expect(fake.seen[0]?.headers["mcp-session-id"]).toBeUndefined();
    expect(fake.seen[0]?.headers["accept"]).toContain("text/event-stream");
    for (const entry of fake.seen.slice(1)) {
      expect(entry.headers["mcp-session-id"]).toBe("sess-123");
      expect(entry.headers["mcp-protocol-version"]).toBe("2025-06-18");
    }
  });

  it("works with a server that answers in an event stream, and with a server that has no session", async () => {
    const fake = await startFake({ sse: true });
    const result = await local().discover({ url: fake.url });
    expect(result).toMatchObject({ ok: true, tools: [{ name: "echo" }] });
    expect(fake.seen.map((entry) => entry.rpc ?? entry.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("follows the pages of a long tool list", async () => {
    const fake = await startFake({ pages: [[{ name: "a" }, { name: "b" }], [{ name: "c" }], [{ name: "d" }]] });
    const result = await local().discover({ url: fake.url });
    expect(result).toMatchObject({ ok: true, truncated: false });
    if (result.ok) expect(result.tools.map((tool) => tool.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("stops at the limits and says the list is cut", async () => {
    const endless = await startFake({ pages: Array.from({ length: 20 }, (_, i) => [{ name: `t${i}` }]) });
    const byPages = await local({ maxPages: 3 }).discover({ url: endless.url });
    expect(byPages).toMatchObject({ ok: true, truncated: true });
    if (byPages.ok) expect(byPages.tools).toHaveLength(3);
    const many = await startFake({ pages: [Array.from({ length: 50 }, (_, i) => ({ name: `t${i}` }))] });
    const byTools = await local({ maxTools: 10 }).discover({ url: many.url });
    expect(byTools).toMatchObject({ ok: true, truncated: true });
    if (byTools.ok) expect(byTools.tools).toHaveLength(10);
  });

  it("counts tools without a usable name instead of failing", async () => {
    const fake = await startFake({ pages: [[{ name: "ok" }, { name: 5 }, "string", null, {}, { name: "" }, { description: "no name" }]] });
    const result = await local().discover({ url: fake.url });
    expect(result).toMatchObject({ ok: true, skipped: 6 });
    if (result.ok) expect(result.tools).toEqual([{ name: "ok", description: "" }]);
  });

  it("sends the token as a bearer header on every request, only when there is one", async () => {
    const protectedServer = await startFake({ requireToken: "tok-abc-123456", session: "s1" });
    expect(await local().discover({ url: protectedServer.url, bearerToken: "tok-abc-123456" })).toMatchObject({ ok: true });
    expect(protectedServer.seen.every((entry) => entry.headers["authorization"] === "Bearer tok-abc-123456")).toBe(true);
    const open = await startFake();
    await local().discover({ url: open.url });
    expect(open.seen.every((entry) => entry.headers["authorization"] === undefined)).toBe(true);
  });
});

describe("HttpMcpServerClient when something is wrong", () => {
  it("says unauthorized for 401 and 403, whatever the server wrote", async () => {
    const fake = await startFake({ requireToken: "right-token-123", secretInErrors: "internal-secret-xyz" });
    const result = await local().discover({ url: fake.url, bearerToken: "wrong-token-456" });
    expect(result).toEqual({ ok: false, failure: "unauthorized" });
    expect(JSON.stringify(result)).not.toContain("internal-secret-xyz");
    expect(JSON.stringify(result)).not.toContain("wrong-token-456");
    const forbidden = await startFake({ initializeStatus: 403 });
    expect(await local().discover({ url: forbidden.url })).toEqual({ ok: false, failure: "unauthorized" });
  });

  it("says bad_status for other error statuses and never repeats the body", async () => {
    const fake = await startFake({ initializeStatus: 500, secretInErrors: "stack trace with internal-secret-xyz" });
    const result = await local().discover({ url: fake.url });
    expect(result).toEqual({ ok: false, failure: "bad_status" });
  });

  it("says server_error when the server answers with a JSON-RPC error, without its message", async () => {
    const fake = await startFake({ initializeRpcError: true, secretInErrors: "internal-secret-xyz" });
    const result = await local().discover({ url: fake.url });
    expect(result).toEqual({ ok: false, failure: "server_error" });
  });

  it("says invalid_response for a body that is not what MCP sends", async () => {
    for (const behaviour of [
      { initializeBody: "<html>not json</html>" },
      { initializeBody: "{not json" },
      { initializeBody: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "latest" } }) },
      { initializeBody: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) },
      { initializeBody: JSON.stringify({ id: 1, result: { protocolVersion: "2025-06-18" } }) },
      { contentType: "text/html" },
      { wrongId: true },
      { sse: true, initializeBody: "event: message\ndata: not json\n\n" },
    ] satisfies Behaviour[]) {
      const fake = await startFake(behaviour);
      expect(await local().discover({ url: fake.url }), JSON.stringify(behaviour)).toEqual({ ok: false, failure: "invalid_response" });
    }
  });

  it("refuses a session id that could break a header when sent back", async () => {
    for (const session of ["has space", "tab\there", "x".repeat(300)]) {
      const fake = await startFake({ session });
      const result = await local().discover({ url: fake.url });
      expect(result, session).toEqual({ ok: false, failure: "invalid_response" });
      expect(fake.seen.map((entry) => entry.method)).toEqual(["POST"]);
    }
  });

  it("does not follow a redirect, so the token never reaches another place", async () => {
    const other = await startFake();
    const fake = await startFake({ redirectTo: other.url.replace("/mcp", "/steal") });
    const result = await local().discover({ url: fake.url, bearerToken: "secret-token-abcdef" });
    expect(result).toEqual({ ok: false, failure: "bad_status" });
    expect(other.seen).toEqual([]);
  });

  it("says response_too_large, timeout and unreachable in one word each", async () => {
    const big = await startFake({ bigBody: 5_000 });
    expect(await local({ maxResponseBytes: 1_000 }).discover({ url: big.url })).toEqual({ ok: false, failure: "response_too_large" });
    const slow = await startFake({ delayMs: 1_000 });
    expect(await local({ timeoutMs: 150 }).discover({ url: slow.url })).toEqual({ ok: false, failure: "timeout" });
    const closed = await startFake();
    const url = closed.url;
    await afterEachClose();
    expect(await local().discover({ url })).toEqual({ ok: false, failure: "unreachable" });
  });

  it("ignores a server that refuses to end the session", async () => {
    const fake = await startFake({ session: "s1", deleteStatus: 405 });
    expect(await local().discover({ url: fake.url })).toMatchObject({ ok: true });
  });
});

describe("HttpMcpServerClient as the app builds it (strict)", () => {
  it("never reaches a server on this machine, and never sends a request", async () => {
    const fake = await startFake();
    const strict = new HttpMcpServerClient(new SafeHttpClient({ protocol: "http:" }), LIMITS);
    expect(await strict.discover({ url: fake.url, bearerToken: "secret-token-abcdef" })).toEqual({ ok: false, failure: "blocked_address" });
    expect(fake.seen).toEqual([]);
    const production = new HttpMcpServerClient(new SafeHttpClient(), LIMITS);
    expect(await production.discover({ url: "https://169.254.169.254/latest" })).toEqual({ ok: false, failure: "blocked_address" });
    expect(await production.discover({ url: "https://localhost/mcp" })).toEqual({ ok: false, failure: "blocked_address" });
  });
});

async function afterEachClose(): Promise<void> {
  while (running.length > 0) {
    const server = running.pop();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
}
