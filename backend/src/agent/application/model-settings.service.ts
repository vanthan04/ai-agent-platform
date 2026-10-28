import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import { canManageProject } from "../../projects";
import { ProjectId } from "../../shared-kernel";
import { SECRET_STORE, type SecretRef, type SecretStore } from "../../vault";
import {
  AgentForbiddenError,
  AgentProjectNotFoundError,
  ModelSettings,
  PROVIDERS,
  type ApiKey,
  type ModelBaseUrl,
  type ModelName,
  type ModelProvider,
  type ModelSettingsRepository,
} from "../domain";
import { CLOCK, MODEL_SETTINGS_REPOSITORY, PROJECT_ACCESS, type Clock, type ProjectAccess } from "./ports";
import type { ModelOverview, ModelSettingsView } from "./views";

const toView = (settings: ModelSettings | undefined): ModelSettingsView => {
  if (!settings) return { configured: false };
  const props = settings.toProps();
  return {
    configured: true,
    provider: props.provider,
    model: props.model,
    ...(props.baseUrl === undefined ? {} : { baseUrl: props.baseUrl }),
    hasKey: settings.hasKey,
    updatedBy: props.updatedBy,
    updatedAt: props.updatedAt,
  };
};

/** Use cases for the model a project's agents use (D25): members see the choice, a PM or PL changes it and gives the key. */
@Injectable()
export class ModelSettingsService {
  constructor(
    @Inject(MODEL_SETTINGS_REPOSITORY) private readonly settings: ModelSettingsRepository,
    @Inject(PROJECT_ACCESS) private readonly access: ProjectAccess,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(user: AuthUser, projectId: string): Promise<ModelOverview> {
    await this.requireMember(user, projectId);
    const found = await this.settings.find(user.tenantId, ProjectId.parse(projectId));
    return { providers: PROVIDERS, settings: toView(found) };
  }

  /**
   * Sets the provider and model. A new key replaces the old one; with no key given, the stored key stays only when the
   * provider and address are unchanged. A key that is no longer used is deleted from the vault after the change is saved.
   */
  async save(
    user: AuthUser,
    projectId: string,
    input: { provider: ModelProvider; model: ModelName; baseUrl?: ModelBaseUrl; apiKey?: ApiKey },
  ): Promise<ModelSettingsView> {
    await this.requireManager(user, projectId);
    const project = ProjectId.parse(projectId);
    const choice = { provider: input.provider, model: input.model, baseUrl: input.baseUrl };
    const existing = await this.settings.find(user.tenantId, project);
    const newRef = input.apiKey ? await this.secrets.put(user.tenantId, input.apiKey) : undefined;
    try {
      const now = this.clock.now();
      const updated = existing
        ? existing.withChoice(choice, newRef, user.userId, now)
        : ModelSettings.create({ tenantId: user.tenantId, projectId: project, choice, secretRef: newRef, updatedBy: user.userId, now });
      await this.settings.save(updated);
      if (existing?.secretRef !== undefined && existing.secretRef !== updated.secretRef) await this.discard(user, existing.secretRef);
      return toView(updated);
    } catch (error) {
      await this.discard(user, newRef);
      throw error;
    }
  }

  /** Forgets the choice and deletes the key. Deleting what was never set is not an error. */
  async remove(user: AuthUser, projectId: string): Promise<void> {
    await this.requireManager(user, projectId);
    const project = ProjectId.parse(projectId);
    const existing = await this.settings.find(user.tenantId, project);
    if (!existing) return;
    await this.settings.delete(user.tenantId, project);
    await this.discard(user, existing.secretRef);
  }

  private async requireMember(user: AuthUser, projectId: string): Promise<void> {
    if ((await this.access.roleOf(user, projectId)) === undefined) throw new AgentProjectNotFoundError();
  }

  private async requireManager(user: AuthUser, projectId: string): Promise<void> {
    const role = await this.access.roleOf(user, projectId);
    if (role === undefined) throw new AgentProjectNotFoundError();
    if (!canManageProject(role)) throw new AgentForbiddenError();
  }

  /** Best effort: a key that cannot be removed now is not used by anything, and is never returned to anyone. */
  private async discard(user: AuthUser, ref: SecretRef | undefined): Promise<void> {
    if (!ref) return;
    try {
      await this.secrets.delete(user.tenantId, ref);
    } catch {
      // nothing more to do; the failure must not hide the error that led here
    }
  }
}
