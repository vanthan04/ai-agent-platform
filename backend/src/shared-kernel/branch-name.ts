import { z } from "zod";

const branchText = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith("-") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".lock"), "not a valid branch name")
  .refine((value) => !value.includes("..") && !value.includes("//"), "not a valid branch name");

/** A concrete branch such as `develop`. */
export const BranchName = branchText.regex(/^[A-Za-z0-9._/-]+$/, "use letters, digits, dot, dash, underscore and slash").brand<"BranchName">();
export type BranchName = z.infer<typeof BranchName>;

/** A branch name where `*` may stand for any text, such as `release/*`. A pattern of only `*` would match everything, so it is refused. */
export const BranchPattern = branchText
  .regex(/^[A-Za-z0-9._/*-]+$/, "use letters, digits, dot, dash, underscore, slash and *")
  .refine((value) => /[A-Za-z0-9._-]/.test(value), "must name at least one literal character")
  .brand<"BranchPattern">();
export type BranchPattern = z.infer<typeof BranchPattern>;
