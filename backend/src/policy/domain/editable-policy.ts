import { z } from "zod";
import { BranchPattern } from "../../shared-kernel";
import type { PolicyContext } from "./action";
import {
  BASELINE_FORBIDDEN_EXECUTABLES,
  BASELINE_PROTECTED_BRANCHES,
  BASELINE_RULES,
  DEFAULT_LIMITS,
  LIMIT_CEILINGS,
  NEVER_ALLOWABLE_EXECUTABLES,
  type BaselineRule,
} from "./baseline";

/** A bare program name as `evaluate()` compares it: lower case, no path, no extension. */
export const ExecutableName = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._+-]*$/, "use a plain executable name")
  .refine((value) => !/\.(exe|cmd|bat)$/.test(value), "give the name without .exe, .cmd or .bat")
  .brand<"ExecutableName">();
export type ExecutableName = z.infer<typeof ExecutableName>;

/** `<connection>:<tool>`: the connection's name in the project, then the tool's name on that MCP server. */
export const McpToolKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9_.-]{1,64}$/, "use <connection>:<tool>");

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * What a PM or PL of a project may change (D10). Everything else about the policy is the baseline and is not here, so no
 * value of this type can relax it: the lists only add to the baseline, and the checks below refuse a value that would
 * allow what the baseline forbids.
 */
export const EditablePolicy = z
  .object({
    /** Programs a run may start without asking. */
    allowedExecutables: z.array(ExecutableName).max(50),
    /** Programs forbidden in this project, on top of the baseline. */
    extraForbiddenExecutables: z.array(ExecutableName).max(50),
    /** Branches nobody pushes to in this project, on top of the baseline. */
    extraProtectedBranches: z.array(BranchPattern).max(50),
    /** Whether a run may call an MCP tool without asking. A tool not listed here always asks (D9, D10). */
    mcpToolDecisions: z
      .record(McpToolKey, z.enum(["allow", "ask"]))
      .refine((decisions) => Object.keys(decisions).length <= 200, "at most 200 tools")
      .default({}),
    limits: z
      .object({
        commandTimeoutSeconds: z.number().int().min(1).max(LIMIT_CEILINGS.commandTimeoutSeconds),
        maxToolCallsPerRun: z.number().int().min(1).max(LIMIT_CEILINGS.maxToolCallsPerRun),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    for (const [index, name] of policy.allowedExecutables.entries()) {
      const path = ["allowedExecutables", index];
      if (NEVER_ALLOWABLE_EXECUTABLES.includes(name)) {
        ctx.addIssue({ code: "custom", path, message: "a shell or privilege-escalation program can never be allowed" });
      } else if (BASELINE_FORBIDDEN_EXECUTABLES.includes(name) || policy.extraForbiddenExecutables.includes(name)) {
        ctx.addIssue({ code: "custom", path, message: "this program is forbidden, so it cannot also be allowed" });
      }
    }
  })
  .transform((policy) => ({
    ...policy,
    allowedExecutables: unique(policy.allowedExecutables),
    extraForbiddenExecutables: unique(policy.extraForbiddenExecutables),
    extraProtectedBranches: unique(policy.extraProtectedBranches),
  }));
export type EditablePolicy = z.output<typeof EditablePolicy>;

/** What a project has before anyone edits it: nothing is allowed without asking, nothing extra is protected. */
export const DEFAULT_EDITABLE_POLICY: EditablePolicy = {
  allowedExecutables: [],
  extraForbiddenExecutables: [],
  extraProtectedBranches: [],
  mcpToolDecisions: {},
  limits: { ...DEFAULT_LIMITS },
};

/** The input of `evaluate()` for a project: the baseline lists plus what the project added. */
export function buildPolicyContext(policy: EditablePolicy): PolicyContext {
  return {
    protectedBranches: unique([...BASELINE_PROTECTED_BRANCHES, ...policy.extraProtectedBranches]),
    allowedExecutables: [...policy.allowedExecutables],
    forbiddenExecutables: unique([...BASELINE_FORBIDDEN_EXECUTABLES, ...policy.extraForbiddenExecutables]),
    mcpToolDecisions: { ...policy.mcpToolDecisions },
  };
}

export interface BaselineDescription {
  protectedBranches: readonly string[];
  forbiddenExecutables: readonly string[];
  neverAllowedExecutables: readonly string[];
  limitCeilings: { commandTimeoutSeconds: number; maxToolCallsPerRun: number };
  rules: readonly BaselineRule[];
}

/** The fixed part, for a screen that shows it read-only next to the editable part. */
export function describeBaseline(): BaselineDescription {
  return {
    protectedBranches: BASELINE_PROTECTED_BRANCHES,
    forbiddenExecutables: BASELINE_FORBIDDEN_EXECUTABLES,
    neverAllowedExecutables: NEVER_ALLOWABLE_EXECUTABLES,
    limitCeilings: { ...LIMIT_CEILINGS },
    rules: BASELINE_RULES,
  };
}
