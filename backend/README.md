# backend

API, worker and AI agent runtime in one TypeScript codebase: NestJS 12, Prisma 7, PostgreSQL (D17), organised by bounded context (D19). Code lives in `src/<context>/`, tests in `test/<context>/`.

## Structure

```text
src/
  shared-kernel/   ids, Role, branch matching, RepoRef, DomainError
  projects/        domain/  application/  infrastructure/  interface/   + projects.module.ts, index.ts
  execution/       domain/  application/  infrastructure/  interface/   tasks, runs, state machine, approvals
  integrations/    domain/                                     provider descriptors, snapshots, repository resolution
  policy/          domain/                                     allow / ask / deny for agent actions
  identity/        domain/  application/  infrastructure/  interface/
  vault/           domain/  application/  infrastructure/    encrypted secret storage (SecretStore)
  mcp/             domain/  application/  infrastructure/  interface/   MCP servers connected to a project
  worker/          application/  infrastructure/            the process that prepares queued runs; worker-main.ts starts it
  database/        the one Prisma client shared by every context
  network/         safe outbound HTTPS: public addresses only, no redirects, limits (D21)
  config/          environment, read once at start
  app/             composition root (AppModule) and /health
  generated/       Prisma client, git-ignored
prisma/            schema and migrations
```

| Layer | Holds | May import |
|---|---|---|
| `domain` | entities, aggregates, value objects, domain errors, repository interfaces | the shared kernel; no Nest, no Prisma, no `node:` |
| `application` | use cases and ports (repository token, clock) | its own domain |
| `infrastructure` | Prisma repository, system clock | domain, application |
| `interface` | controllers, request schemas, mapping of domain errors to responses | domain, application |

Between contexts: `policy` and `identity` use the kernel; `execution` uses the kernel, `policy`, `identity` and `projects`; `projects` uses the kernel, `identity` and `policy`; `vault` uses the kernel; `mcp` uses the kernel, `identity`, `projects` and `vault`; `worker` uses the kernel, `execution` and `integrations`; the kernel uses nothing. A context is imported only through its `index.ts`. `pnpm lint` fails on a violation (`eslint.config.mjs`). A layer folder is created when a context needs it, not before.

## Contexts

| Context | Status | Owns |
|---|---|---|
| `shared-kernel` | done | ids (including `ProjectId`, `IdempotencyKey`, `CorrelationId`), `Role`, protected-branch matching, `BranchName` and `BranchPattern`, `RepoRef`, `DomainError`. |
| `projects` | phase 2, fourth slice | the `Project` aggregate: creator starts as PL, only PM or PL change it (D10), a user is a member once, a project keeps at least one PL (D12, D19); connected repositories with the branches a run may start from (D7): an address is https or ssh and never carries credentials, a repository is connected once per provider, the default branch must be an allowed one, no pattern may match every branch, at most 20 repositories. `isBranchAllowed()` is ready for repository resolution (phase 4). The project's editable policy is stored as append-only versions (D10, D20): `createPolicyVersion()` refuses a stale `expectedVersion` and a no-op; members read, a PM or PL saves. Use cases, Postgres storage, HTTP. |
| `execution` | phase 2, first slice | task, run, step, tool call, event, artifact, approval; run state machine including `blocked` (D14); `canApprovePublish`. Tasks (always against a connected repository and an allowed base branch) and runs are stored and served: queue a run with an idempotency key, one run in progress per task, cancel with compare-and-set, append-only numbered events to resume from (D22). A queued run is picked up by the worker, which records the commit its base branch points at (`baseCommit` on a single run, D23). |
| `integrations` | phase 1 done | `ProviderDescriptor` with a declarative config schema, `InputSnapshot`, `RepositoryResolution`. |
| `policy` | phase 2 | `evaluate()` and `PolicyDecision`; the fixed baseline (`baseline.ts`); `EditablePolicy`, the only part a project may change, and `buildPolicyContext()` that merges it with the baseline into the input of `evaluate()` (D8, D20). An MCP tool call still needs a new action kind (D9). |
| `identity` | dev only | `Authenticator` seam, global guard (every route needs a user unless `@Public()`), `@CurrentUser()`, the fixed dev user (D18). |
| `vault` | phase 2 | the secrets layer: `SecretStore` port, AES-256-GCM in Postgres with the key from `SECRETS_ENCRYPTION_KEY` (D21). Returns a `SecretRef`; no API reveals a secret. |
| `mcp` | phase 2 | `McpConnection` per project: fixed name, https address of a public server, optional bearer token kept in the vault (D9, D11, D21). Testing a connection lists the server's tools through `network/`. Not yet: calling a tool during a run (phase 6), storing the discovered tools. The per-tool `allow`/`ask` setting is in the project policy (`mcpToolDecisions`, D20). |
| `worker` | phase 3, first slice | its own process (`pnpm worker`): takes queued runs by compare-and-set, moves them to `preparing`, reads the commit of the base branch over https through `network/`, stores it, writes events, blocks a run that cannot be read and fails one whose worker stopped (D23). Today a prepared run ends `failed` with "stages after preparing are not implemented". Next: analysis, then the sandbox, then publish after a persisted PM or PL approval (D3). |
| `agent` | planned, phase 6 | the AI runtime; every tool call goes through `policy.evaluate()`. |

## API

