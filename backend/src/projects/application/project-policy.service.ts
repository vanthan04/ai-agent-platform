import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../identity";
import { DEFAULT_EDITABLE_POLICY, buildPolicyContext, describeBaseline, type EditablePolicy } from "../../policy";
import {
  InsufficientRoleError,
  createPolicyVersion,
  type PolicyComment,
  type PolicyVersion,
  type ProjectPolicyRepository,
  type ProjectRepository,
} from "../domain";
import { loadVisibleProject } from "./load-project";
import { CLOCK, PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY, type Clock } from "./ports";
import type { PolicyVersionView, PolicyView } from "./views";

const versionView = (version: PolicyVersion): PolicyVersionView => ({
  version: version.version,
  policy: version.policy,
  changedBy: version.changedBy,
  changedAt: version.changedAt,
  comment: version.comment,
});

const policyView = (latest: PolicyVersion | undefined): PolicyView => {
  const policy = latest?.policy ?? DEFAULT_EDITABLE_POLICY;
  const context = buildPolicyContext(policy);
  return {
    version: latest?.version ?? 0,
    policy,
    effective: {
      protectedBranches: [...context.protectedBranches],
      allowedExecutables: [...context.allowedExecutables],
      forbiddenExecutables: [...context.forbiddenExecutables],
    },
    baseline: describeBaseline(),
    ...(latest ? { changedBy: latest.changedBy, changedAt: latest.changedAt, comment: latest.comment } : {}),
  };
};

/** Use cases for the editable policy of a project (D8, D10): members read it, a PM or PL saves a new version of it. */
@Injectable()
export class ProjectPolicyService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(PROJECT_POLICY_REPOSITORY) private readonly policies: ProjectPolicyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async current(user: AuthUser, projectId: string): Promise<PolicyView> {
    const project = await loadVisibleProject(this.projects, user, projectId);
    return policyView(await this.policies.findLatest(project.tenantId, project.id));
  }

  async versions(user: AuthUser, projectId: string): Promise<PolicyVersionView[]> {
    const project = await loadVisibleProject(this.projects, user, projectId);
    return (await this.policies.listVersions(project.tenantId, project.id)).map(versionView);
  }

  async update(
    user: AuthUser,
    projectId: string,
    input: { expectedVersion: number; policy: EditablePolicy; comment?: PolicyComment },
  ): Promise<PolicyView> {
    const project = await loadVisibleProject(this.projects, user, projectId);
    if (!project.canBeManagedBy(user.userId)) throw new InsufficientRoleError();
    const version = createPolicyVersion({
      latest: await this.policies.findLatest(project.tenantId, project.id),
      expectedVersion: input.expectedVersion,
      policy: input.policy,
      changedBy: user.userId,
      comment: input.comment ?? "",
      now: this.clock.now(),
    });
    await this.policies.append(project.tenantId, project.id, version);
    return policyView(version);
  }
}
