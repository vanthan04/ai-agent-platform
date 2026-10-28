import type { ProjectId, TenantId, UserId } from "../../shared-kernel";
import type { SecretRef } from "../../vault";
import { InvalidModelSettingsError } from "./errors";
import { providerInfo, type ModelBaseUrl, type ModelName, type ModelProvider } from "./value-objects";

export interface ModelSettingsProps {
  tenantId: TenantId;
  projectId: ProjectId;
  provider: ModelProvider;
  model: ModelName;
  /** Only for a provider that has no fixed address. */
  baseUrl: ModelBaseUrl | undefined;
  /** Where the API key is kept; absent until one is given. The key itself is never part of this record. */
  secretRef: SecretRef | undefined;
  updatedBy: UserId;
  updatedAt: string;
}

export interface ModelChoice {
  provider: ModelProvider;
  model: ModelName;
  baseUrl?: ModelBaseUrl | undefined;
}

/** A project has at most one choice of model. A provider that needs an address has one; one that does not, has none. */
function checkChoice(choice: ModelChoice): void {
  const { needsBaseUrl } = providerInfo(choice.provider);
  if (needsBaseUrl && choice.baseUrl === undefined) throw new InvalidModelSettingsError("this provider needs the address of the server");
  if (!needsBaseUrl && choice.baseUrl !== undefined) throw new InvalidModelSettingsError("this provider has a fixed address; leave the address out");
}

/**
 * Which model a project's agents use (D25). The API key belongs to one provider at one address: choosing another
 * provider or address drops the reference to the old key, so a key is never sent to a server it was not given for.
 */
export class ModelSettings {
  private constructor(private readonly props: ModelSettingsProps) {}

  static create(input: { tenantId: TenantId; projectId: ProjectId; choice: ModelChoice; secretRef: SecretRef | undefined; updatedBy: UserId; now: string }): ModelSettings {
    checkChoice(input.choice);
    return new ModelSettings({
      tenantId: input.tenantId,
      projectId: input.projectId,
      provider: input.choice.provider,
      model: input.choice.model,
      baseUrl: input.choice.baseUrl,
      secretRef: input.secretRef,
      updatedBy: input.updatedBy,
      updatedAt: input.now,
    });
  }

  static restore(props: ModelSettingsProps): ModelSettings {
    return new ModelSettings({ ...props });
  }

  get projectId(): ProjectId {
    return this.props.projectId;
  }
  get provider(): ModelProvider {
    return this.props.provider;
  }
  get secretRef(): SecretRef | undefined {
    return this.props.secretRef;
  }
  get hasKey(): boolean {
    return this.props.secretRef !== undefined;
  }

  /** True when the key this record points at was given for the same provider and address as `choice`. */
  keepsKeyFor(choice: ModelChoice): boolean {
    return this.props.provider === choice.provider && this.props.baseUrl === choice.baseUrl;
  }

  /** A copy with another choice. The key reference is kept only when `keepsKeyFor` says so, unless a new one is given. */
  withChoice(choice: ModelChoice, secretRef: SecretRef | undefined, updatedBy: UserId, now: string): ModelSettings {
    checkChoice(choice);
    return new ModelSettings({
      ...this.props,
      provider: choice.provider,
      model: choice.model,
      baseUrl: choice.baseUrl,
      secretRef: secretRef ?? (this.keepsKeyFor(choice) ? this.props.secretRef : undefined),
      updatedBy,
      updatedAt: now,
    });
  }

  toProps(): ModelSettingsProps {
    return { ...this.props };
  }
}
