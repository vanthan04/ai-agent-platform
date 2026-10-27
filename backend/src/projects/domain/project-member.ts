import type { Role, UserId } from "../../shared-kernel";

export interface ProjectMember {
  readonly userId: UserId;
  readonly role: Role;
  readonly addedAt: string;
}
