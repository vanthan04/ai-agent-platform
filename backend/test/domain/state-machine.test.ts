import { describe, expect, it } from "vitest";
import { RunStatus, nextStatuses, transition, type TransitionContext } from "../../src/domain";
import { NOW, makeApproval, makeRun, publishDetails } from "./fixtures";

const ALL = RunStatus.options;

// Written out independently of the implementation table so the test is not a tautology.
const LEGAL_PAIRS: ReadonlyArray<readonly [RunStatus, RunStatus]> = [
  ["queued", "preparing"],
  ["queued", "cancelled"],
  ["preparing", "analyzing"],
  ["preparing", "blocked"],
  ["preparing", "failed"],
  ["preparing", "cancelled"],
  ["analyzing", "planning"],
  ["analyzing", "failed"],
  ["analyzing", "cancelled"],
  ["planning", "implementing"],
  ["planning", "failed"],
  ["planning", "cancelled"],
  ["implementing", "verifying"],
  ["implementing", "failed"],
  ["implementing", "cancelled"],
  ["verifying", "implementing"],
  ["verifying", "awaiting_approval"],
  ["verifying", "succeeded"],
  ["verifying", "failed"],
  ["verifying", "cancelled"],
  ["awaiting_approval", "publishing"],
  ["awaiting_approval", "rejected"],
  ["awaiting_approval", "failed"],
  ["awaiting_approval", "cancelled"],
  ["publishing", "succeeded"],
  ["publishing", "failed"],
];

describe("transition table", () => {
  it.each(ALL.flatMap((from) => ALL.map((to) => [from, to] as const)))("%s -> %s", (from, to) => {
    const expected = LEGAL_PAIRS.some(([f, t]) => f === from && t === to);
    expect(nextStatuses(from).includes(to)).toBe(expected);
  });
});

describe("transition()", () => {
  const withApproval: TransitionContext = { approval: makeApproval(), publish: publishDetails };

  it("sets startedAt when leaving queued and finishedAt on a terminal state", () => {
    const started = transition(makeRun("queued", false), "preparing", NOW);
    expect(started).toMatchObject({ ok: true, run: { status: "preparing", startedAt: NOW } });
    const cancelled = transition(makeRun("analyzing", false), "cancelled", NOW);
    expect(cancelled).toMatchObject({ ok: true, run: { finishedAt: NOW } });
  });

  it("does not mutate the input run", () => {
    const run = makeRun("queued", false);
    transition(run, "preparing", NOW);
    expect(run.status).toBe("queued");
  });

  it("refuses to leave a terminal state", () => {
    for (const status of ["succeeded", "rejected", "failed", "cancelled", "blocked"] as const) {
      expect(transition(makeRun(status, false), "queued", NOW).ok).toBe(false);
    }
  });

  it("requires a failure reason to enter failed", () => {
    expect(transition(makeRun("planning", false), "failed", NOW).ok).toBe(false);
    expect(transition(makeRun("planning", false), "failed", NOW, { failureReason: "tests red" })).toMatchObject({
      ok: true,
      run: { failureReason: "tests red" },
    });
  });

  it("blocks only from preparing, with a reason, and records it", () => {
    expect(transition(makeRun("preparing", false), "blocked", NOW).ok).toBe(false);
    expect(transition(makeRun("preparing", false), "blocked", NOW, { blockedReason: "two repositories match" })).toMatchObject({
      ok: true,
      run: { status: "blocked", blockedReason: "two repositories match", finishedAt: NOW },
    });
    for (const status of ["queued", "analyzing", "planning", "implementing", "verifying", "awaiting_approval", "publishing"] as const) {
      expect(transition(makeRun(status, false), "blocked", NOW, { blockedReason: "x" }).ok).toBe(false);
    }
  });

  it("a blocked run is never continued: moving on needs a new run", () => {
    const blocked = transition(makeRun("preparing", false), "blocked", NOW, { blockedReason: "x" });
    if (!blocked.ok) throw new Error("expected a blocked run");
    for (const to of ALL) expect(transition(blocked.run, to, NOW, { failureReason: "x", blockedReason: "x" }).ok).toBe(false);
  });

  it("a publishing run cannot skip approval to succeed, and a non-publishing run cannot ask for one", () => {
    expect(transition(makeRun("verifying", true), "succeeded", NOW).ok).toBe(false);
    expect(transition(makeRun("verifying", true), "awaiting_approval", NOW).ok).toBe(true);
    expect(transition(makeRun("verifying", false), "awaiting_approval", NOW).ok).toBe(false);
    expect(transition(makeRun("verifying", false), "succeeded", NOW).ok).toBe(true);
  });

  it("enters publishing only with a valid approval", () => {
    const run = makeRun("awaiting_approval", true);
    expect(transition(run, "publishing", NOW, withApproval).ok).toBe(true);
    expect(transition(run, "publishing", NOW).ok).toBe(false);
    expect(transition(run, "publishing", NOW, { publish: publishDetails }).ok).toBe(false);
    expect(transition(run, "publishing", NOW, { approval: makeApproval({ decision: "rejected" }), publish: publishDetails }).ok).toBe(false);
    expect(transition(run, "publishing", NOW, { approval: makeApproval({ approverRole: "DEV" }), publish: publishDetails }).ok).toBe(false);
    expect(transition(run, "publishing", NOW, { approval: makeApproval({ diffHash: "b".repeat(64) }), publish: publishDetails }).ok).toBe(false);
  });
});

describe("reachability (exhaustive, no approval available)", () => {
  function reachable(publishes: boolean): Set<RunStatus> {
    const seen = new Set<RunStatus>(["queued"]);
    const queue: RunStatus[] = ["queued"];
    while (queue.length > 0) {
      const from = queue.shift() as RunStatus;
      for (const to of ALL) {
        const result = transition(makeRun(from, publishes), to, NOW, { failureReason: "x" });
        if (result.ok && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  }

  it("publishing is unreachable without an approval", () => {
    expect(reachable(true).has("publishing")).toBe(false);
    expect(reachable(false).has("publishing")).toBe(false);
  });

  it("a publishing run cannot succeed without passing publishing", () => {
    expect(reachable(true).has("succeeded")).toBe(false);
  });

  it("a non-publishing run succeeds without ever asking for approval", () => {
    const seen = reachable(false);
    expect(seen.has("succeeded")).toBe(true);
    expect(seen.has("awaiting_approval")).toBe(false);
  });
});
