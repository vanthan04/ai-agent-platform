import { z } from "zod";

/** The rules a name or description must satisfy live here once; the API reuses these schemas to read a request. */
export const ProjectName = z.string().trim().min(1).max(100).brand<"ProjectName">();
export type ProjectName = z.infer<typeof ProjectName>;

export const ProjectDescription = z.string().trim().max(2_000).brand<"ProjectDescription">();
export type ProjectDescription = z.infer<typeof ProjectDescription>;
