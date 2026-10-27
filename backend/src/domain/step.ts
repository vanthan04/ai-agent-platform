import { z } from "zod";
import { RunId, StepId, TenantId, Timestamp, ToolCallId } from "./ids";

/** allow: run it. ask: needs a persisted human approval first. deny: never. */
export const PolicyDecision = z.enum(["allow", "ask", "deny"]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export const StepName = z.enum(["prepare", "analyze", "plan", "implement", "verify", "publish"]);
export type StepName = z.infer<typeof StepName>;

export const StepStatus = z.enum(["pending", "running", "succeeded", "failed", "skipped"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const Step = z.object({
  id: StepId,
  tenantId: TenantId,
  runId: RunId,
  name: StepName,
  status: StepStatus,
  startedAt: Timestamp.optional(),
  finishedAt: Timestamp.optional(),
});
export type Step = z.infer<typeof Step>;

/** Summaries are stored already masked by the secrets layer; never raw arguments or output. */
export const ToolCall = z.object({
  id: ToolCallId,
  tenantId: TenantId,
  runId: RunId,
  stepId: StepId,
  tool: z.string().min(1),
  argsSummary: z.string().max(500),
  decision: PolicyDecision,
  ok: z.boolean().optional(),
  resultSummary: z.string().max(500).optional(),
  requestedAt: Timestamp,
  completedAt: Timestamp.optional(),
});
export type ToolCall = z.infer<typeof ToolCall>;
