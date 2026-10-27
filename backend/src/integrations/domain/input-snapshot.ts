import { z } from "zod";
import { ProjectId, RunId, TenantId, Timestamp } from "../../shared-kernel";
import { ProviderId, ProviderVersion } from "./provider";

/**
 * The input of a run as the provider returned it, frozen for that run. The adapter creates it once and never
 * updates it; a changed source produces a new snapshot. Content from the source is untrusted data.
 */
export const InputSnapshot = z.object({
  tenantId: TenantId,
  projectId: ProjectId,
  runId: RunId,
  providerId: ProviderId,
  providerVersion: ProviderVersion,
  /** Identifier in the source system, for example a Jira issue key. */
  sourceId: z.string().min(1).max(200).optional(),
  sourceUrl: z.url().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
  acceptanceCriteria: z.array(z.string().min(1).max(2_000)).max(100),
  /** Only fields the provider is allowed to expose. */
  metadata: z
    .record(z.string(), z.string().max(1_000))
    .refine((metadata) => Object.keys(metadata).length <= 50, "at most 50 metadata entries"),
  sourceUpdatedAt: Timestamp.optional(),
  fetchedAt: Timestamp,
  /** SHA-256 of the normalized content, computed by the adapter. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type InputSnapshot = z.infer<typeof InputSnapshot>;
