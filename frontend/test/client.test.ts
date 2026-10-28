import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, describeError } from "@/lib/api/client";

const reply = (status: number, body?: unknown): void => {
  vi.stubGlobal("fetch", vi.fn(async () => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } }))));
};

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("returns the parsed body and sends JSON through the /api proxy", async () => {
    reply(200, { id: "p1" });
    await expect(api("POST", "/projects", { body: { name: "A" }, headers: { "Idempotency-Key": "k" } })).resolves.toEqual({ id: "p1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/projects");
    expect(init?.body).toBe('{"name":"A"}');
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("k");
  });

  it("returns undefined for 204", async () => {
    reply(204);
    await expect(api("DELETE", "/projects/p1")).resolves.toBeUndefined();
  });

  it("raises an ApiError with the status and the field problems", async () => {
    reply(400, { message: "invalid request", issues: [{ path: "name", message: "too short" }, { nope: 1 }] });
    const error = await api("POST", "/projects", { body: {} }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(describeError(error)).toBe("The request was not accepted. Check the fields and try again. name: too short");
  });

  it("uses the server's message when it is specific, a fallback otherwise", async () => {
    reply(409, { message: "someone saved first" });
    expect(describeError(await api("PUT", "/x").catch((caught: unknown) => caught))).toBe("someone saved first");
    reply(500, "not json");
    expect(describeError(await api("GET", "/x").catch((caught: unknown) => caught))).toBe("The server answered 500.");
  });

  it("reports status 0 when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const error = await api("GET", "/x").catch((caught: unknown) => caught);
    expect((error as ApiError).status).toBe(0);
  });

  it("describes an unknown error without leaking it", () => {
    expect(describeError(new Error("secret detail"))).toBe("Something went wrong.");
  });
});
