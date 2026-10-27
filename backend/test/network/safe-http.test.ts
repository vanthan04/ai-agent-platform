import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OutboundError, SafeHttpClient, createSafeLookup, type OutboundFailure } from "../../src/network";

let server: http.Server;
let port = 0;
let hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      switch (req.url) {
        case "/echo":
          res.writeHead(200, { "content-type": "text/plain", "x-seen-auth": String(req.headers["authorization"] ?? ""), "x-seen-length": String(req.headers["content-length"]) });
          return void res.end(`you sent: ${body}`);
        case "/big":
          res.writeHead(200);
          return void res.end("x".repeat(5_000));
        case "/slow":
          return void setTimeout(() => res.end("late"), 1_000);
        case "/redirect":
          res.writeHead(302, { location: "/echo" });
          return void res.end();
        default:
          res.writeHead(404);
          return void res.end("nope");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits = [];
});

const failure = async (promise: Promise<unknown>): Promise<OutboundFailure | "no failure"> => {
  try {
    await promise;
    return "no failure";
  } catch (error) {
    if (error instanceof OutboundError) return error.failure;
    throw error;
  }
};

/** Talks plain http to this machine: what the tests need; the app never builds a client like this. */
const local = new SafeHttpClient({ protocol: "http:", allowNonPublic: true });
const base = () => `http://127.0.0.1:${port}`;
const request = (path: string, extra: Partial<Parameters<SafeHttpClient["send"]>[0]> = {}) =>
  local.send({ url: `${base()}${path}`, method: "POST", headers: { "content-type": "text/plain" }, body: "hello", timeoutMs: 2_000, maxResponseBytes: 1_000_000, ...extra });

describe("SafeHttpClient talking to a server it is allowed to reach", () => {
  it("sends the body and headers and returns status, headers and text", async () => {
    const response = await request("/echo", { headers: { "content-type": "text/plain", authorization: "Bearer abc" } });
    expect(response.status).toBe(200);
    expect(response.body).toBe("you sent: hello");
    expect(response.headers["x-seen-auth"]).toBe("Bearer abc");
    expect(response.headers["x-seen-length"]).toBe("5");
  });

  it("returns an error status as a status, not as a failure", async () => {
    expect((await request("/missing")).status).toBe(404);
  });

  it("stops reading when the answer is bigger than the limit", async () => {
    expect(await failure(request("/big", { maxResponseBytes: 1_000 }))).toBe("response_too_large");
    expect((await request("/big", { maxResponseBytes: 10_000 })).body).toHaveLength(5_000);
  });

  it("gives up at the deadline", async () => {
    expect(await failure(request("/slow", { timeoutMs: 150 }))).toBe("timeout");
  });

  it("does not follow a redirect, so a token is never sent on to another place", async () => {
    const response = await request("/redirect", { headers: { authorization: "Bearer abc" } });
    expect(response.status).toBe(302);
    expect(hits).toEqual(["POST /redirect"]);
  });

  it("reports an unreachable server in one word", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await failure(local.send({ url: `http://127.0.0.1:${closedPort}/`, method: "GET", headers: {}, timeoutMs: 1_000, maxResponseBytes: 1_000 }))).toBe("unreachable");
  });

  it("refuses a URL of the wrong scheme, with credentials, or that is not a URL", async () => {
    for (const url of [`https://127.0.0.1:${port}/echo`, `http://user:pw@127.0.0.1:${port}/echo`, "not a url", ""]) {
      expect(await failure(local.send({ url, method: "GET", headers: {}, timeoutMs: 1_000, maxResponseBytes: 1_000 })), url).toBe("invalid_request");
    }
    expect(hits).toEqual([]);
  });

  it("refuses a header value that could split the request", async () => {
    expect(await failure(request("/echo", { headers: { authorization: "Bearer abc\r\nX-Injected: 1" } }))).toBe("invalid_request");
    expect(hits).toEqual([]);
  });
});

describe("SafeHttpClient as the app builds it (strict)", () => {
  const strictHttp = new SafeHttpClient({ protocol: "http:" });
  const send = (client: SafeHttpClient, url: string) => client.send({ url, method: "GET", headers: {}, timeoutMs: 1_000, maxResponseBytes: 1_000 });

  it("never connects to an IP address that is not public, and never even sends the request", async () => {
    for (const url of [`http://127.0.0.1:${port}/echo`, `http://[::1]:${port}/echo`, "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://192.168.1.1/"]) {
      expect(await failure(send(strictHttp, url)), url).toBe("blocked_address");
    }
    expect(hits).toEqual([]);
  });

  it("never connects to a name that resolves to this machine", async () => {
    expect(await failure(send(strictHttp, `http://localhost:${port}/echo`))).toBe("blocked_address");
    expect(hits).toEqual([]);
  });

  it("uses https by default and so refuses http", async () => {
    expect(await failure(send(new SafeHttpClient(), `http://example.com/`))).toBe("invalid_request");
  });

  it("refuses a name whose answer mixes a public and a private address, or is private only (DNS rebinding)", async () => {
    const mixed = new SafeHttpClient({ protocol: "http:", lookup: createSafeLookup({ resolver: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] }) });
    const rebound = new SafeHttpClient({ protocol: "http:", lookup: createSafeLookup({ resolver: async () => [{ address: "127.0.0.1", family: 4 }] }) });
    expect(await failure(send(mixed, `http://mcp.example.com:${port}/echo`))).toBe("blocked_address");
    expect(await failure(send(rebound, `http://mcp.example.com:${port}/echo`))).toBe("blocked_address");
    expect(hits).toEqual([]);
  });

  it("connects through the checked lookup when a name resolves to a public address (here the test stands in for it)", async () => {
    const client = new SafeHttpClient({ protocol: "http:", allowNonPublic: true, lookup: createSafeLookup({ resolver: async () => [{ address: "127.0.0.1", family: 4 }], allowNonPublic: true }) });
    const response = await client.send({ url: `http://mcp.example.com:${port}/echo`, method: "POST", headers: {}, body: "via name", timeoutMs: 1_000, maxResponseBytes: 1_000 });
    expect(response.body).toBe("you sent: via name");
  });
});
