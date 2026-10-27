import type { Role } from "../../shared-kernel";

/** Only PM or PL may approve a publish (decision D3 in docs/decisions.md). */
export function canApprovePublish(role: Role): boolean {
  return role === "PM" || role === "PL";
}
