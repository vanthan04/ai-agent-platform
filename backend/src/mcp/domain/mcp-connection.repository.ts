import type { ProjectId, TenantId } from "../../shared-kernel";
import type { McpConnection } from "./mcp-connection";
import type { McpConnectionId } from "./value-objects";

/** Storage port. Every lookup is scoped by tenant and project (D2, D7). */
export interface McpConnectionRepository {
  nextId(): McpConnectionId;
  /** Throws `DuplicateMcpConnectionError` when the name is taken in the project. */
  save(connection: McpConnection): Promise<void>;
  findById(tenantId: TenantId, projectId: ProjectId, id: string): Promise<McpConnection | undefined>;
  listByProject(tenantId: TenantId, projectId: ProjectId): Promise<McpConnection[]>;
  delete(tenantId: TenantId, projectId: ProjectId, id: McpConnectionId): Promise<void>;
}
