import { z } from "zod";
import { ArtifactKind } from "./artifact";
import { ApprovalDecision } from "./approval";
import { ApprovalId, ArtifactId, EventId, RunId, StepId, TenantId, Timestamp, ToolCallId } from "../../shared-kernel";
import { RunStatus } from "./run";
import { PolicyDecision } from "../../policy";
import { StepName } from "./step";

const envelope = {
  id: EventId,
  tenantId: TenantId,
  runId: RunId,
  /** 1-based, contiguous per run; lets a client resume a stream after a given seq. */
  seq: z.number().int().positive(),
  at: Timestamp,
};

/** Append-only. Payloads carry summaries only: never secrets, tokens or raw customer data. */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("run.status_changed"), from: RunStatus, to: RunStatus }),
  z.object({ ...envelope, type: z.literal("step.started"), stepId: StepId, name: StepName }),
  z.object({
    ...envelope,
    type: z.literal("step.finished"),
    stepId: StepId,
    status: z.enum(["succeeded", "failed", "skipped"]),
  }),
  z.object({
    ...envelope,
    type: z.literal("tool_call.requested"),
    toolCallId: ToolCallId,
    tool: z.string().min(1),
    argsSummary: z.string().max(500),
    decision: PolicyDecision,
  }),
  z.object({
    ...envelope,
    type: z.literal("tool_call.completed"),
    toolCallId: ToolCallId,
    ok: z.boolean(),
    resultSummary: z.string().max(500),
  }),
  z.object({
    ...envelope,
    type: z.literal("approval.requested"),
    diffHash: z.string().regex(/^[0-9a-f]{64}$/),
    targetBranch: z.string().min(1),
  }),
  z.object({
    ...envelope,
    type: z.literal("approval.decided"),
    approvalId: ApprovalId,
    decision: ApprovalDecision,
  }),
  z.object({
    ...envelope,
    type: z.literal("artifact.created"),
    artifactId: ArtifactId,
    kind: ArtifactKind,
  }),
  z.object({
    ...envelope,
    type: z.literal("log"),
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string().max(2_000),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

export type SequenceCheck = { ok: true } | { ok: false; reason: string };

/** Events of one run, in order, must be numbered 1..n without gaps or repeats. */
export function checkEventSequence(events: readonly RunEvent[]): SequenceCheck {
  const first = events[0];
  if (!first) return { ok: true };
  for (const [index, event] of events.entries()) {
    if (event.runId !== first.runId) return { ok: false, reason: `event ${index + 1} belongs to another run` };
    if (event.seq !== index + 1) {
      return { ok: false, reason: `expected seq ${index + 1} at position ${index + 1}, got ${event.seq}` };
    }
  }
  return { ok: true };
}
