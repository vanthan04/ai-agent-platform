import { z } from "zod";
import { OutboundError, type OutboundResponse, type SafeHttpClient } from "../../network";
import type { DiscoveredTool, McpCallFailure, McpDiscovery, McpServerClient } from "../application/ports";

const REQUESTED_PROTOCOL_VERSION = "2025-06-18";

export interface DiscoveryLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxPages: number;
  maxTools: number;
}

const DEFAULT_LIMITS: DiscoveryLimits = { timeoutMs: 10_000, maxResponseBytes: 1_000_000, maxPages: 10, maxTools: 500 };

class CallFailure extends Error {
  constructor(readonly failure: McpCallFailure) {
    super(failure);
  }
}

const RpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).nullable().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).passthrough().optional(),
});

const InitializeResult = z.object({
  protocolVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serverInfo: z.object({ name: z.string().max(200).optional(), version: z.string().max(100).optional() }).passthrough().optional(),
});

const ToolsResult = z.object({ tools: z.array(z.unknown()), nextCursor: z.string().min(1).max(2_000).optional() });

const SESSION_ID = /^[\x21-\x7E]{1,256}$/;

const MAPPED: Readonly<Record<string, McpCallFailure>> = {
  blocked_address: "blocked_address",
  timeout: "timeout",
  response_too_large: "response_too_large",
  unreachable: "unreachable",
  invalid_request: "unreachable",
};

/** The events of a text/event-stream body that carry JSON, in order. */
function sseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // an event that is not JSON is not a message
    }
  }
  return messages;
}

/**
 * A client for the Streamable HTTP transport of MCP: initialize, tools/list (following pages), and a best-effort end of
 * session. The older HTTP+SSE transport is not supported. Every byte goes through `SafeHttpClient`, so the server is
 * only ever reached at a public address, over https, with no redirects. The server's own words (error texts, bodies) are
 * never returned, only a one-word failure.
 */
export class HttpMcpServerClient implements McpServerClient {
  constructor(
    private readonly http: SafeHttpClient,
    private readonly limits: DiscoveryLimits = DEFAULT_LIMITS,
  ) {}

  async discover(target: { url: string; bearerToken?: string }): Promise<McpDiscovery> {
    const session = { id: undefined as string | undefined, protocolVersion: undefined as string | undefined };
    try {
      return await this.run(target, session);
    } catch (error) {
      if (error instanceof CallFailure) return { ok: false, failure: error.failure };
      if (error instanceof OutboundError) return { ok: false, failure: MAPPED[error.failure] ?? "unreachable" };
      if (error instanceof SyntaxError || error instanceof z.ZodError) return { ok: false, failure: "invalid_response" };
      throw error;
    } finally {
      await this.endSession(target, session);
    }
  }

  private async run(
    target: { url: string; bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
  ): Promise<McpDiscovery> {
    const initial = await this.call(target, session, 1, "initialize", {
      protocolVersion: REQUESTED_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "agent-platform", version: "0.0.0" },
    });
    const init = InitializeResult.parse(initial.result);
    session.id = initial.sessionId;
    session.protocolVersion = init.protocolVersion;
    await this.notify(target, session, "notifications/initialized");

    const tools: DiscoveredTool[] = [];
    let skipped = 0;
    let truncated = false;
    let cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= this.limits.maxPages) {
        truncated = true;
        break;
      }
      const listed = await this.call(target, session, 2 + page, "tools/list", cursor === undefined ? {} : { cursor });
      const parsed = ToolsResult.parse(listed.result);
      for (const item of parsed.tools) {
        const tool = z.object({ name: z.string().min(1).max(200), description: z.string().optional() }).safeParse(item);
        if (!tool.success) {
          skipped++;
        } else if (tools.length < this.limits.maxTools) {
          tools.push({ name: tool.data.name, description: tool.data.description ?? "" });
        } else {
          truncated = true;
        }
      }
      if (parsed.nextCursor === undefined) break;
      cursor = parsed.nextCursor;
    }
    return { ok: true, protocolVersion: init.protocolVersion, server: { name: init.serverInfo?.name, version: init.serverInfo?.version }, tools, skipped, truncated };
  }

  private headers(
    target: { bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
  ): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "agent-platform-mcp-client/0.0.0",
      ...(target.bearerToken === undefined ? {} : { authorization: `Bearer ${target.bearerToken}` }),
      ...(session.protocolVersion === undefined ? {} : { "mcp-protocol-version": session.protocolVersion }),
      ...(session.id === undefined ? {} : { "mcp-session-id": session.id }),
    };
  }

  private async post(
    target: { url: string; bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
    payload: object,
  ): Promise<OutboundResponse> {
    const response = await this.http.send({
      url: target.url,
      method: "POST",
      headers: this.headers(target, session),
      body: JSON.stringify(payload),
      timeoutMs: this.limits.timeoutMs,
      maxResponseBytes: this.limits.maxResponseBytes,
    });
    if (response.status === 401 || response.status === 403) throw new CallFailure("unauthorized");
    if (response.status < 200 || response.status >= 300) throw new CallFailure("bad_status");
    return response;
  }

  private async call(
    target: { url: string; bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
    id: number,
    method: string,
    params: object,
  ): Promise<{ result: unknown; sessionId: string | undefined }> {
    const response = await this.post(target, session, { jsonrpc: "2.0", id, method, params });
    const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
    let candidates: unknown[];
    if (contentType.includes("text/event-stream")) candidates = sseMessages(response.body);
    else if (contentType.includes("application/json")) candidates = [JSON.parse(response.body)];
    else throw new CallFailure("invalid_response");
    const message = candidates.map((candidate) => RpcResponse.safeParse(candidate)).find((parsed) => parsed.success && parsed.data.id === id);
    if (!message?.success) throw new CallFailure("invalid_response");
    if (message.data.error !== undefined) throw new CallFailure("server_error");
    const header = response.headers["mcp-session-id"];
    const sessionId = typeof header === "string" ? header : undefined;
    if (sessionId !== undefined && !SESSION_ID.test(sessionId)) throw new CallFailure("invalid_response");
    return { result: message.data.result, sessionId: sessionId ?? session.id };
  }

  private async notify(
    target: { url: string; bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
    method: string,
  ): Promise<void> {
    await this.post(target, session, { jsonrpc: "2.0", method });
  }

  /** The spec asks a client to end its session. A server may refuse (405), and nothing depends on it, so any failure is ignored. */
  private async endSession(
    target: { url: string; bearerToken?: string },
    session: { id: string | undefined; protocolVersion: string | undefined },
  ): Promise<void> {
    if (session.id === undefined) return;
    try {
      await this.http.send({ url: target.url, method: "DELETE", headers: this.headers(target, session), timeoutMs: 3_000, maxResponseBytes: 10_000 });
    } catch {
      // best effort only
    }
  }
}
