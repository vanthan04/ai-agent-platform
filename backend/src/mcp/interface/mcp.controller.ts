import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../identity";
import { McpConnectionsService } from "../application/mcp-connections.service";
import type { McpConnectionView, McpTestView } from "../application/views";
import { CreateMcpConnectionBody, ReplaceTokenBody, parseInput } from "./mcp.dto";

@Controller("projects/:id/mcp-connections")
export class McpController {
  constructor(@Inject(McpConnectionsService) private readonly connections: McpConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<McpConnectionView[]> {
    return this.connections.list(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<McpConnectionView> {
    return this.connections.create(user, id, parseInput(CreateMcpConnectionBody, body));
  }

  @Put(":connectionId/token")
  replaceToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Body() body: unknown,
  ): Promise<McpConnectionView> {
    return this.connections.replaceToken(user, id, connectionId, parseInput(ReplaceTokenBody, body).bearerToken);
  }

  /** Connects to the server and lists its tools. 200 whatever the outcome: `ok: false` carries a one-word reason. */
  @Post(":connectionId/test")
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("connectionId") connectionId: string): Promise<McpTestView> {
    return this.connections.test(user, id, connectionId);
  }

  @Delete(":connectionId")
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("connectionId") connectionId: string): Promise<void> {
    return this.connections.remove(user, id, connectionId);
  }
}
