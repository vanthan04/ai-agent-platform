import { z } from "zod";
import { isPublicHttpsUrl } from "../../shared-kernel";

/** The model providers a project can choose (D25). Adding one means an adapter and an entry in `PROVIDERS`. */
export const ModelProvider = z.enum(["anthropic", "gemini", "openai_compatible"]);
export type ModelProvider = z.infer<typeof ModelProvider>;

export interface ProviderInfo {
  id: ModelProvider;
  label: string;
  /** An OpenAI-compatible server has no fixed address, so the project gives one. */
  needsBaseUrl: boolean;
  /** Names offered as a starting point. The model field accepts any valid name: providers add models often. */
  suggestedModels: readonly string[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: "anthropic", label: "Anthropic (Claude)", needsBaseUrl: false, suggestedModels: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] },
  { id: "gemini", label: "Google Gemini", needsBaseUrl: false, suggestedModels: [] },
  { id: "openai_compatible", label: "OpenAI-compatible server", needsBaseUrl: true, suggestedModels: [] },
];

export const providerInfo = (provider: ModelProvider): ProviderInfo => {
  const info = PROVIDERS.find((candidate) => candidate.id === provider);
  if (!info) throw new Error(`unknown provider ${provider}`);
  return info;
};

/** A model name as the provider writes it, for example `claude-sonnet-5-5`. Letters, digits and `. _ : / -` only. */
export const ModelName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/, "use letters, digits and . _ : / - (at most 100)")
  .brand<"ModelName">();
export type ModelName = z.infer<typeof ModelName>;

/** The address of an OpenAI-compatible server: https, a public name, no credentials or query. The call checks where it connects too. */
export const ModelBaseUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isPublicHttpsUrl, "must be an https address of a public server, with no IP address, credentials or query")
  .brand<"ModelBaseUrl">();
export type ModelBaseUrl = z.infer<typeof ModelBaseUrl>;

/** An API key: printable characters without spaces, so it can never break out of an HTTP header. Never echoed, never logged. */
export const ApiKey = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[\x21-\x7E]+$/, "must be printable characters without spaces")
  .brand<"ApiKey">();
export type ApiKey = z.infer<typeof ApiKey>;
