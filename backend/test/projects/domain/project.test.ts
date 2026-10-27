import { describe, expect, it } from "vitest";
import { canApprovePublish } from "../../../src/execution";
import {
  InsufficientRoleError,
  LastLeadError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  Project,
  ProjectDescription,
  ProjectName,
  canManageProject,
} from "../../../src/projects";
import { ProjectId, Role, TenantId, UserId } from "../../../src/shared-kernel";
import { NOW } from "../../support/time";

const alice = UserId.parse("alice");
const bob = UserId.parse("bob");
const carol = UserId.parse("carol");

const newProject = (): Project =>
  Project.create({
    id: ProjectId.parse("project-1"),
    tenantId: TenantId.parse("tenant-1"),
    name: ProjectName.parse("Shop"),
    description: ProjectDescription.parse(""),
    creator: alice,
    now: NOW,
  });

describe("value objects", () => {
  it("trim the text and bound its length", () => {
    expect(ProjectName.parse("  Shop  ")).toBe("Shop");
    expect(ProjectName.safeParse("   ").success).toBe(false);
    expect(ProjectName.safeParse("x".repeat(101)).success).toBe(false);
    expect(ProjectDescription.safeParse("x".repeat(2_001)).success).toBe(false);
    expect(ProjectDescription.safeParse("").success).toBe(true);
  });
});

describe("Project aggregate", () => {
  it("starts with its creator as the only member, a PL", () => {
    const project = newProject();
    expect(project.members()).toEqual([{ userId: alice, role: "PL", addedAt: NOW }]);
    expect(project.roleOf(alice)).toBe("PL");
    expect(project.roleOf(bob)).toBeUndefined();
  });

  it("lets a PL or PM change it and refuses a DEV or an outsider", () => {
    const project = newProject();
    project.addMember(alice, bob, "DEV", NOW);
    project.addMember(alice, carol, "PM", NOW);
    expect(() => project.rename(bob, ProjectName.parse("Hacked"), NOW)).toThrow(InsufficientRoleError);
    expect(() => project.describe(UserId.parse("stranger"), ProjectDescription.parse("x"), NOW)).toThrow(InsufficientRoleError);
    project.rename(carol, ProjectName.parse("Renamed"), "2026-10-27T11:00:00Z");
    expect(project.name).toBe("Renamed");
    expect(project.updatedAt).toBe("2026-10-27T11:00:00Z");
    expect(project.createdAt).toBe(NOW);
  });

  it("keeps a user a member only once", () => {
    const project = newProject();
    project.addMember(alice, bob, "DEV", NOW);
    expect(() => project.addMember(alice, bob, "PM", NOW)).toThrow(MemberAlreadyExistsError);
    expect(() => project.addMember(alice, alice, "DEV", NOW)).toThrow(MemberAlreadyExistsError);
  });

  it("changes a role and refuses an unknown member", () => {
    const project = newProject();
    project.addMember(alice, bob, "DEV", NOW);
    expect(project.changeMemberRole(alice, bob, "PM", NOW)).toMatchObject({ userId: bob, role: "PM" });
    expect(project.roleOf(bob)).toBe("PM");
    expect(() => project.changeMemberRole(alice, carol, "DEV", NOW)).toThrow(MemberNotFoundError);
  });

  it("never lets the last PL leave, be demoted or be removed", () => {
    const project = newProject();
    expect(() => project.changeMemberRole(alice, alice, "PM", NOW)).toThrow(LastLeadError);
    expect(() => project.removeMember(alice, alice, NOW)).toThrow(LastLeadError);
    project.addMember(alice, bob, "PL", NOW);
    project.removeMember(bob, alice, NOW);
    expect(project.roleOf(alice)).toBeUndefined();
    expect(() => project.removeMember(bob, bob, NOW)).toThrow(LastLeadError);
    expect(project.members().map((member) => member.userId)).toEqual([bob]);
  });

  it("removes a member who is not a PL without touching the others", () => {
    const project = newProject();
    project.addMember(alice, bob, "DEV", NOW);
    project.addMember(alice, carol, "DEV", NOW);
    project.removeMember(alice, bob, NOW);
    expect(project.members().map((member) => member.userId)).toEqual([alice, carol]);
    expect(() => project.removeMember(alice, bob, NOW)).toThrow(MemberNotFoundError);
  });

  it("is rebuilt from its stored data without sharing state with it", () => {
    const original = newProject();
    const props = original.toProps();
    const copy = Project.restore(props);
    copy.addMember(alice, bob, "DEV", NOW);
    expect(original.roleOf(bob)).toBeUndefined();
    expect(props.members).toHaveLength(1);
  });
});

describe("permissions", () => {
  it("lets PM and PL manage a project and keeps DEV read-only", () => {
    expect(Role.options.filter(canManageProject)).toEqual(["PM", "PL"]);
  });

  it("matches publish approval today, so a change to one is a deliberate decision", () => {
    for (const role of Role.options) expect(canManageProject(role)).toBe(canApprovePublish(role));
  });
});
