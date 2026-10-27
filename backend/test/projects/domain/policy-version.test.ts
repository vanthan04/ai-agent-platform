import { describe, expect, it } from "vitest";
import { DEFAULT_EDITABLE_POLICY, EditablePolicy } from "../../../src/policy";
import { PolicyUnchangedError, PolicyVersionConflictError, createPolicyVersion, type PolicyVersion } from "../../../src/projects";
import { UserId } from "../../../src/shared-kernel";
import { NOW } from "../../support/time";

const alice = UserId.parse("alice");
const policy = (allowed: string[] = [], branches: string[] = []) =>
  EditablePolicy.parse({ ...DEFAULT_EDITABLE_POLICY, allowedExecutables: allowed, extraProtectedBranches: branches });

const first = (): PolicyVersion =>
  createPolicyVersion({ latest: undefined, expectedVersion: 0, policy: policy(["node"]), changedBy: alice, comment: "start", now: NOW });

describe("createPolicyVersion", () => {
  it("numbers the first real edit 1, keeping who, when and why", () => {
    expect(first()).toEqual({ version: 1, policy: policy(["node"]), changedBy: alice, changedAt: NOW, comment: "start" });
  });

  it("numbers each next edit one higher", () => {
    const v2 = createPolicyVersion({ latest: first(), expectedVersion: 1, policy: policy(["node", "pnpm"]), changedBy: alice, comment: "", now: NOW });
    expect(v2.version).toBe(2);
  });

  it("refuses an edit made on top of a version that is no longer the latest", () => {
    const latest = first();
    expect(() => createPolicyVersion({ latest, expectedVersion: 0, policy: policy(["pnpm"]), changedBy: alice, comment: "", now: NOW })).toThrow(PolicyVersionConflictError);
    expect(() => createPolicyVersion({ latest, expectedVersion: 2, policy: policy(["pnpm"]), changedBy: alice, comment: "", now: NOW })).toThrow(PolicyVersionConflictError);
    expect(() => createPolicyVersion({ latest: undefined, expectedVersion: 1, policy: policy(["pnpm"]), changedBy: alice, comment: "", now: NOW })).toThrow(PolicyVersionConflictError);
  });

  it("counts a change of an MCP tool decision as a change, whatever the order of the tools", () => {
    const withTools = (tools: Record<string, "allow" | "ask">) => EditablePolicy.parse({ ...DEFAULT_EDITABLE_POLICY, mcpToolDecisions: tools });
    const latest = createPolicyVersion({
      latest: undefined,
      expectedVersion: 0,
      policy: withTools({ "github:get_issue": "allow", "jira:get_issue": "allow" }),
      changedBy: alice,
      comment: "",
      now: NOW,
    });
    expect(() =>
      createPolicyVersion({ latest, expectedVersion: 1, policy: withTools({ "jira:get_issue": "allow", "github:get_issue": "allow" }), changedBy: alice, comment: "", now: NOW }),
    ).toThrow(PolicyUnchangedError);
    expect(
      createPolicyVersion({ latest, expectedVersion: 1, policy: withTools({ "github:get_issue": "ask", "jira:get_issue": "allow" }), changedBy: alice, comment: "", now: NOW }).version,
    ).toBe(2);
  });

  it("refuses an edit that changes nothing, ignoring the order of list entries", () => {
    expect(() => createPolicyVersion({ latest: undefined, expectedVersion: 0, policy: DEFAULT_EDITABLE_POLICY, changedBy: alice, comment: "", now: NOW })).toThrow(PolicyUnchangedError);
    const latest = createPolicyVersion({ latest: undefined, expectedVersion: 0, policy: policy(["node", "pnpm"]), changedBy: alice, comment: "", now: NOW });
    expect(() => createPolicyVersion({ latest, expectedVersion: 1, policy: policy(["pnpm", "node"]), changedBy: alice, comment: "", now: NOW })).toThrow(PolicyUnchangedError);
  });
});
