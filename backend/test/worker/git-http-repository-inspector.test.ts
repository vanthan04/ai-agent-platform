import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SafeHttpClient } from "../../src/network";
import { GitHttpRepositoryInspector } from "../../src/worker/infrastructure/git-http-repository-inspector";

const SHA = (n: number): string => n.toString(16).padStart(40, "0");

/** One pkt-line: four hex digits of length (counting themselves), then the text. */
const pkt = (text: string): string => (Buffer.byteLength(text) + 4).toString(16).padStart(4, "0") + text;

/** What a git server answers to `GET info/refs?service=git-upload-pack`. */
const advertisement = (refs: [string, string][], capabilities = "multi_ack thin-pack side-band-64k ofs-delta agent=git/2.43.0"): string =>
  pkt("# service=git-upload-pack\n") + "0000" + refs.map(([sha, name], index) => pkt(`${sha} ${name}${index === 0 ? `\0${capabilities}` : ""}\n`)).join("") + "0000";

interface Behaviour {
  status?: number;
  contentType?: string;
  body?: string;
  delayMs?: number;
  location?: string;
}

const running: http.Server[] = [];
const seen: { url: string; headers: http.IncomingHttpHeaders }[] = [];

async function startFake(behaviour: Behaviour): Promise<string> {
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const answer = (): void => {
      if (behaviour.location) {
        res.writeHead(301, { location: behaviour.location });
        return void res.end();
      }
      res.writeHead(behaviour.status ?? 200, { "content-type": behaviour.contentType ?? "application/x-git-upload-pack-advertisement" });
      res.end(behaviour.body ?? "");
    };
    if (behaviour.delayMs) setTimeout(answer, behaviour.delayMs);
    else answer();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  seen.length = 0;
  while (running.length > 0) {
    const server = running.pop();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

const local = (limits = { timeoutMs: 2_000, maxResponseBytes: 1_000_000 }) =>
  new GitHttpRepositoryInspector(new SafeHttpClient({ protocol: "http:", allowNonPublic: true }), limits, "http:");

const HEADS: [string, string][] = [
  [SHA(1), "HEAD"],
  [SHA(2), "refs/heads/develop"],
  [SHA(3), "refs/heads/develop-2"],
  [SHA(4), "refs/heads/release/1.0"],
  [SHA(5), "refs/heads/release/1.0.1"],
  [SHA(6), "refs/heads/main"],
  [SHA(7), "refs/tags/v1"],
  [SHA(8), "refs/tags/v1^{}"],
  [SHA(9), "refs/pull/12/head"],
];

describe("GitHttpRepositoryInspector", () => {
  it("reads the commit a branch points at, matching the whole name and nothing else", async () => {
    const base = await startFake({ body: advertisement(HEADS) });
    const inspector = local();
    expect(await inspector.branchHead({ url: `${base}/org/shop.git`, branch: "develop" })).toEqual({ ok: true, commitSha: SHA(2) });
    expect(await inspector.branchHead({ url: `${base}/org/shop.git`, branch: "develop-2" })).toEqual({ ok: true, commitSha: SHA(3) });
    expect(await inspector.branchHead({ url: `${base}/org/shop.git`, branch: "release/1.0" })).toEqual({ ok: true, commitSha: SHA(4) });
    expect(await inspector.branchHead({ url: `${base}/org/shop.git`, branch: "release/1.0.1" })).toEqual({ ok: true, commitSha: SHA(5) });
  });

  it("does not take a tag, a pull request ref or HEAD for a branch, nor part of a branch name for the branch", async () => {
    const base = await startFake({ body: advertisement(HEADS) });
    const inspector = local();
    for (const branch of ["v1", "12", "HEAD", "release", "develo", "heads/develop", "refs/heads/develop", "release/1.0.1/x", "main "]) {
      expect(await inspector.branchHead({ url: `${base}/r`, branch }), branch).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("finds the branch that is the first ref, where the capabilities follow after a NUL", async () => {
    const base = await startFake({ body: advertisement([[SHA(2), "refs/heads/develop"], [SHA(6), "refs/heads/main"]]) });
    expect(await local().branchHead({ url: `${base}/r`, branch: "develop" })).toEqual({ ok: true, commitSha: SHA(2) });
  });

  it("reads a repository that uses 64-character commit ids", async () => {
    const sha256 = "ab".repeat(32);
    const base = await startFake({ body: advertisement([[sha256, "HEAD"], [sha256, "refs/heads/main"]]) });
    expect(await local().branchHead({ url: `${base}/r`, branch: "main" })).toEqual({ ok: true, commitSha: sha256 });
  });

  it("says not_found for an empty repository", async () => {
    const base = await startFake({ body: pkt("# service=git-upload-pack\n") + "0000" + pkt(`${"0".repeat(40)} capabilities^{}\0multi_ack\n`) + "0000" });
    expect(await local().branchHead({ url: `${base}/r`, branch: "main" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("asks for the advertisement of the repository path, with or without .git or a trailing slash, sending no credentials", async () => {
    const base = await startFake({ body: advertisement(HEADS) });
    for (const url of [`${base}/org/shop.git`, `${base}/org/shop`, `${base}/org/shop/`, `${base}/org/shop.git?token=abc#frag`]) {
      await local().branchHead({ url, branch: "develop" });
    }
    expect(seen.map((entry) => entry.url)).toEqual([
      "/org/shop.git/info/refs?service=git-upload-pack",
      "/org/shop/info/refs?service=git-upload-pack",
      "/org/shop/info/refs?service=git-upload-pack",
      "/org/shop.git/info/refs?service=git-upload-pack",
    ]);
    for (const entry of seen) {
      expect(entry.headers["accept"]).toBe("application/x-git-upload-pack-advertisement");
      expect(entry.headers["user-agent"]).toMatch(/^git\//);
      expect(entry.headers["authorization"]).toBeUndefined();
      expect(entry.headers["cookie"]).toBeUndefined();
    }
  });

  it("treats 401, 403 and 404 as not found, because a private repository looks the same as a missing one", async () => {
    for (const status of [401, 403, 404]) {
      const base = await startFake({ status, body: "Authentication required" });
      expect(await local().branchHead({ url: `${base}/r`, branch: "main" }), String(status)).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("says unreachable for a server error and never follows a redirect", async () => {
    const error = await startFake({ status: 500, body: "internal-secret-xyz" });
    expect(await local().branchHead({ url: `${error}/r`, branch: "main" })).toEqual({ ok: false, reason: "unreachable" });
    const target = await startFake({ body: advertisement(HEADS) });
    const redirecting = await startFake({ location: `${target}/elsewhere` });
    expect(await local().branchHead({ url: `${redirecting}/r`, branch: "develop" })).toEqual({ ok: false, reason: "unreachable" });
    expect(seen.map((entry) => entry.url)).not.toContain("/elsewhere");
  });

  it("says invalid_response for an answer that is not a git ref advertisement", async () => {
    const html = await startFake({ contentType: "text/html", body: "<html>sign in</html>" });
    expect(await local().branchHead({ url: `${html}/r`, branch: "main" })).toEqual({ ok: false, reason: "invalid_response" });
    const plain = await startFake({ contentType: "text/plain", body: advertisement(HEADS) });
    expect(await local().branchHead({ url: `${plain}/r`, branch: "develop" })).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("says too_large and timeout in one word each", async () => {
    const big = await startFake({ body: advertisement(HEADS) });
    expect(await local({ timeoutMs: 2_000, maxResponseBytes: 100 }).branchHead({ url: `${big}/r`, branch: "develop" })).toEqual({ ok: false, reason: "too_large" });
    const slow = await startFake({ body: advertisement(HEADS), delayMs: 1_000 });
    expect(await local({ timeoutMs: 150, maxResponseBytes: 1_000_000 }).branchHead({ url: `${slow}/r`, branch: "develop" })).toEqual({ ok: false, reason: "timeout" });
  });

  it("says unsupported for an address that is not https and sends nothing", async () => {
    const strict = new GitHttpRepositoryInspector(new SafeHttpClient());
    for (const url of ["git@github.com:org/shop.git", "ssh://git@host.example/org/shop.git", "http://github.com/org/shop.git", "not a url", ""]) {
      expect(await strict.branchHead({ url, branch: "main" }), url).toEqual({ ok: false, reason: "unsupported" });
    }
    expect(seen).toEqual([]);
  });

  it("never connects to this machine or to a private address, when built as the app builds it", async () => {
    const base = await startFake({ body: advertisement(HEADS) });
    const strict = new GitHttpRepositoryInspector(new SafeHttpClient(), undefined, "http:");
    void strict;
    const production = new GitHttpRepositoryInspector(new SafeHttpClient());
    expect(await production.branchHead({ url: "https://localhost/org/shop.git", branch: "main" })).toEqual({ ok: false, reason: "blocked_address" });
    expect(await production.branchHead({ url: "https://127.0.0.1/org/shop.git", branch: "main" })).toEqual({ ok: false, reason: "blocked_address" });
    expect(await production.branchHead({ url: "https://169.254.169.254/org/shop.git", branch: "main" })).toEqual({ ok: false, reason: "blocked_address" });
    expect(await new GitHttpRepositoryInspector(new SafeHttpClient({ protocol: "http:" }), undefined, "http:").branchHead({ url: `${base}/r`, branch: "develop" })).toEqual({ ok: false, reason: "blocked_address" });
    expect(seen).toEqual([]);
  });
});
