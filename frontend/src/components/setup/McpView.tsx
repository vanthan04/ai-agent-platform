"use client";

import { useState } from "react";
import { KeyRound, Plug, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { McpConnection, McpTestResult } from "@/lib/api/types";
import { formatDateTime } from "@/lib/status";
import { MANAGER_ONLY, useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

/** A token is typed once and sent; it is never shown again, and the field is cleared after sending. */
const TOKEN_FIELD = { type: "password", autoComplete: "off", spellCheck: false } as const;

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { project } = useProject();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const add = useAction(async () => {
    await api<McpConnection>("POST", `/projects/${encodeURIComponent(project.id)}/mcp-connections`, { body: { name: name.trim(), url: url.trim(), ...(token === "" ? {} : { bearerToken: token }) } });
    setToken("");
    onAdded();
  });
  return (
    <Dialog open={open} onClose={onClose} title="Connect an MCP server">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void add.run();
        }}
      >
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus hint="Lowercase letters, digits and dashes. Policy refers to its tools as name:tool." />
        <TextField label="Server address" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required hint="An https address of a public server." />
        <TextField label="Bearer token (optional)" {...TOKEN_FIELD} value={token} onChange={(event) => setToken(event.target.value)} hint="Stored encrypted on the server. It is not shown again." />
        <InlineError>{add.error}</InlineError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={add.pending} disabled={name.trim() === "" || url.trim() === ""}>
            Connect
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TokenDialog({ connection, onClose }: { connection: McpConnection; onClose: () => void }) {
  const { project } = useProject();
  const [token, setToken] = useState("");
  const save = useAction(async () => {
    await api<unknown>("PUT", `/projects/${encodeURIComponent(project.id)}/mcp-connections/${encodeURIComponent(connection.id)}/token`, { body: { bearerToken: token } });
    setToken("");
    onClose();
  });
  return (
    <Dialog open onClose={onClose} title={`Replace the token of ${connection.name}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run();
        }}
      >
        <TextField label="New bearer token" {...TOKEN_FIELD} value={token} onChange={(event) => setToken(event.target.value)} required autoFocus hint="The old token is replaced. It is not shown again." />
        <InlineError>{save.error}</InlineError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.pending} disabled={token === ""}>
            Replace token
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TestResult({ result }: { result: McpTestResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-lg bg-bad-soft p-3 text-sm text-bad">
        The connection test failed: {result.error}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm">
      <p>
        Connected{result.server.name ? ` to ${result.server.name}` : ""} (protocol {result.protocolVersion}), {formatDateTime(result.testedAt)}. Tools are untrusted: each call goes through the project policy.
      </p>
      {result.tools.length === 0 ? <p className="text-muted">The server lists no tools.</p> : null}
      <ul className="flex flex-col gap-1">
        {result.tools.map((tool) => (
          <li key={tool.name}>
            <code className="font-mono">{tool.name}</code>
            {tool.description ? <span className="text-muted"> {tool.description}</span> : null}
          </li>
        ))}
      </ul>
      {result.truncated || result.skippedTools > 0 ? <p className="text-muted">Some tools are not listed ({result.skippedTools} skipped).</p> : null}
    </div>
  );
}

function ConnectionRow({ connection, onChanged }: { connection: McpConnection; onChanged: () => void }) {
  const { project, canManage } = useProject();
  const [result, setResult] = useState<McpTestResult | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const base = `/projects/${encodeURIComponent(project.id)}/mcp-connections/${encodeURIComponent(connection.id)}`;
  const test = useAction(async () => {
    setResult(await api<McpTestResult>("POST", `${base}/test`));
  });
  const remove = useAction(async () => {
    await api<void>("DELETE", base);
    onChanged();
  });
  const title = canManage ? undefined : MANAGER_ONLY;
  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Plug aria-hidden className="size-5 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{connection.name}</p>
          <p className="text-sm break-all text-muted">{connection.url}</p>
        </div>
        <Badge tone={connection.auth === "bearer" ? "info" : "neutral"}>{connection.auth === "bearer" ? "Bearer token set" : "No token"}</Badge>
        <Button size="sm" disabled={!canManage} title={title} loading={test.pending} onClick={() => void test.run()} aria-label={`Test ${connection.name}`}>
          Test
        </Button>
        <Button size="sm" disabled={!canManage} title={title} onClick={() => setReplacing(true)} aria-label={`Replace the token of ${connection.name}`}>
          <KeyRound aria-hidden className="size-3.5" />
          Token
        </Button>
        <Button size="sm" variant="danger" disabled={!canManage} title={title} loading={remove.pending} onClick={() => void remove.run()} aria-label={`Remove ${connection.name}`}>
          <Trash2 aria-hidden className="size-3.5" />
          Remove
        </Button>
      </div>
      <InlineError>{test.error ?? remove.error}</InlineError>
      {result ? <TestResult result={result} /> : null}
      {replacing ? <TokenDialog connection={connection} onClose={() => { setReplacing(false); onChanged(); }} /> : null}
    </li>
  );
}

export function McpView() {
  const { project, canManage } = useProject();
  const connections = useQuery(`mcp:${project.id}`, (signal) => api<McpConnection[]>("GET", `/projects/${encodeURIComponent(project.id)}/mcp-connections`, { signal }));
  const [adding, setAdding] = useState(false);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="mcp-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="mcp-title" className="text-lg font-semibold">
            MCP servers
          </h2>
          <p className="text-sm text-muted">Tools that agents of this project can call. Tokens are kept on the server and never sent to this page.</p>
        </div>
        <Button variant="primary" disabled={!canManage} title={canManage ? undefined : MANAGER_ONLY} onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" />
          Connect server
        </Button>
      </div>
      {connections.error !== undefined && !connections.data ? (
        <ErrorState error={connections.error} onRetry={() => void connections.refresh()} title="Could not load the connections" />
      ) : !connections.data ? (
        <Skeleton className="h-32" />
      ) : connections.data.length === 0 ? (
        <EmptyState title="No MCP server connected" action={canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Connect server</Button> : undefined}>
          Connect a server to let agents use its tools. Every call still goes through the policy.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {connections.data.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} onChanged={() => void connections.refresh()} />
            ))}
          </ul>
        </Card>
      )}
      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void connections.refresh();
        }}
      />
    </section>
  );
}
