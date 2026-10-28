import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnection, PolicyView as PolicyData, Project, Run, Task } from "@/lib/api/types";
import { groupRuns } from "@/lib/execution";
import { ProjectProvider } from "@/components/project/ProjectContext";
import { McpView } from "@/components/setup/McpView";
import { PolicyView } from "@/components/setup/PolicyView";
import { TaskRow } from "@/components/execution/TaskRow";
import { MetricCards } from "@/components/execution/MetricCards";

const project = (role: Project["role"]): Project => ({ id: "p1", name: "Demo", description: "", role, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });

const wrap = (role: Project["role"], node: React.ReactNode) => render(<ProjectProvider value={{ project: project(role), canManage: role !== "DEV" }}>{node}</ProjectProvider>);

type Handler = (url: string, init: RequestInit) => unknown;
const calls: { method: string; url: string; body: unknown }[] = [];

function serve(handler: Handler): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url: input, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      const result = handler(input, init) as { status?: number; body?: unknown } | undefined;
      const status = result?.status ?? 200;
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(result?.body ?? []), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const task: Task = {
  id: "t1",
  title: "Fix login",
  description: "Make login work",
  source: { type: "manual" },
  repositoryId: "r1",
  repo: { provider: "github", name: "acme/app", url: "https://github.com/acme/app", baseBranch: "develop" },
  inputs: {},
  outputs: ["report"],
  createdBy: "dev",
  createdAt: "2026-01-01T00:00:00Z",
};
const run = (status: Run["status"], extra: Partial<Run> = {}): Run => ({ id: "r1", taskId: "t1", attempt: 1, status, publishes: false, idempotencyKey: "k", correlationId: "c", requestedBy: "dev", createdAt: "2026-01-01T00:00:00Z", ...extra });

describe("MetricCards", () => {
  it("shows the counts and sets the filter, clicking again clears it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<MetricCards counts={{ ready: 2, in_progress: 1, blocked: 0, failed: 3, succeeded: 0 }} selected="all" onSelect={onSelect} />);
    expect(screen.getByLabelText("3 Failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /failed/i }));
    expect(onSelect).toHaveBeenCalledWith("failed");
    rerender(<MetricCards counts={{ ready: 2, in_progress: 1, blocked: 0, failed: 3, succeeded: 0 }} selected="failed" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /failed/i }));
    expect(onSelect).toHaveBeenLastCalledWith("all");
  });
});

describe("TaskRow", () => {
  it("starts a run with a fresh idempotency key and refreshes", async () => {
    serve((url) => (url.endsWith("/runs") ? { status: 201, body: run("queued") } : { body: [] }));
    const onChanged = vi.fn();
    const [item] = groupRuns([task], []);
    wrap("DEV", <TaskRow projectId="p1" item={item!} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: /start a run for fix login/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const start = calls.find((c) => c.method === "POST");
    expect(start?.url).toBe("/api/projects/p1/tasks/t1/runs");
    const headers = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")?.[1]?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("opens to show the attempts and the log, and cancels an active run", async () => {
    serve((url) => {
      if (url.includes("/events")) return { body: [{ seq: 1, at: "2026-01-01T10:00:00Z", type: "log", level: "info", message: "reading the base branch" }] };
      return { body: run("cancelled") };
    });
    const onChanged = vi.fn();
    const [item] = groupRuns([task], [run("preparing")]);
    wrap("DEV", <TaskRow projectId="p1" item={item!} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: /fix login/i, expanded: false }));
    expect(await screen.findByText("reading the base branch")).toBeInTheDocument();
    expect(screen.getByText("Attempt 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /cancel run/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/projects/p1/runs/r1/cancel")).toBe(true);
  });

  it("disables starting while a run is in progress", () => {
    const [item] = groupRuns([task], [run("analyzing")]);
    wrap("DEV", <TaskRow projectId="p1" item={item!} onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: /start a run/i })).toBeDisabled();
  });

  it("shows why a run failed", async () => {
    serve(() => ({ body: [] }));
    const [item] = groupRuns([task], [run("failed", { failureReason: "stages after preparing are not implemented" })]);
    wrap("DEV", <TaskRow projectId="p1" item={item!} onChanged={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /fix login/i, expanded: false }));
    expect(screen.getByText("stages after preparing are not implemented")).toBeInTheDocument();
  });
});

