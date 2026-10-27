import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { BranchName, BranchPattern, RepoProvider, Role, UserId } from "../../shared-kernel";
import { EditablePolicy } from "../../policy";
import { PolicyComment, ProjectDescription, ProjectName, RepositoryName, RepositoryUrl } from "../domain";

export const CreateProjectBody = z.object({ name: ProjectName, description: ProjectDescription.optional() }).strict();

export const UpdateProjectBody = z
  .object({ name: ProjectName.optional(), description: ProjectDescription.optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.description !== undefined, "nothing to update");

export const AddMemberBody = z.object({ userId: UserId, role: Role }).strict();

export const ChangeMemberRoleBody = z.object({ role: Role }).strict();

/** `expectedVersion` is the version the editor saw; a stale one is refused instead of overwriting someone else's change. */
export const SavePolicyBody = z
  .object({ expectedVersion: z.number().int().min(0), policy: EditablePolicy, comment: PolicyComment.optional() })
  .strict();

const allowedBranches = z.array(BranchPattern).min(1).max(20);

export const AddRepositoryBody = z
  .object({ provider: RepoProvider, name: RepositoryName, url: RepositoryUrl, defaultBranch: BranchName, allowedBranches })
  .strict();

export const ChangeRepositoryBranchesBody = z
  .object({ defaultBranch: BranchName.optional(), allowedBranches: allowedBranches.optional() })
  .strict()
  .refine((body) => body.defaultBranch !== undefined || body.allowedBranches !== undefined, "nothing to update");

/** Rejects bad input with field paths and messages only, never the submitted values. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: "invalid request",
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return result.data;
}
