import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../identity";
import { ProjectPolicyService } from "../application/project-policy.service";
import type { PolicyVersionView, PolicyView } from "../application/views";
import { SavePolicyBody, parseInput } from "./projects.dto";

@Controller("projects/:id/policy")
export class ProjectPolicyController {
  constructor(@Inject(ProjectPolicyService) private readonly policy: ProjectPolicyService) {}

  @Get()
  current(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<PolicyView> {
    return this.policy.current(user, id);
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<PolicyView> {
    return this.policy.update(user, id, parseInput(SavePolicyBody, body));
  }

  @Get("versions")
  versions(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<PolicyVersionView[]> {
    return this.policy.versions(user, id);
  }
}
