import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../identity";
import { RepositoryMappingId, UserId } from "../../shared-kernel";
import { ProjectsService } from "../application/projects.service";
import type { MemberView, ProjectView, RepositoryMappingView } from "../application/views";
import {
  AddMemberBody,
  AddRepositoryBody,
  ChangeMemberRoleBody,
  ChangeRepositoryBranchesBody,
  CreateProjectBody,
  UpdateProjectBody,
  parseInput,
} from "./projects.dto";

@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ProjectView> {
    return this.projects.create(user, parseInput(CreateProjectBody, body));
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProjectView[]> {
    return this.projects.list(user);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<ProjectView> {
    return this.projects.get(user, id);
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<ProjectView> {
    return this.projects.update(user, id, parseInput(UpdateProjectBody, body));
  }

  @Get(":id/members")
  listMembers(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<MemberView[]> {
    return this.projects.listMembers(user, id);
  }

  @Post(":id/members")
  addMember(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<MemberView> {
    return this.projects.addMember(user, id, parseInput(AddMemberBody, body));
  }

  @Patch(":id/members/:userId")
  changeMemberRole(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") memberId: string,
    @Body() body: unknown,
  ): Promise<MemberView> {
    return this.projects.changeMemberRole(user, id, parseInput(UserId, memberId), parseInput(ChangeMemberRoleBody, body).role);
  }

  @Delete(":id/members/:userId")
  @HttpCode(204)
  removeMember(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("userId") memberId: string): Promise<void> {
    return this.projects.removeMember(user, id, parseInput(UserId, memberId));
  }

  @Get(":id/repositories")
  listRepositories(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<RepositoryMappingView[]> {
    return this.projects.listRepositories(user, id);
  }

  @Post(":id/repositories")
  addRepository(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<RepositoryMappingView> {
    return this.projects.addRepository(user, id, parseInput(AddRepositoryBody, body));
  }

  @Patch(":id/repositories/:repositoryId")
  changeRepositoryBranches(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("repositoryId") repositoryId: string,
    @Body() body: unknown,
  ): Promise<RepositoryMappingView> {
    return this.projects.changeRepositoryBranches(
      user,
      id,
      parseInput(RepositoryMappingId, repositoryId),
      parseInput(ChangeRepositoryBranchesBody, body),
    );
  }

  @Delete(":id/repositories/:repositoryId")
  @HttpCode(204)
  removeRepository(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("repositoryId") repositoryId: string): Promise<void> {
    return this.projects.removeRepository(user, id, parseInput(RepositoryMappingId, repositoryId));
  }
}
