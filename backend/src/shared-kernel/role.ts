import { z } from "zod";

/** Same vocabulary as `members[].role` in ai-manifest.yaml. What a role may do is decided by the context that owns the action. */
export const Role = z.enum(["PM", "PL", "DEV"]);
export type Role = z.infer<typeof Role>;
