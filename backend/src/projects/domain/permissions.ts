import type { Role } from "../../shared-kernel";

/** Only PM or PL change a project and its members; DEV can view (D10, D12 in docs/decisions.md). */
export function canManageProject(role: Role): boolean {
  return role === "PM" || role === "PL";
}
