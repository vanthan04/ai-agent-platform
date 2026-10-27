import { validatePublishApproval, type Approval, type PublishExpectation } from "./approval";
import { isTerminal, type Run, type RunStatus } from "./run";

const LEGAL: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["preparing", "cancelled"],
  preparing: ["analyzing", "blocked", "failed", "cancelled"],
  analyzing: ["planning", "failed", "cancelled"],
  planning: ["implementing", "failed", "cancelled"],
  implementing: ["verifying", "failed", "cancelled"],
  verifying: ["implementing", "awaiting_approval", "succeeded", "failed", "cancelled"],
  awaiting_approval: ["publishing", "rejected", "failed", "cancelled"],
  publishing: ["succeeded", "failed"],
  succeeded: [],
  rejected: [],
  failed: [],
  cancelled: [],
  blocked: [],
};

export function nextStatuses(from: RunStatus): readonly RunStatus[] {
  return LEGAL[from];
}

export interface TransitionContext {
  /** Required to enter `publishing`. */
  approval?: Approval;
  /** What is about to be published; required to enter `publishing`. */
  publish?: Omit<PublishExpectation, "runId">;
  /** Required to enter `failed`. */
  failureReason?: string;
  /** Required to enter `blocked`. */
  blockedReason?: string;
}

export type TransitionResult = { ok: true; run: Run } | { ok: false; reason: string };

const refuse = (reason: string): TransitionResult => ({ ok: false, reason });

/** Pure: returns a new run or the reason the move is refused. The only way into `publishing` is a valid approval. */
export function transition(
  run: Run,
  to: RunStatus,
  at: string,
  ctx: TransitionContext = {},
): TransitionResult {
  if (isTerminal(run.status)) return refuse(`run is ${run.status}; a terminal run cannot change`);
  if (!LEGAL[run.status].includes(to)) return refuse(`illegal transition ${run.status} -> ${to}`);

  if (run.status === "verifying" && to === "succeeded" && run.publishes) {
    return refuse("a publishing run must pass approval before it can succeed");
  }
  if (run.status === "verifying" && to === "awaiting_approval" && !run.publishes) {
    return refuse("a run that does not publish needs no approval");
  }

  if (to === "publishing") {
    if (!ctx.publish) return refuse("publish details are required to enter publishing");
    const check = validatePublishApproval(ctx.approval, { ...ctx.publish, runId: run.id });
    if (!check.ok) return refuse(check.reason);
  }

  if (to === "failed" && !ctx.failureReason) return refuse("failureReason is required");
  if (to === "blocked" && !ctx.blockedReason) return refuse("blockedReason is required");

  const next: Run = { ...run, status: to };
  if (run.status === "queued" && to === "preparing") next.startedAt = at;
  if (isTerminal(to)) next.finishedAt = at;
  if (to === "failed" && ctx.failureReason) next.failureReason = ctx.failureReason;
  if (to === "blocked" && ctx.blockedReason) next.blockedReason = ctx.blockedReason;
  return { ok: true, run: next };
}
