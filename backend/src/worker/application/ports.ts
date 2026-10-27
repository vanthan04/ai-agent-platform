export const REPOSITORY_INSPECTOR = Symbol("REPOSITORY_INSPECTOR");

/** Why the head of a branch could not be learned. One word each; nothing the remote side said is passed on. */
export type BranchHeadFailure =
  /** The branch is not there, or the repository does not exist or is private: from outside these look the same. */
  | "not_found"
  /** The repository address is not one this version can read (for example ssh). */
  | "unsupported"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "blocked_address"
  | "invalid_response";

export type BranchHead = { ok: true; commitSha: string } | { ok: false; reason: BranchHeadFailure };

/** Looks at a remote repository without cloning it. */
export interface RepositoryInspector {
  /** The commit the branch points at right now. */
  branchHead(target: { url: string; branch: string }): Promise<BranchHead>;
}

export interface Clock {
  now(): string;
}

export interface WorkerLog {
  info(message: string): void;
  error(message: string): void;
}
