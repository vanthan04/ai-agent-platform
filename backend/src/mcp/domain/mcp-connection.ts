import type { ProjectId, TenantId, UserId } from "../../shared-kernel";
import type { SecretRef } from "../../vault";
import type { McpConnectionId, McpConnectionName, McpServerUrl } from "./value-objects";

export const MAX_MCP_CONNECTIONS_PER_PROJECT = 10;

export interface McpConnectionProps {
  id: McpConnectionId;
  tenantId: TenantId;
  projectId: ProjectId;
  name: McpConnectionName;
  url: McpServerUrl;
  /** Where the bearer token is kept; absent for a server that needs no sign-in. The token itself is never part of this record. */
  secretRef: SecretRef | undefined;
  createdBy: UserId;
  createdAt: string;
  updatedAt: string;
}

/**
 * A remote MCP server connected to a project (D9). Its name is fixed once created, because the project policy refers to
 * its tools as `<name>:<tool>`; to rename it, remove it and connect it again.
 */
export class McpConnection {
  private constructor(private readonly props: McpConnectionProps) {}

  static create(input: Omit<McpConnectionProps, "createdAt" | "updatedAt"> & { now: string }): McpConnection {
    const { now, ...rest } = input;
    return new McpConnection({ ...rest, createdAt: now, updatedAt: now });
  }

  static restore(props: McpConnectionProps): McpConnection {
    return new McpConnection({ ...props });
  }

  get id(): McpConnectionId {
    return this.props.id;
  }
  get name(): McpConnectionName {
    return this.props.name;
  }
  get url(): McpServerUrl {
    return this.props.url;
  }
  get secretRef(): SecretRef | undefined {
    return this.props.secretRef;
  }
  get auth(): "none" | "bearer" {
    return this.props.secretRef === undefined ? "none" : "bearer";
  }

  /** A copy that uses another stored token. The caller deletes the token this one pointed at. */
  withSecret(secretRef: SecretRef, now: string): McpConnection {
    return new McpConnection({ ...this.props, secretRef, updatedAt: now });
  }

  toProps(): McpConnectionProps {
    return { ...this.props };
  }
}
