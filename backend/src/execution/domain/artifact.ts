import { z } from "zod";
import { ArtifactId, RunId, TenantId, Timestamp } from "../../shared-kernel";

export const ArtifactKind = z.enum(["diff", "report", "log", "test_report", "pull_request"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const Artifact = z.object({
  id: ArtifactId,
  tenantId: TenantId,
  runId: RunId,
  kind: ArtifactKind,
  name: z.string().min(1).max(200),
  /** Opaque storage location; the storage layer decides what it means. */
  uri: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  createdAt: Timestamp,
});
export type Artifact = z.infer<typeof Artifact>;
