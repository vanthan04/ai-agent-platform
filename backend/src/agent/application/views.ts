import type { ModelProvider, ProviderInfo } from "../domain";

/** The model a project uses, as the API shows it. The key and the reference to it are never part of a view; `hasKey` says whether one is set. */
export type ModelSettingsView =
  | { configured: false }
  | {
      configured: true;
      provider: ModelProvider;
      model: string;
      baseUrl?: string;
      hasKey: boolean;
      updatedBy: string;
      updatedAt: string;
    };

export interface ModelOverview {
  providers: readonly ProviderInfo[];
  settings: ModelSettingsView;
}
