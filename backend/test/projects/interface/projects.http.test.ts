import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app/app.module";
import { APP_CONFIG, loadConfig } from "../../../src/config/config";
import { AUTHENTICATOR, type AuthUser, type AuthenticationRequest, type Authenticator } from "../../../src/identity";
import { PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY } from "../../../src/projects";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryProjectPolicyRepository } from "../../support/in-memory-project-policy.repository";
import { InMemoryProjectRepository } from "../../support/in-memory-project.repository";

/** Test double for real authentication: the caller is named in a header, no header means not signed in. */
class HeaderAuthenticator implements Authenticator {
  authenticate(req: AuthenticationRequest): AuthUser | undefined {
    const header = req.headers["x-test-user"];
    if (typeof header !== "string") return undefined;
    const [userId, tenantId = "tenant-1"] = header.split("@");
    return { userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) };
  }
}

describe("projects over HTTP", () => {
  let app: INestApplication;
  const as = (user: string) => ({ "x-test-user": user });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: "test" }))
      .overrideProvider(AUTHENTICATOR)
      .useValue(new HeaderAuthenticator())
      .overrideProvider(PROJECT_REPOSITORY)
      .useValue(new InMemoryProjectRepository())
      .overrideProvider(PROJECT_POLICY_REPOSITORY)
      .useValue(new InMemoryProjectPolicyRepository())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const createProject = async (owner: string, name: string): Promise<string> => {
    const created = await http().post("/projects").set(as(owner)).send({ name }).expect(201);
    return created.body.id as string;
  };

  it("keeps /health open and every other route closed to an unknown caller", async () => {
    await http().get("/health").expect(200, { status: "ok" });
    await http().get("/projects").expect(401);
    await http().post("/projects").send({ name: "x" }).expect(401);
  });

  it("creates a project for the caller as PL and shows it in their list", async () => {
    const created = await http().post("/projects").set(as("alice")).send({ name: "Shop", description: "web shop" }).expect(201);
    expect(created.body).toMatchObject({ name: "Shop", description: "web shop", role: "PL" });
    expect(created.body).not.toHaveProperty("tenantId");
    const list = await http().get("/projects").set(as("alice")).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toContain("Shop");
  });

  it("rejects a bad body with field paths only and never echoes what was sent", async () => {
    const response = await http().post("/projects").set(as("alice")).send({ name: "", token: "hunter2-not-a-real-secret" }).expect(400);
    expect(response.body.message).toBe("invalid request");
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    await http().post("/projects").set(as("alice")).send({ name: "x".repeat(101) }).expect(400);
  });

  it("answers 409 for a duplicate name", async () => {
    await createProject("alice", "Dup");
    await http().post("/projects").set(as("bob")).send({ name: "Dup" }).expect(409);
  });

  it("answers 404 to someone who is not a member, even though the project exists", async () => {
    const id = await createProject("alice", "Private");
    await http().get(`/projects/${id}`).set(as("bob")).expect(404);
    await http().get(`/projects/${id}`).set(as("alice@tenant-2")).expect(404);
    await http().get(`/projects/${id}/members`).set(as("bob")).expect(404);
    await http().get(`/projects/${id}`).set(as("alice")).expect(200);
  });

  it("lets a PL edit, refuses a DEV with 403 and a non-member with 404", async () => {
    const id = await createProject("alice", "Editable");
    await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
    await http().patch(`/projects/${id}`).set(as("dev")).send({ name: "Nope" }).expect(403);
    await http().patch(`/projects/${id}`).set(as("stranger")).send({ name: "Nope" }).expect(404);
    const updated = await http().patch(`/projects/${id}`).set(as("alice")).send({ description: "now documented" }).expect(200);
    expect(updated.body).toMatchObject({ name: "Editable", description: "now documented" });
    await http().patch(`/projects/${id}`).set(as("alice")).send({}).expect(400);
  });

  it("manages members: add, list, change role, remove", async () => {
    const id = await createProject("alice", "Team");
    const added = await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "bob", role: "DEV" }).expect(201);
    expect(added.body).toMatchObject({ userId: "bob", role: "DEV" });
    await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "bob", role: "PM" }).expect(409);
    const list = await http().get(`/projects/${id}/members`).set(as("bob")).expect(200);
    expect(list.body.map((m: { userId: string }) => m.userId)).toEqual(["alice", "bob"]);
    await http().patch(`/projects/${id}/members/bob`).set(as("bob")).send({ role: "PL" }).expect(403);
    const changed = await http().patch(`/projects/${id}/members/bob`).set(as("alice")).send({ role: "PM" }).expect(200);
    expect(changed.body).toMatchObject({ userId: "bob", role: "PM" });
    await http().delete(`/projects/${id}/members/bob`).set(as("alice")).expect(204);
    await http().delete(`/projects/${id}/members/bob`).set(as("alice")).expect(404);
    await http().get(`/projects/${id}`).set(as("bob")).expect(404);
  });

  it("refuses to remove or demote the last PL with 409 and rejects a bad role with 400", async () => {
    const id = await createProject("alice", "Lead");
    await http().delete(`/projects/${id}/members/alice`).set(as("alice")).expect(409);
    await http().patch(`/projects/${id}/members/alice`).set(as("alice")).send({ role: "DEV" }).expect(409);
    await http().patch(`/projects/${id}/members/alice`).set(as("alice")).send({ role: "ROOT" }).expect(400);
    await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "", role: "DEV" }).expect(400);
  });

  describe("policy", () => {
    const limits = { commandTimeoutSeconds: 600, maxToolCallsPerRun: 100 };
    const editable = (overrides: Record<string, unknown> = {}) => ({
      allowedExecutables: [],
      extraForbiddenExecutables: [],
      extraProtectedBranches: [],
      limits,
      ...overrides,
    });

    it("shows the default policy with the fixed baseline, to any member", async () => {
      const id = await createProject("alice", "PolicyDefault");
      await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
      const response = await http().get(`/projects/${id}/policy`).set(as("dev")).expect(200);
      expect(response.body).toMatchObject({ version: 0, policy: editable() });
      expect(response.body.baseline.protectedBranches).toContain("main");
      expect(response.body.baseline.forbiddenExecutables).toContain("terraform");
      expect(response.body.baseline.rules.length).toBeGreaterThan(0);
      expect(response.body.effective.protectedBranches).toContain("release/*");
      await http().get(`/projects/${id}/policy`).set(as("stranger")).expect(404);
      await http().get(`/projects/${id}/policy`).expect(401);
    });

    it("lets a PL save versions and keeps the history", async () => {
      const id = await createProject("alice", "PolicySave");
      const saved = await http()
        .put(`/projects/${id}/policy`)
        .set(as("alice"))
        .send({ expectedVersion: 0, policy: editable({ allowedExecutables: ["Node", "pnpm"], extraProtectedBranches: ["hotfix/*"] }), comment: "CI tools" })
        .expect(200);
      expect(saved.body).toMatchObject({ version: 1, changedBy: "alice", comment: "CI tools", policy: { allowedExecutables: ["node", "pnpm"] } });
      expect(saved.body.effective.protectedBranches).toEqual(expect.arrayContaining(["main", "hotfix/*"]));
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 1, policy: editable({ allowedExecutables: ["node"] }) }).expect(200);
      const versions = await http().get(`/projects/${id}/policy/versions`).set(as("alice")).expect(200);
      expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    });

    it("refuses a DEV with 403, a stale version with 409 and a no-op with 422", async () => {
      const id = await createProject("alice", "PolicyRules");
      await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
      await http().put(`/projects/${id}/policy`).set(as("dev")).send({ expectedVersion: 0, policy: editable({ allowedExecutables: ["node"] }) }).expect(403);
      await http().put(`/projects/${id}/policy`).set(as("stranger")).send({ expectedVersion: 0, policy: editable({ allowedExecutables: ["node"] }) }).expect(404);
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 0, policy: editable({ allowedExecutables: ["node"] }) }).expect(200);
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 0, policy: editable({ allowedExecutables: ["pnpm"] }) }).expect(409);
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 1, policy: editable({ allowedExecutables: ["node"] }) }).expect(422);
      const current = await http().get(`/projects/${id}/policy`).set(as("alice")).expect(200);
      expect(current.body.version).toBe(1);
    });

    it("cannot be used to relax the baseline: shells, forbidden tools and baseline fields are refused with 400", async () => {
      const id = await createProject("alice", "PolicyBaseline");
      for (const policy of [
        editable({ allowedExecutables: ["bash"] }),
        editable({ allowedExecutables: ["terraform"] }),
        editable({ allowedExecutables: ["node.exe"] }),
        editable({ extraProtectedBranches: ["*"] }),
        editable({ limits: { commandTimeoutSeconds: 999_999, maxToolCallsPerRun: 100 } }),
        { ...editable(), protectedBranches: [] },
        { ...editable(), allowForcePush: true },
      ]) {
        await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 0, policy }).expect(400);
      }
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ expectedVersion: 0, policy: editable(), unknown: 1 }).expect(400);
      await http().put(`/projects/${id}/policy`).set(as("alice")).send({ policy: editable({ allowedExecutables: ["node"] }) }).expect(400);
      const current = await http().get(`/projects/${id}/policy`).set(as("alice")).expect(200);
      expect(current.body.version).toBe(0);
    });
  });

  describe("repositories", () => {
    const shop = { provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", defaultBranch: "develop", allowedBranches: ["develop", "release/*"] };

    it("connects, lists, changes and removes a repository", async () => {
      const id = await createProject("alice", "WithRepos");
      const added = await http().post(`/projects/${id}/repositories`).set(as("alice")).send(shop).expect(201);
      expect(added.body).toMatchObject({ provider: "github", name: "org/shop", defaultBranch: "develop", allowedBranches: ["develop", "release/*"] });
      const list = await http().get(`/projects/${id}/repositories`).set(as("alice")).expect(200);
      expect(list.body).toHaveLength(1);
      const changed = await http().patch(`/projects/${id}/repositories/${added.body.id}`).set(as("alice")).send({ allowedBranches: ["develop"] }).expect(200);
      expect(changed.body.allowedBranches).toEqual(["develop"]);
      await http().delete(`/projects/${id}/repositories/${added.body.id}`).set(as("alice")).expect(204);
      await http().delete(`/projects/${id}/repositories/${added.body.id}`).set(as("alice")).expect(404);
    });

    it("rejects an address with credentials and never echoes it back", async () => {
      const id = await createProject("alice", "NoSecrets");
      const response = await http()
        .post(`/projects/${id}/repositories`)
        .set(as("alice"))
        .send({ ...shop, url: "https://user:ghp_not-a-real-token@github.com/org/shop.git" })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain("ghp_not-a-real-token");
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send({ ...shop, allowedBranches: ["*"] }).expect(400);
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send({ ...shop, provider: "gitlab" }).expect(400);
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send({ ...shop, extra: "x" }).expect(400);
    });

    it("answers 409 for a repeated repository, 422 when the default branch is not allowed", async () => {
      const id = await createProject("alice", "Rules");
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send(shop).expect(201);
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send(shop).expect(409);
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send({ ...shop, name: "org/other", defaultBranch: "main" }).expect(422);
    });

    it("lets a DEV read but not change, and hides everything from a non-member", async () => {
      const id = await createProject("alice", "Access");
      await http().post(`/projects/${id}/repositories`).set(as("alice")).send(shop).expect(201);
      await http().post(`/projects/${id}/members`).set(as("alice")).send({ userId: "dev", role: "DEV" }).expect(201);
      await http().get(`/projects/${id}/repositories`).set(as("dev")).expect(200);
      await http().post(`/projects/${id}/repositories`).set(as("dev")).send({ ...shop, name: "org/other" }).expect(403);
      await http().get(`/projects/${id}/repositories`).set(as("stranger")).expect(404);
      await http().patch(`/projects/${id}/repositories/anything`).set(as("alice")).send({}).expect(400);
    });
  });
});
