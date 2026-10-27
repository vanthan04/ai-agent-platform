import { isProtectedBranch } from "../domain";
import type { Action, PolicyContext, PolicyResult } from "./action";
import { escapesWorkspace, isSecretPath, touchesGitDir, touchesNodeModules } from "./paths";

const allow = (reason: string): PolicyResult => ({ decision: "allow", reason });
const ask = (reason: string): PolicyResult => ({ decision: "ask", reason });
const deny = (reason: string): PolicyResult => ({ decision: "deny", reason });

/** Git subcommands that only read, or change the local sandbox checkout. */
const GIT_LOCAL = new Set(["status", "diff", "log", "show", "blame", "rev-parse", "ls-files", "ls-tree", "fetch", "add", "commit", "switch"]);
/** Git subcommands that rewrite history, discard work, or reach the remote; publishing has its own typed action. */
const GIT_BLOCKED = new Set(["push", "reset", "clean", "restore", "stash", "rebase", "merge", "pull", "cherry-pick", "revert", "tag", "rm", "mv", "remote", "config"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const BLOCKED_PM_SUBCOMMANDS = new Set(["publish", "deploy"]);
const BLOCKED_EXTERNAL_OPERATIONS = new Set(["merge_pull_request", "delete_repository", "create_repository", "fork_repository", "delete_file", "push_files"]);

const baseName = (executable: string): string =>
  (executable.replace(/\\/g, "/").split("/").at(-1) ?? "").toLowerCase().replace(/\.(exe|cmd|bat)$/, "");

/** First argument that is a subcommand, skipping git's global options (-C <dir>, -c <k=v>, other flags). */
function subcommand(args: readonly string[], valueFlags: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (valueFlags.includes(arg)) i++;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function evaluateFile(action: Extract<Action, { kind: "read_file" | "write_file" | "delete_path" }>): PolicyResult {
  if (escapesWorkspace(action.path)) return deny("path leaves the workspace");
  if (isSecretPath(action.path)) return deny("credential and secret files are never read or changed");
  if (touchesGitDir(action.path)) return deny(".git internals are not accessible");
  if (action.kind === "read_file") return allow("reading workspace files");
  if (touchesNodeModules(action.path)) return deny("node_modules is not edited by hand");
  if (action.kind === "delete_path") return ask("deleting needs approval");
  return allow("editing workspace files");
}

function evaluateCommand(action: Extract<Action, { kind: "run_command" }>, ctx: PolicyContext): PolicyResult {
  const exe = baseName(action.executable);
  if (ctx.forbiddenExecutables.map((e) => e.toLowerCase()).includes(exe)) return deny(`${exe} is forbidden`);

  if (exe === "git") {
    const sub = subcommand(action.args, ["-C", "-c"]);
    if (sub === undefined) return ask("git without a subcommand");
    if (GIT_BLOCKED.has(sub)) return deny(`git ${sub} is not available to the agent; publishing uses the approved push action`);
    if (GIT_LOCAL.has(sub)) return allow(`git ${sub} stays in the sandbox checkout`);
    return ask(`git ${sub} is not on the allowed list`);
  }

  if (PACKAGE_MANAGERS.has(exe)) {
    const sub = subcommand(action.args, []);
    if (sub !== undefined && BLOCKED_PM_SUBCOMMANDS.has(sub)) return deny(`${exe} ${sub} releases code`);
    if (action.args.includes("-g") || action.args.includes("--global")) return ask("global installs change the machine");
  }

  if (ctx.allowedExecutables.map((e) => e.toLowerCase()).includes(exe)) return allow(`${exe} is an allowed executable`);
  return ask(`${exe} is not on the allowed list`);
}

/** Pure decision for one action. `ask` means: only after a persisted human approval. */
export function evaluate(action: Action, ctx: PolicyContext): PolicyResult {
  switch (action.kind) {
    case "read_file":
    case "write_file":
    case "delete_path":
      return evaluateFile(action);
    case "run_command":
      return evaluateCommand(action, ctx);
    case "git_push":
      if (action.force) return deny("force push is never allowed");
      if (isProtectedBranch(action.branch, ctx.protectedBranches)) return deny(`${action.branch} is a protected branch`);
      return ask("publishing needs a PM or PL approval of the exact diff");
    case "external_write":
      if (BLOCKED_EXTERNAL_OPERATIONS.has(action.operation)) return deny(`${action.operation} is not available to the agent`);
      return ask(`${action.system} ${action.operation} is a draft until a human approves it`);
  }
}
