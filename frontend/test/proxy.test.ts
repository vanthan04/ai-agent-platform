import { describe, expect, it, vi } from "vitest";
import { backendBase, forward, targetFor } from "@/lib/proxy";

const BASE = "http://127.0.0.1:3001";

describe("targetFor", () => {
  it("forwards project and health paths with their query", () => {
    expect(targetFor(["projects", "p1", "runs"], "?limit=5", BASE)?.href).toBe(`${BASE}/projects/p1/runs?limit=5`);
    expect(targetFor(["health"], "", BASE)?.href).toBe(`${BASE}/health`);
  });

  it("refuses any other root", () => {
    expect(targetFor(["admin"], "", BASE)).toBeUndefined();
    expect(targetFor([], "", BASE)).toBeUndefined();
  });

  it.each([[".."], ["."], [""], ["a/b"], ["a\\b"], ["a\u0000b"]])("refuses the segment %j", (segment) => {
    expect(targetFor(["projects", segment], "", BASE)).toBeUndefined();
  });

  it("encodes a segment so it cannot change the path", () => {
    expect(targetFor(["projects", "a b?c#d"], "", BASE)?.pathname).toBe("/projects/a%20b%3Fc%23d");
  });
});

describe("backendBase", () => {
  it("defaults to the local backend and keeps only the origin", () => {
    expect(backendBase({})).toBe(BASE);
    expect(backendBase({ BACKEND_URL: "https://api.example.com/some/path" })).toBe("https://api.example.com");
  });

  it("refuses another scheme", () => {
    expect(() => backendBase({ BACKEND_URL: "file:///etc" })).toThrow();
  });
});

describe("forward", () => {
  const request = (method: string, headers: Record<string, string> = {}, body?: string): Request =>
    new Request("http://app.local/api/projects/p1/tasks?x=1", { method, headers, body });

  it("sends only the allowed headers and returns the answer without caching", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json", "set-cookie": "a=b" } }));
    const response = await forward(request("POST", { "content-type": "application/json", cookie: "secret", authorization: "Bearer x", "idempotency-key": "k1" }, "{}"), ["projects", "p1", "tasks"], { fetchImpl, base: BASE });

    const [target, init] = fetchImpl.mock.calls[0]!;
    expect(String(target)).toBe(`${BASE}/projects/p1/tasks?x=1`);
    const sent = new Headers(init?.headers);
    expect(sent.get("idempotency-key")).toBe("k1");
    expect(sent.get("content-type")).toBe("application/json");
    expect(sent.has("cookie")).toBe(false);
    expect(sent.has("authorization")).toBe(false);
    expect(init?.redirect).toBe("manual");
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("refuses an unknown method and an unlisted path without calling the backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect((await forward(request("OPTIONS"),["projects"], { fetchImpl, base: BASE })).status).toBe(405);
    expect((await forward(request("GET"), ["secrets"], { fetchImpl, base: BASE })).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await forward(request("POST", {}, "x".repeat(1_000_001)), ["projects"], { fetchImpl, base: BASE });
    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 502 when the backend cannot be reached or redirects", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect((await forward(request("GET"), ["projects"], { fetchImpl: down, base: BASE })).status).toBe(502);
    const redirect = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: "http://evil.example" } }));
    const response = await forward(request("GET"), ["projects"], { fetchImpl: redirect, base: BASE });
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes a 204 through without a body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const response = await forward(request("DELETE"), ["projects", "p1"], { fetchImpl, base: BASE });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
