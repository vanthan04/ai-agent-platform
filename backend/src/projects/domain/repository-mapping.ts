import { z } from "zod";
import type { BranchName, BranchPattern, RepoProvider, RepositoryMappingId } from "../../shared-kernel";

/** A repository address must be https or ssh and must never carry a password or token; credentials live in the secrets layer. */
function isAcceptableRepositoryUrl(value: string): boolean {
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(value)) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") return false;
  if (url.password !== "") return false;
  return url.protocol === "ssh:" || url.username === "";
}

export const RepositoryName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, "use letters, digits, dot, dash, underscore and slash")
  .refine((value) => value.split("/").every((segment) => segment !== "." && segment !== ".."), "not a valid repository name")
  .brand<"RepositoryName">();
export type RepositoryName = z.infer<typeof RepositoryName>;

export const RepositoryUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isAcceptableRepositoryUrl, "must be an https or ssh address without credentials")
  .brand<"RepositoryUrl">();
export type RepositoryUrl = z.infer<typeof RepositoryUrl>;

/**
 * A repository connected to a project, and the branches a run may start from there. It belongs to the `Project`
 * aggregate and changes only through it. Which branches may be pushed to is a separate matter (policy, D3, D8).
 */
export interface RepositoryMapping {
  readonly id: RepositoryMappingId;
  readonly provider: RepoProvider;
  readonly name: RepositoryName;
  readonly url: RepositoryUrl;
  readonly defaultBranch: BranchName;
  readonly allowedBranches: readonly BranchPattern[];
  readonly addedAt: string;
}
