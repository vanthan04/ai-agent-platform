import { describe, expect, it } from "vitest";
import { evaluate, isSecretPath, type Action, type PolicyContext } from "../../src/policy";

const ctx: PolicyContext = {
  protectedBranches: ["main", "master", "develop", "staging", "production", "release/*"],
  allowedExecutables: ["node", "pnpm", "npm", "tsc", "vitest", "eslint"],
  forbiddenExecutables: ["aws", "terraform", "ssh", "scp"],
};

const decide = (action: Action) => evaluate(action, ctx).decision;
const run = (executable: string, ...args: string[]): Action => ({ kind: "run_command", executable, args });

// Rows follow the permissions table in harness-engineering/core/policies/permissions.md.
describe("files", () => {
  it("reads and edits ordinary workspace files", () => {
    expect(decide({ kind: "read_file", path: "src/app.ts" })).toBe("allow");
    expect(decide({ kind: "write_file", path: "src/app.ts" })).toBe("allow");
    expect(decide({ kind: "read_file", path: ".env.example" })).toBe("allow");
  });

  it.each([".env", ".env.local", "config/.env.production", "keys/server.pem", "deploy.key", "id_rsa", "credentials.json", "secrets.yml", ".npmrc", "infra/prod.tfvars", "auth.json"])(
    "never reads or writes the secret file %s",
    (path) => {
      expect(isSecretPath(path)).toBe(true);
      expect(decide({ kind: "read_file", path })).toBe("deny");
      expect(decide({ kind: "write_file", path })).toBe("deny");
      expect(decide({ kind: "delete_path", path })).toBe("deny");
    },
  );

  it("denies paths that leave the workspace, .git internals, and hand edits of node_modules", () => {
    expect(decide({ kind: "read_file", path: "../other/file.ts" })).toBe("deny");
    expect(decide({ kind: "read_file", path: "a\\..\\b.ts" })).toBe("deny");
    expect(decide({ kind: "read_file", path: ".git/config" })).toBe("deny");
    expect(decide({ kind: "write_file", path: "node_modules/x/index.js" })).toBe("deny");
    expect(decide({ kind: "read_file", path: "node_modules/x/index.js" })).toBe("allow");
  });

  it("asks before deleting a normal file", () => {
    expect(decide({ kind: "delete_path", path: "src/old.ts" })).toBe("ask");
  });
});

describe("commands", () => {
  it("allows verification tooling and read-only or local git", () => {
    expect(decide(run("pnpm", "test"))).toBe("allow");
    expect(decide(run("node", "script.mjs"))).toBe("allow");
    expect(decide(run("git", "status"))).toBe("allow");
    expect(decide(run("git", "-C", "repo", "diff"))).toBe("allow");
    expect(decide(run("git", "-c", "core.pager=cat", "log"))).toBe("allow");
    expect(decide(run("git", "commit", "-m", "x"))).toBe("allow");
  });

  it("denies forbidden executables however they are spelled", () => {
    expect(decide(run("aws", "s3", "ls"))).toBe("deny");
    expect(decide(run("C:\\tools\\Terraform.exe", "apply"))).toBe("deny");
    expect(decide(run("/usr/bin/ssh", "host"))).toBe("deny");
  });

  it.each(["push", "reset", "clean", "restore", "stash", "rebase", "merge", "pull", "cherry-pick", "tag", "remote", "config"])(
    "denies git %s, including behind global options",
    (sub) => {
      expect(decide(run("git", sub))).toBe("deny");
      expect(decide(run("git", "-C", "repo", sub))).toBe("deny");
    },
  );

  it("denies releasing code and asks before global installs", () => {
    expect(decide(run("npm", "publish"))).toBe("deny");
    expect(decide(run("pnpm", "deploy"))).toBe("deny");
    expect(decide(run("npm", "install", "-g", "left-pad"))).toBe("ask");
  });

  it("asks about anything not on the allowed list", () => {
    expect(decide(run("curl", "https://example.invalid"))).toBe("ask");
    expect(decide(run("git", "bisect"))).toBe("ask");
  });
});

describe("git push", () => {
  it("asks for a normal work branch", () => {
    expect(decide({ kind: "git_push", branch: "feat/abc-1-x", force: false })).toBe("ask");
  });

  it.each(["main", "master", "develop", "staging", "production", "release/1.2", "refs/heads/main"])("denies a push to protected %s", (branch) => {
    expect(decide({ kind: "git_push", branch, force: false })).toBe("deny");
  });

  it("denies a force push even to a work branch", () => {
    expect(decide({ kind: "git_push", branch: "feat/abc-1-x", force: true })).toBe("deny");
  });
});

describe("external writes", () => {
  it("treats ordinary writes as drafts that need approval", () => {
    expect(decide({ kind: "external_write", system: "jira", operation: "add_comment" })).toBe("ask");
    expect(decide({ kind: "external_write", system: "github", operation: "create_pull_request" })).toBe("ask");
  });

  it("denies merging, deleting and force-publishing operations", () => {
    for (const operation of ["merge_pull_request", "delete_repository", "push_files", "create_repository"]) {
      expect(decide({ kind: "external_write", system: "github", operation })).toBe("deny");
    }
  });
});
