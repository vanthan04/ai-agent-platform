import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../identity";
import { ModelSettingsService } from "../application/model-settings.service";
import type { ModelOverview, ModelSettingsView } from "../application/views";
import { SaveModelBody, parseInput } from "./agent.dto";

@Controller("projects/:id/model")
export class AgentController {
  constructor(@Inject(ModelSettingsService) private readonly model: ModelSettingsService) {}

  /** The providers that can be chosen and the project's choice. The key is never part of the answer, only whether one is set. */
  @Get()
  get(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<ModelOverview> {
    return this.model.get(user, id);
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown): Promise<ModelSettingsView> {
    return this.model.save(user, id, parseInput(SaveModelBody, body));
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<void> {
    return this.model.remove(user, id);
  }
}
