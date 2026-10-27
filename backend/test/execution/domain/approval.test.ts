import { describe, expect, it } from "vitest";
import { canApprovePublish, validatePublishApproval, type PublishExpectation } from "../../../src/execution";
import { DIFF_HASH, PROTECTED, ids, makeApproval } from "./fixtures";

const expected: PublishExpectation = {
  runId: ids.run,
  diffHash: DIFF_HASH,
  targetBranch: "feat/abc-1-thing",
  protectedBranches: PROTECTED,
};

describe("canApprovePublish", () => {
  it("allows PM and PL only", () => {
    expect(canApprovePublish("PM")).toBe(true);
    expect(canApprovePublish("PL")).toBe(true);
    expect(canApprovePublish("DEV")).toBe(false);
  });
});

describe("validatePublishApproval", () => {
  it("accepts a matching approval from a PL", () => {
    expect(validatePublishApproval(makeApproval(), expected)).toEqual({ ok: true });
  });

  it.each([
    ["no approval", undefined, "no approval"],
    ["a rejection", makeApproval({ decision: "rejected" }), "not granted"],
    ["a DEV approver", makeApproval({ approverRole: "DEV" }), "cannot approve"],
    ["another run", makeApproval({ runId: "run-2" }), "another run"],
    ["a changed diff", makeApproval({ diffHash: "c".repeat(64) }), "diff changed"],
    ["a different branch", makeApproval({ targetBranch: "feat/other" }), "target branch differs"],
  ])("rejects %s", (_label, approval, reason) => {
    const result = validatePublishApproval(approval, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("rejects a protected target even when approved for it", () => {
    const approval = makeApproval({ targetBranch: "develop" });
    const result = validatePublishApproval(approval, { ...expected, targetBranch: "develop" });
    expect(result).toEqual({ ok: false, reason: "develop is a protected branch" });
  });
});
