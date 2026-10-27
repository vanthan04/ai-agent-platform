import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import { canManageProject } from "../../projects";
import { ProjectId } from "../../shared-kernel";
import { SECRET_STORE, type SecretRef, type SecretStore } from "../../vault";
import {
  MAX_MCP_CONNECTIONS_PER_PROJECT,
  McpConnection,
  McpConnectionNotFoundError,
  McpForbiddenError,
  McpProjectNotFoundError,
  McpRateLimitedError,
  TooManyMcpConnectionsError,
  type BearerToken,
  type McpConnectionName,
  type McpConnectionRepository,
  type McpServerUrl,
} from "../domain";
import {
  CLOCK,
  MCP_CONNECTION_REPOSITORY,
  MCP_SERVER_CLIENT,
  PROJECT_ACCESS,
  TEST_RATE_LIMITER,
  type Clock,
  type McpServerClient,
  type ProjectAccess,
  type RateLimiter,
} from "./ports";
import type { McpConnectionView, McpTestView } from "./views";

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Text from a remote server: control characters become spaces, runs of spaces collapse, and it is cut to a length. */
const plain = (text: string, max: number): string =>
  Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const toView = (connection: McpConnection): McpConnectionView => {
  const props = connection.toProps();
  return {
    id: props.id,
    name: props.name,
    url: props.url,
    auth: connection.auth,
    createdBy: props.createdBy,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
  };
};

/** Use cases for the MCP servers connected to a project (D9, D11): members see them, a PM or PL changes them. */
@Injectable()
export class McpConnectionsService {
  constructor(
    @Inject(MCP_CONNECTION_REPOSITORY) private readonly connections: McpConnectionRepository,
    @Inject(PROJECT_ACCESS) private readonly access: ProjectAccess,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MCP_SERVER_CLIENT) private readonly client: McpServerClient,
    @Inject(TEST_RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Connects to the server, asks what tools it offers and reports. Only a PM or PL may (it sends the token to the server and
   * makes the platform call out), and a project can do it a few times a minute. A failure is a result, not an error: the
   * caller learns one word about what went wrong, never what the server answered.
   */
  async test(user: AuthUser, projectId: string, connectionId: string): Promise<McpTestView> {
    await this.requireManager(user, projectId);
    const connection = await this.find(user, projectId, connectionId);
    if (!this.limiter.tryAcquire(`${user.tenantId}/${projectId}`)) throw new McpRateLimitedError();
    const testedAt = this.clock.now();

    let bearerToken: string | undefined;
    if (connection.secretRef !== undefined) {
      bearerToken = await this.secrets.get(user.tenantId, connection.secretRef);
      if (bearerToken === undefined) return { ok: false, testedAt, error: "token_unavailable" };
    }
    const discovery = await this.client.discover({ url: connection.url, ...(bearerToken === undefined ? {} : { bearerToken }) });
    if (!discovery.ok) return { ok: false, testedAt, error: discovery.failure };

    const seen = new Set<string>();
    const tools: { name: string; description: string }[] = [];
    let skippedTools = discovery.skipped;
    for (const tool of discovery.tools) {
      if (!TOOL_NAME.test(tool.name) || seen.has(tool.name)) {
        skippedTools++;
        continue;
      }
      seen.add(tool.name);
      tools.push({ name: tool.name, description: plain(tool.description, 300) });
    }
    const name = discovery.server.name === undefined ? undefined : plain(discovery.server.name, 100);
    const version = discovery.server.version === undefined ? undefined : plain(discovery.server.version, 50);
    return {
      ok: true,
      testedAt,
      protocolVersion: discovery.protocolVersion,
      server: { ...(name ? { name } : {}), ...(version ? { version } : {}) },
      tools,
      skippedTools,
      truncated: discovery.truncated,
    };
  }

  async list(user: AuthUser, projectId: string): Promise<McpConnectionView[]> {
    await this.requireMember(user, projectId);
    return (await this.connections.listByProject(user.tenantId, ProjectId.parse(projectId))).map(toView);
  }

  async create(
    user: AuthUser,
    projectId: string,
    input: { name: McpConnectionName; url: McpServerUrl; bearerToken?: BearerToken },
  ): Promise<McpConnectionView> {
    await this.requireManager(user, projectId);
    const project = ProjectId.parse(projectId);
    if ((await this.connections.listByProject(user.tenantId, project)).length >= MAX_MCP_CONNECTIONS_PER_PROJECT) {
      throw new TooManyMcpConnectionsError(MAX_MCP_CONNECTIONS_PER_PROJECT);
    }
    const secretRef = input.bearerToken ? await this.secrets.put(user.tenantId, input.bearerToken) : undefined;
    try {
      const connection = McpConnection.create({
        id: this.connections.nextId(),
        tenantId: user.tenantId,
        projectId: project,
        name: input.name,
        url: input.url,
        secretRef,
        createdBy: user.userId,
        now: this.clock.now(),
      });
      await this.connections.save(connection);
      return toView(connection);
    } catch (error) {
      await this.discard(user, secretRef);
      throw error;
    }
  }

  /** Replaces the stored token. The old one is deleted only after the connection points at the new one. */
  async replaceToken(user: AuthUser, projectId: string, connectionId: string, token: BearerToken): Promise<McpConnectionView> {
    await this.requireManager(user, projectId);
    const connection = await this.find(user, projectId, connectionId);
    const previous = connection.secretRef;
    const secretRef = await this.secrets.put(user.tenantId, token);
    try {
      const updated = connection.withSecret(secretRef, this.clock.now());
      await this.connections.save(updated);
      await this.discard(user, previous);
      return toView(updated);
    } catch (error) {
      await this.discard(user, secretRef);
      throw error;
    }
  }

  async remove(user: AuthUser, projectId: string, connectionId: string): Promise<void> {
    await this.requireManager(user, projectId);
    const connection = await this.find(user, projectId, connectionId);
    await this.connections.delete(user.tenantId, ProjectId.parse(projectId), connection.id);
    await this.discard(user, connection.secretRef);
  }

  private async find(user: AuthUser, projectId: string, connectionId: string): Promise<McpConnection> {
    const connection = await this.connections.findById(user.tenantId, ProjectId.parse(projectId), connectionId);
    if (!connection) throw new McpConnectionNotFoundError();
    return connection;
  }

  private async requireMember(user: AuthUser, projectId: string): Promise<void> {
    if ((await this.access.roleOf(user, projectId)) === undefined) throw new McpProjectNotFoundError();
  }

  private async requireManager(user: AuthUser, projectId: string): Promise<void> {
    const role = await this.access.roleOf(user, projectId);
    if (role === undefined) throw new McpProjectNotFoundError();
    if (!canManageProject(role)) throw new McpForbiddenError();
  }

  /** Best effort: a token that cannot be removed now is not used by anything, and is never returned to anyone. */
  private async discard(user: AuthUser, ref: SecretRef | undefined): Promise<void> {
    if (!ref) return;
    try {
      await this.secrets.delete(user.tenantId, ref);
    } catch {
      // nothing more to do; the failure must not hide the error that led here
    }
  }
}
