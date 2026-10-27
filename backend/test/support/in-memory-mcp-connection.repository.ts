import { DuplicateMcpConnectionError, McpConnection, McpConnectionId, type McpConnectionProps, type McpConnectionRepository } from "../../src/mcp";
import type { ProjectId, TenantId } from "../../src/shared-kernel";

/** Same contract as the Postgres repository, kept in memory. */
export class InMemoryMcpConnectionRepository implements McpConnectionRepository {
  private readonly stored = new Map<string, McpConnectionProps>();
  private counter = 0;

  nextId(): McpConnectionId {
    return McpConnectionId.parse(`mcp-${++this.counter}`);
  }

  async save(connection: McpConnection): Promise<void> {
    const props = connection.toProps();
    for (const other of this.stored.values()) {
      if (other.id !== props.id && other.projectId === props.projectId && other.name === props.name) throw new DuplicateMcpConnectionError();
    }
    this.stored.set(props.id, props);
  }

  async findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<McpConnection | undefined> {
    const props = this.stored.get(id);
    return props && props.tenantId === tenantId && props.projectId === projectId ? McpConnection.restore(props) : undefined;
  }

  async listByProject(tenantId: TenantId, projectId: ProjectId): Promise<McpConnection[]> {
    return [...this.stored.values()]
      .filter((props) => props.tenantId === tenantId && props.projectId === projectId)
      .map((props) => McpConnection.restore(props));
  }

  async delete(tenantId: TenantId, projectId: ProjectId, id: McpConnectionId): Promise<void> {
    const props = this.stored.get(id);
    if (props && props.tenantId === tenantId && props.projectId === projectId) this.stored.delete(id);
  }
}
