import { z } from "zod";

export const RepoProvider = z.enum(["github", "codecommit"]);
export type RepoProvider = z.infer<typeof RepoProvider>;

/** A repository and the branch work starts from. Shared because tasks and repository resolution both name one. */
export const RepoRef = z.object({
  provider: RepoProvider,
  name: z.string().min(1),
  url: z.string().min(1),
  baseBranch: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRef>;