const policy = (version: number): PolicyData => ({
  version,
  policy: { allowedExecutables: ["git"], extraForbiddenExecutables: [], extraProtectedBranches: [], mcpToolDecisions: {}, limits: { commandTimeoutSeconds: 60, maxToolCallsPerRun: 100 } },
  effective: { protectedBranches: ["main"], allowedExecutables: ["git"], forbiddenExecutables: ["sudo"] },
  baseline: {
    protectedBranches: ["main", "master"],
    forbiddenExecutables: ["rm"],
    neverAllowedExecutables: ["bash", "sudo"],
    limitCeilings: { commandTimeoutSeconds: 600, maxToolCallsPerRun: 500 },
    rules: [{ id: "no-shell", description: "No shell is ever started." }],
  },
});

describe("PolicyView", () => {
  it("shows the baseline as text only and lets a manager save with the version it saw", async () => {
    serve((url, init) => (init.method === "PUT" ? { body: policy(4) } : url.endsWith("/versions") ? { body: [] } : { body: policy(3) }));
    wrap("PM", <PolicyView />);

    expect(await screen.findByText("No shell is ever started.")).toBeInTheDocument();
    expect(screen.getByText("Baseline (fixed)")).toBeInTheDocument();
    const baseline = screen.getByText("Baseline (fixed)").closest("div")!.parentElement!;
    expect(within(baseline).queryByRole("textbox")).toBeNull();

    const programs = screen.getByLabelText(/programs a run may start/i);
    await userEvent.clear(programs);
    await userEvent.type(programs, "git{Enter}pnpm");
    await userEvent.click(screen.getByRole("button", { name: /save as version 4/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ expectedVersion: 3, policy: { allowedExecutables: ["git", "pnpm"] } });
  });

  it("is read-only for a DEV", async () => {
    serve((url) => (url.endsWith("/versions") ? { body: [] } : { body: policy(1) }));
    wrap("DEV", <PolicyView />);
    expect(await screen.findByLabelText(/programs a run may start/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save as version/i })).toBeNull();
  });

  it("tells the user to reload when someone saved first", async () => {
    serve((url, init) => (init.method === "PUT" ? { status: 409, body: { message: "the policy changed since you loaded it" } } : url.endsWith("/versions") ? { body: [] } : { body: policy(3) }));
    wrap("PL", <PolicyView />);
    const timeout = await screen.findByLabelText(/seconds a command may run/i);
    await userEvent.clear(timeout);
    await userEvent.type(timeout, "90");
    await userEvent.click(screen.getByRole("button", { name: /save as version 4/i }));
    expect(await screen.findByText(/someone saved a newer version first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save as version 4/i })).toBeDisabled();
  });
});

describe("McpView", () => {
  const connection: McpConnection = { id: "c1", name: "jira", url: "https://mcp.example.com", auth: "bearer", createdBy: "dev", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

  it("sends a token once, clears it, and never shows one", async () => {
    serve((_url, init) => (init.method === "POST" ? { status: 201, body: connection } : { body: [] }));
    wrap("PM", <McpView />);
    await userEvent.click((await screen.findAllByRole("button", { name: /connect server/i }))[0]!);

    await userEvent.type(screen.getByLabelText("Name"), "jira");
    await userEvent.type(screen.getByLabelText("Server address"), "https://mcp.example.com");
    const token = screen.getByLabelText(/bearer token/i);
    expect(token).toHaveAttribute("type", "password");
    await userEvent.type(token, "s3cr3t-token");
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "jira", url: "https://mcp.example.com", bearerToken: "s3cr3t-token" });
    expect(document.body.textContent).not.toContain("s3cr3t-token");
  });

  it("lists the tools a test finds and a failed test in words", async () => {
    let answer: unknown = { ok: true, testedAt: "2026-01-01T10:00:00Z", protocolVersion: "2025-03-26", server: { name: "Jira" }, tools: [{ name: "getIssue", description: "Reads an issue" }], skippedTools: 0, truncated: false };
    serve((_url, init) => (init.method === "POST" ? { body: answer } : { body: [connection] }));
    wrap("PM", <McpView />);
    await userEvent.click(await screen.findByRole("button", { name: /test jira/i }));
    expect(await screen.findByText("getIssue")).toBeInTheDocument();

    answer = { ok: false, testedAt: "2026-01-01T10:01:00Z", error: "timeout" };
    await userEvent.click(screen.getByRole("button", { name: /test jira/i }));
    expect(await screen.findByText(/the connection test failed: timeout/i)).toBeInTheDocument();
  });

  it("disables changes for a DEV", async () => {
    serve(() => ({ body: [connection] }));
    wrap("DEV", <McpView />);
    expect(await screen.findByRole("button", { name: /test jira/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /connect server/i })).toBeDisabled();
  });
});
