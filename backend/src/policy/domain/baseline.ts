/**
 * The part of the policy no project can change (D8). Branch and executable lists here are always merged into a project's
 * policy; the rules in `evaluate()` (secret files, .git, force push, git history, publish and deploy, merge and delete on external
 * systems) are code and apply whatever a project sets.
 */

/** Matches `git.protected_branches` of ai-manifest.yaml. A project can protect more branches, never fewer. */
export const BASELINE_PROTECTED_BRANCHES: readonly string[] = ["main", "master", "develop", "staging", "production", "release/*"];

/** Infrastructure and remote-access tools no agent run may start. A project can forbid more, never fewer. */
export const BASELINE_FORBIDDEN_EXECUTABLES: readonly string[] = ["aws", "terraform", "serverless", "sls", "ssh", "scp"];

/** Shells and privilege escalation: allowing one lets a run do anything and so voids every other rule. */
export const NEVER_ALLOWABLE_EXECUTABLES: readonly string[] = [
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "cmd",
  "powershell",
  "pwsh",
  "sudo",
  "su",
  "doas",
  "runas",
];

/** Highest values a project may set for its limits. */
export const LIMIT_CEILINGS = { commandTimeoutSeconds: 3_600, maxToolCallsPerRun: 500 } as const;

export const DEFAULT_LIMITS = { commandTimeoutSeconds: 600, maxToolCallsPerRun: 100 } as const;

export interface BaselineRule {
  readonly id: string;
  readonly description: string;
}

/** What `evaluate()` enforces for every project, in words a person can read on a settings screen. */
export const BASELINE_RULES: readonly BaselineRule[] = [
  { id: "secret_files", description: "Credential and secret files (.env, keys, tokens) are never read or changed." },
  { id: "workspace_escape", description: "Paths outside the workspace are never accessed." },
  { id: "git_internals", description: ".git internals and node_modules are never edited by hand." },
  { id: "force_push", description: "Force push is never allowed." },
  { id: "protected_branches", description: "Protected branches are never pushed to." },
  { id: "git_history", description: "git reset, clean, rebase, merge, pull, stash, tag and similar commands are not available to a run." },
  { id: "release_and_deploy", description: "Publishing or deploying a package (npm, pnpm, yarn, bun publish or deploy) is denied." },
  { id: "external_systems", description: "Merging pull requests and creating, forking or deleting repositories or files on external systems is denied." },
  { id: "publish_approval", description: "Publishing code needs a persisted PM or PL approval of the exact diff and target branch." },
];
