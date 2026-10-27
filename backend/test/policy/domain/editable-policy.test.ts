import { describe, expect, it } from "vitest";
import {
  BASELINE_FORBIDDEN_EXECUTABLES,
  BASELINE_PROTECTED_BRANCHES,
  BASELINE_RULES,
  DEFAULT_EDITABLE_POLICY,
  EditablePolicy,
  LIMIT_CEILINGS,
  NEVER_ALLOWABLE_EXECUTABLES,
  buildPolicyContext,
  describeBaseline,
  evaluate,
  type Action,
} from "../../../src/policy";

const policy = (overrides: Record<string, unknown> = {}) => ({
  allowedExecutables: [],
  extraForbiddenExecutables: [],
  extraProtectedBranches: [],
  limits: { commandTimeoutSeconds: 600, maxToolCallsPerRun: 100 },
  ...overrides,
});

const parse = (value: unknown) => EditablePolicy.safeParse(value);

describe("EditablePolicy", () => {
  it("accepts the default and a typical project policy", () => {
    expect(parse(DEFAULT_EDITABLE_POLICY).success).toBe(true);
    expect(
      parse(policy({ allowedExecutables: ["node", "pnpm", "tsc"], extraForbiddenExecutables: ["make"], extraProtectedBranches: ["hotfix/*"] })).success,
    ).toBe(true);
  });

  it("normalises program names and removes repeats", () => {
    const result = EditablePolicy.parse(policy({ allowedExecutables: ["  PNPM ", "pnpm", "node"], extraProtectedBranches: ["hotfix/*", "hotfix/*"] }));
    expect(result.allowedExecutables).toEqual(["pnpm", "node"]);
    expect(result.extraProtectedBranches).toEqual(["hotfix/*"]);
  });

  it("never allows a shell or a privilege-escalation program", () => {
    for (const name of NEVER_ALLOWABLE_EXECUTABLES) {
      expect(parse(policy({ allowedExecutables: [name] })).success, name).toBe(false);
    }
    expect(parse(policy({ allowedExecutables: ["BASH"] })).success).toBe(false);
  });

  it("refuses to allow a program the baseline or the project forbids", () => {
    for (const name of BASELINE_FORBIDDEN_EXECUTABLES) {
      expect(parse(policy({ allowedExecutables: [name] })).success, name).toBe(false);
    }
    expect(parse(policy({ allowedExecutables: ["make"], extraForbiddenExecutables: ["make"] })).success).toBe(false);
  });

  it("accepts only bare program names", () => {
    for (const bad of ["/usr/bin/node", "..\\node", "node.exe", "pnpm.cmd", "my tool", "", "-x", "a;b"]) {
      expect(parse(policy({ allowedExecutables: [bad] })).success, bad).toBe(false);
    }
  });

  it("keeps the limits inside the ceilings", () => {
    expect(parse(policy({ limits: { commandTimeoutSeconds: LIMIT_CEILINGS.commandTimeoutSeconds, maxToolCallsPerRun: LIMIT_CEILINGS.maxToolCallsPerRun } })).success).toBe(true);
    expect(parse(policy({ limits: { commandTimeoutSeconds: LIMIT_CEILINGS.commandTimeoutSeconds + 1, maxToolCallsPerRun: 1 } })).success).toBe(false);
    expect(parse(policy({ limits: { commandTimeoutSeconds: 1, maxToolCallsPerRun: LIMIT_CEILINGS.maxToolCallsPerRun + 1 } })).success).toBe(false);
    expect(parse(policy({ limits: { commandTimeoutSeconds: 0, maxToolCallsPerRun: 1 } })).success).toBe(false);
    expect(parse(policy({ limits: { commandTimeoutSeconds: 1.5, maxToolCallsPerRun: 1 } })).success).toBe(false);
  });

  it("has no field that could touch the baseline", () => {
    expect(parse(policy({ protectedBranches: [] })).success).toBe(false);
    expect(parse(policy({ forbiddenExecutables: [] })).success).toBe(false);
    expect(parse(policy({ secretFiles: "allow" })).success).toBe(false);
    expect(parse(policy({ allowForcePush: true })).success).toBe(false);
  });

  it("refuses a branch pattern that would protect or match everything", () => {
    expect(parse(policy({ extraProtectedBranches: ["*"] })).success).toBe(false);
  });
});

describe("MCP tool decisions", () => {
  it("defaults to none, so a policy saved before they existed still reads", () => {
    expect(EditablePolicy.parse(policy()).mcpToolDecisions).toEqual({});
    expect(DEFAULT_EDITABLE_POLICY.mcpToolDecisions).toEqual({});
  });

  it("accepts allow and ask per `<connection>:<tool>` and nothing else", () => {
    expect(parse(policy({ mcpToolDecisions: { "github:create_issue": "allow", "jira:get-issue": "ask" } })).success).toBe(true);
    expect(parse(policy({ mcpToolDecisions: { "github:create_issue": "deny" } })).success).toBe(false);
    expect(parse(policy({ mcpToolDecisions: { "github:create_issue": true } })).success).toBe(false);
    for (const key of ["create_issue", "GitHub:create_issue", "github:", ":tool", "github:a b", "git hub:tool", "a:b:c"]) {
      expect(parse(policy({ mcpToolDecisions: { [key]: "allow" } })).success, key).toBe(false);
    }
  });

  it("bounds how many tools a policy can list", () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`github:tool_${i}`, "allow"]));
    expect(parse(policy({ mcpToolDecisions: many(200) })).success).toBe(true);
    expect(parse(policy({ mcpToolDecisions: many(201) })).success).toBe(false);
  });

  it("reaches evaluate(): an allowed tool runs, every other tool asks, and no tool is ever denied by this setting", () => {
    const context = buildPolicyContext(EditablePolicy.parse(policy({ mcpToolDecisions: { "github:get_issue": "allow", "github:create_issue": "ask" } })));
    expect(context.mcpToolDecisions).toEqual({ "github:get_issue": "allow", "github:create_issue": "ask" });
    const decide = (connection: string, tool: string) => evaluate({ kind: "mcp_tool_call", connection, tool }, context).decision;
    expect(decide("github", "get_issue")).toBe("allow");
    expect(decide("github", "create_issue")).toBe("ask");
    expect(decide("github", "delete_repo")).toBe("ask");
    expect(decide("jira", "get_issue")).toBe("ask");
    expect(decide("github", "constructor")).toBe("ask");
    expect(decide("__proto__", "x")).toBe("ask");
    expect(evaluate({ kind: "mcp_tool_call", connection: "a", tool: "b" }, { protectedBranches: [], allowedExecutables: [], forbiddenExecutables: [] }).decision).toBe("ask");
  });
});

