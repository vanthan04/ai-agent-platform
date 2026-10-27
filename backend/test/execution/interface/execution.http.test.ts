import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app/app.module";
import { APP_CONFIG, loadConfig } from "../../../src/config/config";
import { RUN_REPOSITORY, TASK_REPOSITORY } from "../../../src/execution";
import { AUTHENTICATOR, type AuthUser, type AuthenticationRequest, type Authenticator } from "../../../src/identity";
import { PROJECT_POLICY_REPOSITORY, PROJECT_REPOSITORY } from "../../../src/projects";
import { TenantId, UserId } from "../../../src/shared-kernel";
import { InMemoryRunRepository, InMemoryTaskRepository } from "../../support/in-memory-execution.repositories";
import { InMemoryProjectPolicyRepository } from "../../support/in-memory-project-policy.repository";
import { InMemoryProjectRepository } from "../../support/in-memory-project.repository";

class HeaderAuthenticator implements Authenticator {
  authenticate(req: AuthenticationRequest): AuthUser | undefined {
    const header = req.headers["x-test-user"];
    if (typeof header !== "string") return undefined;
    const [userId, tenantId = "tenant-1"] = header.split("@");
    return { userId: UserId.parse(userId), tenantId: TenantId.parse(tenantId) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("tasks and runs over HTTP", () => {
  let app: INestApplication;
  let runRepo: InMemoryRunRepository;
  const as = (user: string) => ({ "x-test-user": user });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    runRepo = new InMemoryRunRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ NODE_ENV: "test" }))
      .overrideProvider(AUTHENTICATOR)
      .useValue(new HeaderAuthenticator())
      .overrideProvider(PROJECT_REPOSITORY)
      .useValue(new InMemoryProjectRepository())
      .overrideProvider(PROJECT_POLICY_REPOSITORY)
      .useValue(new InMemoryProjectPolicyRepository())
      .overrideProvider(TASK_REPOSITORY)
      .useValue(new InMemoryTaskRepository())
      .overrideProvider(RUN_REPOSITORY)
      .useValue(runRepo)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** A project owned by alice, with a DEV `dev`, a DEV `other`, a PM `pm` and one connected repository. Returns ids. */
  const setup = async (name: string): Promise<{ project: string; repository: string }> => {
    const project = (await http().post("/projects").set(as("alice")).send({ name }).expect(201)).body.id as string;
    for (const [userId, role] of [["dev", "DEV"], ["other", "DEV"], ["pm", "PM"]] as const) {
      await http().post(`/projects/${project}/members`).set(as("alice")).send({ userId, role }).expect(201);
    }
    const repository = (
      await http()
        .post(`/projects/${project}/repositories`)
        .set(as("alice"))
        .send({ provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", defaultBranch: "develop", allowedBranches: ["develop", "release/*"] })
        .expect(201)
    ).body.id as string;
    return { project, repository };
  };

  const newTask = async (project: string, repository: string, extra: object = {}): Promise<string> =>
    (await http().post(`/projects/${project}/tasks`).set(as("dev")).send({ title: "Add retry", repositoryId: repository, baseBranch: "develop", ...extra }).expect(201)).body.id as string;

  it("creates a task for any member, with defaults, and never shows the tenant", async () => {
    const { project, repository } = await setup("HttpTasks");
    const created = await http().post(`/projects/${project}/tasks`).set(as("dev")).send({ title: "  Add retry  ", repositoryId: repository, baseBranch: "release/2.0" }).expect(201);
    expect(created.body).toMatchObject({
      title: "Add retry",
      description: "",
      source: { type: "manual" },
      repositoryId: repository,
      repo: { provider: "github", name: "org/shop", url: "https://github.com/org/shop.git", baseBranch: "release/2.0" },
      inputs: {},
      outputs: ["report"],
      createdBy: "dev",
    });
    expect(created.body).not.toHaveProperty("tenantId");
    const list = await http().get(`/projects/${project}/tasks`).set(as("pm")).expect(200);
    expect(list.body).toHaveLength(1);
    await http().get(`/projects/${project}/tasks/${created.body.id}`).set(as("other")).expect(200);
    await http().get(`/projects/${project}/tasks/unknown`).set(as("dev")).expect(404);
  });

  it("refuses a bad body with field paths only, a repository that is not the project's, and a branch that is not allowed", async () => {
    const { project, repository } = await setup("HttpTaskRules");
    const post = (body: object) => http().post(`/projects/${project}/tasks`).set(as("dev")).send(body);
    const good = { title: "t", repositoryId: repository, baseBranch: "develop" };
    const bad = await post({ ...good, title: "", token: "hunter2-not-a-real-secret" }).expect(400);
    expect(JSON.stringify(bad.body)).not.toContain("hunter2");
    await post({ ...good, extra: 1 }).expect(400);
    await post({ ...good, outputs: [] }).expect(400);
    await post({ ...good, outputs: ["email"] }).expect(400);
    await post({ ...good, source: { type: "jira", issueKey: "abc-1" } }).expect(400);
    await post({ ...good, inputs: { a: "x".repeat(2_001) } }).expect(400);
    await post({ ...good, repositoryId: "someone-elses-repository" }).expect(422);
    await post({ ...good, baseBranch: "main" }).expect(422);
    await post({ ...good, source: { type: "jira", issueKey: "ABC-123" }, outputs: ["diff", "pull_request"] }).expect(201);
  });

  it("shows a non-member and a signed-out caller nothing", async () => {
    const { project, repository } = await setup("HttpTaskAccess");
    const task = await newTask(project, repository);
    await http().get(`/projects/${project}/tasks/${task}`).set(as("stranger")).expect(404);
    await http().get(`/projects/${project}/tasks`).set(as("dev@tenant-2")).expect(404);
    await http().post(`/projects/${project}/tasks`).send({ title: "t", repositoryId: repository, baseBranch: "develop" }).expect(401);
  });

  it("queues a run at once: 201 for a new run, 200 for the same key, 409 for a busy task or a key of another task", async () => {
    const { project, repository } = await setup("HttpRuns");
    const task = await newTask(project, repository);
    const other = await newTask(project, repository, { title: "Other" });
    const path = `/projects/${project}/tasks/${task}/runs`;
    await http().post(path).set(as("dev")).expect(400);
    await http().post(path).set(as("dev")).set("Idempotency-Key", "has space").expect(400);
    await http().post(path).set(as("dev")).set("Idempotency-Key", "k".repeat(129)).expect(400);

    const first = await http().post(path).set(as("dev")).set("Idempotency-Key", "key-1").set("X-Correlation-Id", "trace-12345678").expect(201);
    expect(first.body).toMatchObject({ taskId: task, attempt: 1, status: "queued", publishes: false, idempotencyKey: "key-1", correlationId: "trace-12345678", requestedBy: "dev" });
    expect(first.body).not.toHaveProperty("tenantId");

    const again = await http().post(path).set(as("dev")).set("Idempotency-Key", "key-1").expect(200);
    expect(again.body).toEqual(first.body);
    await http().post(path).set(as("dev")).set("Idempotency-Key", "key-2").expect(409);
    await http().post(`/projects/${project}/tasks/${other}/runs`).set(as("dev")).set("Idempotency-Key", "key-1").expect(409);
    expect((await http().get(`/projects/${project}/runs`).set(as("dev")).expect(200)).body).toHaveLength(1);
  });

  it("makes a correlation id when none is sent, refuses a malformed one, and numbers the next attempt after a cancel", async () => {
    const { project, repository } = await setup("HttpAttempts");
    const task = await newTask(project, repository);
    const path = `/projects/${project}/tasks/${task}/runs`;
    await http().post(path).set(as("dev")).set("Idempotency-Key", "bad-corr").set("X-Correlation-Id", "short").expect(400);
    const first = await http().post(path).set(as("dev")).set("Idempotency-Key", "k1").expect(201);
    expect(first.body.correlationId).toMatch(UUID);
    await http().post(`/projects/${project}/runs/${first.body.id}/cancel`).set(as("dev")).expect(200);
    const second = await http().post(path).set(as("dev")).set("Idempotency-Key", "k2").expect(201);
    expect(second.body.attempt).toBe(2);
    expect(second.body.correlationId).not.toBe(first.body.correlationId);
  });

  it("lists and filters runs, reads one run and its events from a given number", async () => {
    const { project, repository } = await setup("HttpReads");
    const task = await newTask(project, repository);
    const run = (await http().post(`/projects/${project}/tasks/${task}/runs`).set(as("dev")).set("Idempotency-Key", "k1").expect(201)).body.id as string;
    await http().post(`/projects/${project}/runs/${run}/cancel`).set(as("dev")).expect(200);
    expect((await http().get(`/projects/${project}/runs?status=cancelled`).set(as("pm")).expect(200)).body).toHaveLength(1);
    expect((await http().get(`/projects/${project}/runs?status=queued`).set(as("pm")).expect(200)).body).toHaveLength(0);
    expect((await http().get(`/projects/${project}/runs?taskId=${task}&limit=5`).set(as("pm")).expect(200)).body).toHaveLength(1);
    for (const query of ["status=sleeping", "limit=0", "limit=101", "limit=abc"]) await http().get(`/projects/${project}/runs?${query}`).set(as("pm")).expect(400);
    expect((await http().get(`/projects/${project}/runs/${run}`).set(as("other")).expect(200)).body).toMatchObject({ status: "cancelled" });
    await http().get(`/projects/${project}/runs/unknown`).set(as("dev")).expect(404);

    const all = await http().get(`/projects/${project}/runs/${run}/events`).set(as("dev")).expect(200);
    expect(all.body.map((event: { seq: number; type: string }) => `${event.seq}:${event.type}`)).toEqual(["1:log", "2:run.status_changed"]);
    expect(all.body[1]).toMatchObject({ from: "queued", to: "cancelled" });
    expect((await http().get(`/projects/${project}/runs/${run}/events?after=1`).set(as("dev")).expect(200)).body).toHaveLength(1);
    expect((await http().get(`/projects/${project}/runs/${run}/events?after=2`).set(as("dev")).expect(200)).body).toEqual([]);
    await http().get(`/projects/${project}/runs/${run}/events?after=-1`).set(as("dev")).expect(400);
  });

  it("cancels: the starter or a PM or PL may, another DEV may not, twice is 409, publishing is 409", async () => {
    const { project, repository } = await setup("HttpCancel");
    const task = await newTask(project, repository);
    const run = (await http().post(`/projects/${project}/tasks/${task}/runs`).set(as("dev")).set("Idempotency-Key", "k1").expect(201)).body.id as string;
    await http().post(`/projects/${project}/runs/${run}/cancel`).set(as("other")).expect(403);
    await http().post(`/projects/${project}/runs/${run}/cancel`).set(as("stranger")).expect(404);
    await http().post(`/projects/${project}/runs/${run}/cancel`).expect(401);
    const cancelled = await http().post(`/projects/${project}/runs/${run}/cancel`).set(as("pm")).expect(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled" });
    expect(cancelled.body.finishedAt).toBeTruthy();
    await http().post(`/projects/${project}/runs/${run}/cancel`).set(as("pm")).expect(409);

    const next = (await http().post(`/projects/${project}/tasks/${task}/runs`).set(as("dev")).set("Idempotency-Key", "k2").expect(201)).body.id as string;
    runRepo.force(next, "publishing");
    await http().post(`/projects/${project}/runs/${next}/cancel`).set(as("dev")).expect(409);
  });
});