| Method and path | Who | Result |
|---|---|---|
| `GET /health` | anyone | `{ "status": "ok" }` |
| `POST /projects` | signed in | 201 project, caller is its PL; 400 bad body; 409 name already used |
| `GET /projects` | signed in | projects the caller is a member of |
| `GET /projects/:id` | member | project with the caller's role; 404 for a non-member, same as a missing id |
| `PATCH /projects/:id` | PM or PL | updated project; 403 for DEV; 404 for a non-member |
| `GET /projects/:id/members` | member | members with roles |
| `POST /projects/:id/members` | PM or PL | 201 member `{ userId, role }`; 409 already a member |
| `PATCH /projects/:id/members/:userId` | PM or PL | updated member; 404 unknown member; 409 would leave no PL |
| `DELETE /projects/:id/members/:userId` | PM or PL | 204; 404 unknown member; 409 would leave no PL |
| `GET /projects/:id/repositories` | member | connected repositories with default and allowed branches |
| `POST /projects/:id/repositories` | PM or PL | 201 `{ provider, name, url, defaultBranch, allowedBranches }`; 400 bad address (credentials, scheme) or pattern; 409 already connected or too many; 422 default branch not allowed |
| `PATCH /projects/:id/repositories/:repositoryId` | PM or PL | updated `defaultBranch` and/or `allowedBranches`; 404 unknown; 422 default branch not allowed |
| `DELETE /projects/:id/repositories/:repositoryId` | PM or PL | 204; 404 unknown |
| `GET /projects/:id/policy` | member | `{ version, policy, effective, baseline }`: the editable part, what it adds up to with the baseline, and the fixed baseline with the reason for each rule. Version 0 is the default |
| `PUT /projects/:id/policy` | PM or PL | body `{ expectedVersion, policy, comment? }`; 200 the new version; 400 a shell, a forbidden program, a field outside `EditablePolicy` or a limit over its ceiling; 403 DEV; 409 someone saved first; 422 nothing changed |
| `GET /projects/:id/policy/versions` | member | every version, newest first, with author, time and comment |
| `GET /projects/:id/mcp-connections` | member | `{ id, name, url, auth: "none" or "bearer", createdBy, createdAt, updatedAt }`; never a token or its reference |
| `POST /projects/:id/mcp-connections` | PM or PL | body `{ name, url, bearerToken? }`; 201; 400 unsafe address, bad name or token; 409 name used or 10 connections; 503 token given but `SECRETS_ENCRYPTION_KEY` not set |
| `PUT /projects/:id/mcp-connections/:connectionId/token` | PM or PL | body `{ bearerToken }`; replaces the stored token; 404 unknown connection |
| `POST /projects/:id/mcp-connections/:connectionId/test` | PM or PL | connects and lists the tools. 200 `{ ok: true, testedAt, protocolVersion, server, tools: [{ name, description }], skippedTools, truncated }` or `{ ok: false, testedAt, error }` with one word; 403 DEV; 404 unknown; 429 more than 5 tests a minute |
| `DELETE /projects/:id/mcp-connections/:connectionId` | PM or PL | 204 and the stored token is deleted; 404 unknown |
| `POST /projects/:id/tasks` | member | body `{ title, description?, source?, repositoryId, baseBranch, inputs?, outputs? }`; 201 task with a copy of the repository; 400 bad body; 422 repository not connected to the project or base branch not allowed |
| `GET /projects/:id/tasks` and `GET /projects/:id/tasks/:taskId` | member | newest first (`?limit`, up to 100); 404 unknown |
| `POST /projects/:id/tasks/:taskId/runs` | member | header `Idempotency-Key` required, `X-Correlation-Id` optional. 201 a queued run; 200 the same run for a repeated key; 409 the task already has a run in progress or the key belongs to another task |
| `GET /projects/:id/runs` | member | newest first; `?taskId`, `?status`, `?limit` |
| `GET /projects/:id/runs/:runId` and `GET /projects/:id/runs/:runId/events?after=N&limit=` | member | the run (with `baseCommit` once the worker has prepared it); its events after sequence number N, in order |
| `POST /projects/:id/runs/:runId/cancel` | PM, PL or who started it | 200 the cancelled run; 403 another DEV; 409 already ended, publishing, or changed meanwhile |

Members are named by `userId` as the authenticator reports it; there is no users table yet.

## Local setup

1. Start Docker Desktop, then create `backend/.env` yourself (it is git-ignored; replace `<your-password>`, in both places, with a password of your own made of letters and digits so it needs no escaping in the URL):

   ```text
   POSTGRES_USER=agent_platform
   POSTGRES_PASSWORD=<your-password>
   POSTGRES_DB=agent_platform
   DATABASE_URL=postgresql://agent_platform:<your-password>@localhost:5432/agent_platform
   AUTH_MODE=dev
   ```

   Optional: `PORT` (default 3001), `HOST` (default 127.0.0.1), `DEV_USER_ID`, `DEV_TENANT_ID`.

   To store MCP tokens, also add `SECRETS_ENCRYPTION_KEY` (base64 of 32 random bytes). Run this once; it appends the key to `.env` without showing it, and never changes a key that is already there:

   ```bash
   pnpm setup:encryption-key
   ```

   Keep this key: without it stored tokens cannot be read, and there is no key rotation yet. Without it the app still runs and a connection without a token still works.

2. Start Postgres and apply the migration:

   ```bash
   docker compose up -d
   pnpm db:deploy
   ```

3. Run the app: `pnpm start`. Without `DATABASE_URL`, `/health` works and the project routes answer 500.

4. Run the worker in a second terminal: `pnpm worker`. Without it a run stays `queued`. It reads public https repositories only, needs network access, and shuts down cleanly on Ctrl+C.

If port 3001 is already used by another program, set `PORT` in `.env`.

## Commands

```bash
pnpm test        # prisma generate, then vitest; the Postgres test is skipped unless DATABASE_URL is set
pnpm lint        # eslint, including the architecture rules
pnpm typecheck   # prisma generate, then tsc
pnpm db:deploy   # apply migrations
pnpm db:migrate  # create a new migration after editing prisma/schema.prisma (needs the database running)
```
