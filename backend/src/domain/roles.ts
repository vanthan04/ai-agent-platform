import { z } from "zod";

/** Same vocabulary as `members[].role` in ai-manifest.yaml. */
export const Role = z.enum(["PM", "PL", "DEV"]);
export type Role = z.infer<typeof Role>;

/** Only PM or PL may approve a publish (decision D3 in docs/decisions.md). */
export function canApprovePublish(role: Role): boolean {
  return role === "PM" || role === "PL";
}