describe("buildPolicyContext", () => {
  it("always contains the baseline, whatever the project adds", () => {
    const context = buildPolicyContext(EditablePolicy.parse(policy({ extraProtectedBranches: ["hotfix/*"], extraForbiddenExecutables: ["make"] })));
    for (const branch of BASELINE_PROTECTED_BRANCHES) expect(context.protectedBranches).toContain(branch);
    for (const name of BASELINE_FORBIDDEN_EXECUTABLES) expect(context.forbiddenExecutables).toContain(name);
    expect(context.protectedBranches).toContain("hotfix/*");
    expect(context.forbiddenExecutables).toContain("make");
    const empty = buildPolicyContext(DEFAULT_EDITABLE_POLICY);
    expect(empty.protectedBranches).toEqual([...BASELINE_PROTECTED_BRANCHES]);
    expect(empty.forbiddenExecutables).toEqual([...BASELINE_FORBIDDEN_EXECUTABLES]);
    expect(empty.allowedExecutables).toEqual([]);
  });
});

describe("what a project's policy changes in evaluate()", () => {
  const permissive = buildPolicyContext(
    EditablePolicy.parse(policy({ allowedExecutables: ["node", "pnpm", "git", "tsc", "make"], extraForbiddenExecutables: ["rm"], extraProtectedBranches: ["hotfix/*"] })),
  );
  const decide = (action: Action) => evaluate(action, permissive).decision;

  it("allows an executable the project allowed and asks about one it did not", () => {
    expect(decide({ kind: "run_command", executable: "tsc", args: ["--noEmit"] })).toBe("allow");
    expect(decide({ kind: "run_command", executable: "eslint", args: ["."] })).toBe("ask");
  });

  it("denies an executable the project forbade and every baseline-forbidden one", () => {
    expect(decide({ kind: "run_command", executable: "rm", args: ["-rf", "x"] })).toBe("deny");
    for (const name of BASELINE_FORBIDDEN_EXECUTABLES) expect(decide({ kind: "run_command", executable: name, args: [] })).toBe("deny");
  });

  it("denies a push to a branch the project protected and to every baseline-protected one", () => {
    expect(decide({ kind: "git_push", branch: "hotfix/1", force: false })).toBe("deny");
    for (const branch of ["main", "master", "develop", "staging", "production", "release/1.0"]) {
      expect(decide({ kind: "git_push", branch, force: false })).toBe("deny");
    }
    expect(decide({ kind: "git_push", branch: "feat/abc-1-thing", force: false })).toBe("ask");
  });

  it("keeps every baseline rule in force even for the most permissive policy", () => {
    expect(decide({ kind: "read_file", path: ".env" })).toBe("deny");
    expect(decide({ kind: "write_file", path: "config/credentials.json" })).toBe("deny");
    expect(decide({ kind: "read_file", path: "../outside.txt" })).toBe("deny");
    expect(decide({ kind: "write_file", path: ".git/config" })).toBe("deny");
    expect(decide({ kind: "write_file", path: "node_modules/x/index.js" })).toBe("deny");
    expect(decide({ kind: "git_push", branch: "feat/x", force: true })).toBe("deny");
    for (const sub of ["reset", "clean", "rebase", "merge", "pull", "stash", "tag", "push"]) {
      expect(decide({ kind: "run_command", executable: "git", args: [sub] }), `git ${sub}`).toBe("deny");
    }
    expect(decide({ kind: "run_command", executable: "pnpm", args: ["publish"] })).toBe("deny");
    expect(decide({ kind: "run_command", executable: "pnpm", args: ["deploy"] })).toBe("deny");
    for (const operation of ["merge_pull_request", "delete_repository", "create_repository", "fork_repository", "delete_file", "push_files"]) {
      expect(decide({ kind: "external_write", system: "github", operation }), operation).toBe("deny");
    }
  });
});

describe("baseline description", () => {
  it("lists the fixed part for a read-only screen, with a reason for every rule", () => {
    const baseline = describeBaseline();
    expect(baseline.protectedBranches).toEqual([...BASELINE_PROTECTED_BRANCHES]);
    expect(baseline.forbiddenExecutables).toEqual([...BASELINE_FORBIDDEN_EXECUTABLES]);
    expect(baseline.neverAllowedExecutables).toEqual([...NEVER_ALLOWABLE_EXECUTABLES]);
    expect(baseline.limitCeilings).toEqual({ ...LIMIT_CEILINGS });
    expect(baseline.rules).toEqual(BASELINE_RULES);
    for (const rule of baseline.rules) {
      expect(rule.id).toMatch(/^[a-z_]+$/);
      expect(rule.description.length).toBeGreaterThan(20);
    }
    expect(new Set(baseline.rules.map((rule) => rule.id)).size).toBe(baseline.rules.length);
  });
});
