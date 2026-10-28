# Decisions

Recorded 2026-10-27. Change a decision by editing this file in a reviewed change.

## D1 Repository layout
Amended 2026-10-27: the product is one git repository, `ai-agent-platform`, with no nested `platform/agent-platform/` folder. Its root holds `frontend/`, `backend/` and `docs/`. `harness-engineering/` sits next to them inside the workspace but is git-ignored, so it stays out of the repository for now.

The harness expects a project at `<workspace>/<dir>/<repo>`, which this flat layout no longer matches. How to register the product in the harness `projects.yml` is therefore open and not verified; see "Actions for a human" below. The `projects.yml` and `permissions.additionalDirectories` of the harness are human-only files and did not list this product at audit time.

## D2 Tenancy
Single organization. Authentication and roles are required, but there is one tenant. The data model carries a tenant id column from the start so multi-tenancy is an extension, not a rewrite.

## D3 Publishing authority
The worker may push a branch or open a change only after a persisted approval by a user who is PM or PL of that project (D12), covering the exact diff and target branch that was shown. No approval, no push. Never to a protected branch. This mirrors `core/policies/permissions.md` of the harness.

## D4 Toolchain (Phase 1)
pnpm workspace (`frontend`, `backend`), strict TypeScript, Vitest, ESLint with typescript-eslint, Prettier, zod 4 for schemas. The backend is one package whose modules live in `src/<module>/`; there are no per-module packages and no build step yet. TypeScript is pinned to 6.x because typescript-eslint does not support 7.0 yet; lift the pin when it does. Dependencies were installed with `--ignore-scripts`.

## D5 Domain rules enforced in code
- A run can enter `publishing` only through `transition()` with an approval that is `approved`, from a PM or PL, for the same run, the same diff hash and the same target branch, and the target is not protected.
- A run whose task requests no `pull_request` output never passes through approval; a publishing run cannot succeed without passing `publishing`.
- The policy evaluator returns `allow`, `ask` or `deny`. `ask` means a persisted approval is required first. Unlike the harness, a secret file read is `deny`, not `ask`, because there is no human present mid-run.

## D6 Two source folders and the remote
The code is split into two source folders: `frontend/` (Next.js UI) and `backend/` (API, worker and AI agent runtime in one codebase). The AI runtime is a backend module, not a third folder, unless O4 later chooses a separate service. Inside `backend/src/`, `domain` depends on nothing, `policy` depends only on `domain`, and later modules (`api`, `worker`, `agent`, `integrations`) may depend on both. A module folder is created only when its phase starts. `frontend/` exists so far only as a README; no frontend framework is installed yet. The backend stack is D17; the queue is the run table (D23).

The git remote `origin` is `https://github.com/vanthan04/ai-agent-platform.git`. `harness-engineering/` is git-ignored (D16). The earlier inner repository of `platform/agent-platform` had no commits and was merged into the outer one.

## D7 Projects created and stored from the UI
Added 2026-10-27 as a requirement. A user adds a project in the UI, and each project stores its own data: repositories and allowed branches, policy, MCP connections, execution configs, tasks and runs. `Task` and `Run` carry a `projectId`. Single-organization tenancy (D2) is unchanged; the project is the unit of separation inside the tenant, so one project never reads or changes another's data.

## D8 Editable policy over a fixed baseline
Added 2026-10-27 as a requirement. A user edits policy from the UI, per project. Facts that shape it: `evaluate()` already takes a `PolicyContext` (protected branches, allowed and forbidden executables) as data, so that part can come from storage. The rules written inside `evaluate()` stay in code and are not editable, because D3 and D5 depend on them: secret files are denied, `.git` and `node_modules` are not touched, force push is denied, and publishing needs a persisted PM or PL approval of the exact diff. An edit can move an action between `allow` and `ask`, or add a restriction; it can never relax a baseline `deny`. Which settings are editable and who may edit is D10.

## D9 MCP servers connected from the UI
Added 2026-10-27 as a requirement. A user connects MCP servers to a project from the UI. What this must obey:
- A connection is stored with its credentials in the secrets layer; the browser never receives a secret.
- Tool descriptions and tool results from an MCP server are untrusted data (product rules in `AGENTS.md`). A tool call is a typed action evaluated by the policy before it runs, and an unknown tool defaults to `ask`.
- Writes to an external system through an MCP tool are drafts until approved, like any `external_write`.
Transport and where the server runs is D11.

## D10 Who edits policy and what is editable
Decided 2026-10-27. Editable per project: allowed executables, extra protected branches, `allow` or `ask` per external write operation and per MCP tool, and limits (timeouts, tool count). Not editable: the baseline of D8. Only PM or PL edit policy; DEV can view and propose. Each edit is versioned and audited with actor and time, and a run records the policy version it used.

## D11 MCP transport
Decided 2026-10-27. Remote HTTP MCP servers only, until the sandbox exists (phase 5). A stdio server starts a process on the machine that runs it, so it is allowed only inside the sandbox, never on the API host.

## D12 Project membership
Decided 2026-10-27. Each project has members, each with a role (PM, PL or DEV) in that project only. Whoever creates a project becomes its PL. The global roles listed in `ai-manifest.yaml` govern the AI coding agents that build this repository, not users of the product.

## D13 Phase order
Decided 2026-10-27. The phase list under "Planned phases" is authoritative: domain contracts, persistence and API, task UI on a fake executor, orchestrator, sandbox and tool layer, agent loop, approvals and publish, Jira intake, hardening. The UI is built after the API, but from a fake executor behind a repository layer so the data source can be swapped. The implementation plan's phase files describe each part's content; its own numbering maps onto this one in the table below.

## D14 Blocked status
Decided 2026-10-27. A run can end in `blocked`, reachable only from `preparing`, with a required reason (for example an ambiguous repository or a missing permission). Input and repository resolution happen inside `preparing`; there are no separate resolving statuses. `blocked` is terminal like `failed`, so continuing after the user fixes the cause means a new attempt, not resuming the same run.

## D15 Approval points
Decided 2026-10-27. One approval per publishing run, after verification and before publishing, bound to run, diff hash and target branch (D3, D5). A plan approval before implementation may be added later without changing the publish approval.

## D16 Harness stays outside the repository
Decided 2026-10-27. `harness-engineering/` is not part of this repository and stays git-ignored. It is not required to build or run the product.

## D17 Backend stack
Decided 2026-10-27. NestJS 12 (native ES modules), Prisma 7 with the `pg` driver adapter, PostgreSQL 17 started by Docker Compose for development (`backend/docker-compose.yml`). Why: it is the stack the plan proposed, Nest's module structure matches the planned `api`, `projects`, `mcp` and `worker` modules, and Nest 12 is ESM like the rest of the workspace. Consequences:
- The Prisma client is generated into `backend/src/generated/` and git-ignored. Because dependencies are installed with `--ignore-scripts` (D4), the `test` and `typecheck` scripts run `prisma generate` first.
- Decorators use TypeScript's `experimentalDecorators`; constructor injection names its token explicitly with `@Inject(...)`, so tests run under esbuild without `emitDecoratorMetadata`.
- Data access sits behind a repository interface per module. The service and the HTTP layer are tested with an in-memory repository; the Postgres repository has its own test that runs only when `DATABASE_URL` is set.
- Credentials never go in a committed file. `docker-compose.yml` and Prisma read them from `backend/.env` (git-ignored); the variables are listed in `backend/README.md`.

## D18 Authentication seam and tenant isolation
Decided 2026-10-27. Callers are identified by an `Authenticator` interface. Only `DevAuthenticator` exists: every request is one fixed user, and `loadConfig` refuses `AUTH_MODE=dev` when `NODE_ENV=production`, so nothing can be deployed until real authentication replaces it. Every route requires a user unless marked `@Public()`. The user and tenant come from the authenticator, never from a request body. Every repository method is scoped by tenant, and a project the caller is not a member of is reported as not found, the same as one that does not exist.

## D19 Domain-driven structure of the backend
Decided 2026-10-27. `backend/src/` is split into bounded contexts, one folder each, with a shared kernel:
- `shared-kernel`: ids, `Role`, branch matching, `RepoRef`, `DomainError`. The only thing every context may use.
- `projects`: the `Project` aggregate (members, roles, invariants), its use cases, storage and HTTP. Has all four layers.
- `execution`: tasks, runs and their state machine, steps, events, artifacts, approval rules; tasks and runs are stored and served (D22). The executor that moves a run forward is not built yet.
- `integrations`: provider descriptors, input snapshots, repository resolution. Domain only for now.
- `policy`: allow, ask or deny for an agent action. Domain only for now.
- `identity`: who is calling (`Authenticator` seam, guard, dev user).
- `vault`: the secrets layer (encrypted storage behind a `SecretStore` port). Named `vault` because paths named `secrets` are protected from the AI coding agent.
- `mcp`: the MCP servers connected to a project, and testing them.
- `worker`: the background process that takes queued runs and prepares them (D23); uses `execution` and `integrations`.
- `network` (like `config` and `database`, shared infrastructure, not a context): the only way the server calls a URL a user supplied (D21).
- `config` (environment) and `app` (the composition root, health) sit beside the contexts.

A context that has more than pure rules is split into `domain` (entities, value objects, domain errors, repository interfaces; no framework, no I/O), `application` (use cases and ports), `infrastructure` (Prisma, clock) and `interface` (controllers, request schemas, error mapping). Rules, enforced by ESLint in `backend/eslint.config.mjs` so `pnpm lint` fails on a violation:
- dependencies point inwards: `domain` imports no other layer, no Nest, no Prisma, no `node:`; `application` imports neither `infrastructure` nor `interface`;
- contexts depend only along the allowed list (`policy` and `identity` on the kernel; `execution` on the kernel, `policy`, `identity`, `projects` and `integrations`; `worker` on the kernel, `execution` and `integrations`; `projects` on the kernel, `identity` and `policy`; `vault` on the kernel; `mcp` on the kernel, `identity`, `projects` and `vault`; the kernel on nothing) and only through the other context's `index.ts`;
- no context imports `app`.
A broken business rule is a `DomainError` with a `code`; the interface layer of its context turns the code into a response. A layer folder is created only when the context needs it.

Consequences for decisions already taken: the project aggregate guarantees D12 (creator is PL, a user is a member once) and one more rule that follows from D10, a project always keeps at least one PL. Members are managed by id; there is still no users table.

## D20 How the editable policy is built (implements D8 and D10)
Chosen 2026-10-27 while building the slice; the lists below are proposals to confirm, change them by editing this file and `backend/src/policy/domain/baseline.ts`.
- What a project edits is one value, `EditablePolicy`: programs a run may start without asking, programs forbidden on top of the baseline, branches protected on top of the baseline, and two limits (command timeout, tool calls per run) under fixed ceilings. It has no field for anything in the baseline, so no edit can relax it; a payload with an unknown field is refused.
- The baseline is code and is always merged in: protected branches `main, master, develop, staging, production, release/*` (the list of `ai-manifest.yaml`); forbidden programs `aws, terraform, serverless, sls, ssh, scp`; the rules inside `evaluate()` (secret files, workspace escape, `.git` and `node_modules`, force push, git history commands, publish and deploy, merge and delete on external systems); publishing needs a persisted PM or PL approval (D3).
- A project can never allow a shell or privilege escalation (`sh, bash, zsh, fish, dash, ksh, cmd, powershell, pwsh, sudo, su, doas, runas`), because allowing one lets a run do anything. A program also cannot be allowed and forbidden at once. Allowing programs that run arbitrary code by their arguments (`node`, `python`, `pnpm exec`) is still possible and is the project's own risk; `evaluate()` does not look inside their arguments (see the suspicions under "Reconciliation").
- Versions are append-only rows: number, policy, author, time, comment. An edit names the version it saw (`expectedVersion`); if the policy changed meanwhile it is refused (409) instead of overwriting. An edit that changes nothing is refused (422). Version 0 is the default policy: nothing allowed, nothing extra protected, timeout 600 s, 100 tool calls. The stored JSON is validated again on every read, so a row that breaks today's rules is rejected rather than applied.
- A project's members read the policy and its history; only a PM or PL saves a version (D10). DEV proposals are not built yet.
- `allow` or `ask` per MCP tool is part of `EditablePolicy` (`mcpToolDecisions`, keyed `<connection>:<tool>`, at most 200) and reaches `evaluate()` through the new action `mcp_tool_call`: a tool listed as `allow` runs, every other tool asks, and this setting never denies. Policies saved before the field existed still read (it defaults to none).
- Not built yet: `allow` or `ask` per external write operation, and recording the policy version on each run (needs the run executor).

## D21 MCP connections and the secrets layer (implements D9 and D11)
Decided 2026-10-27; the storage of tokens was chosen by the project owner (encrypted in the database with an application key).
- A project's members see its MCP connections; only a PM or PL connects, replaces a token or removes one. A connection has a name that never changes (the policy refers to its tools as `<name>:<tool>`), an https address and optionally a bearer token. At most 10 per project.
- The address must be https, a public DNS name, with no credentials, query or fragment; IP addresses (any notation), single-label names and internal suffixes (`.local`, `.internal`, `.corp`, …) are refused. This is the first line against server-side request forgery only: a name can still resolve to a private address, so the code that will call the server (next slice) must check where it connects and must not follow redirects blindly.
- Tokens live in `vault`: AES-256-GCM, a fresh IV per value, the tenant and reference authenticated with the value so a copied or altered row cannot be read, key `SECRETS_ENCRYPTION_KEY` (base64 of 32 bytes) from the environment, never from the database or the code. A connection stores only a reference. No API returns a token or its reference; an error for a bad token names the field, never the value. Without the key the app starts, a connection without a token still works, and storing a token answers 503.
- The key has no rotation yet: losing it makes stored tokens unreadable (enter them again); changing it needs a re-encryption step that is not built.
- Testing a connection and discovering its tools (`POST …/test`) is built on the Streamable HTTP transport of MCP (initialize, ready notice, `tools/list` with pages, end of session); the older HTTP+SSE transport is not supported. Only a PM or PL may run it (it sends the token to the server), at most 5 times a minute per project (counted in the process, so per instance), and the answer is always HTTP 200 with `ok: true` and the tools, or `ok: false` and one word (`unreachable`, `blocked_address`, `timeout`, `response_too_large`, `unauthorized`, `bad_status`, `invalid_response`, `server_error`, `token_unavailable`). What the server answered is never passed on.
- Every outbound call goes through `network/` (`SafeHttpClient`): https only; the name is resolved by our own lookup, which refuses the connection if any answer is not a public address, and the connection uses that checked address, so DNS rebinding cannot swap it afterwards; an IP address in a URL is checked directly; no redirects are followed, so a token cannot be passed to another host; no cookies, no compression, a 10 s deadline and a 1 MB limit. Verified against a real name that resolves to 127.0.0.1 (answered `blocked_address`).
- Tool names and descriptions from a server are untrusted: names must match `[A-Za-z0-9_.-]{1,64}` and be unique, descriptions lose control characters and are cut to 300 characters, at most 500 tools over 10 pages. They are for display as plain text; they must not be put in a model prompt as instructions.
- Not built yet: using a token at run time (calling a tool during a run), storing the discovered tools, and removal of the secrets of a deleted project.

## D22 Tasks and runs (first slice of the execution engine)
Decided 2026-10-27, within D13 to D15.
- **Who:** any member of a project creates tasks and starts runs; only a PM or PL, or the person who started a run, cancels it. Non-members get 404 for everything.
- **A task** is described by a person and always targets a repository the project has connected (`repositoryId`) and a base branch that matches one of that connection's allowed branches. The repository is chosen by the caller, never taken from the text of the task (plan phase 4). The task keeps a copy of the repository's name, address and provider, so changing or removing the connection later does not rewrite what was asked. Outputs default to `report`; `pull_request` marks the run as publishing, which still needs the approval of D3 and D15.
- **A run** is queued and the call returns at once; nothing runs inside the HTTP request. `POST …/tasks/:taskId/runs` needs an `Idempotency-Key` header: the same key in the same project always answers with the same run (200, `created: false` in effect) and never starts a second; the key of another task is refused (409). An optional `X-Correlation-Id` (8 to 64 safe characters) is kept, otherwise one is made; it is stored with the run to join logs.
- **One run in progress per task**, enforced by a partial unique index in the database as well as in the use case (409). A task whose run ended (cancelled, failed, blocked, rejected, succeeded) can be run again; the new run is the next attempt and the earlier one, with its events, stays untouched (D14).
- **State changes** go through `transition()` only, and are written with compare-and-set: the row changes only if it is still in the state the caller saw, otherwise 409 `run_state_conflict`, so two people acting at once cannot both win. A run in `publishing` cannot be cancelled. The stored state is read back through the schema, so a row with an unknown state is refused.
- **Events** are append only and numbered 1, 2, 3 … per run; the first is written with the run, the next in the same transaction as each state change. `GET …/events?after=N` returns what came after N, so a client that lost its connection resumes where it stopped. Polling first; a stream later.
- Not built yet: the stages after preparing (D23), retries by the system, the audit of who read what, usage records, the Jira source fetch, and recording the policy version on a run.

## D23 The worker and the queue (first worker slice; settles O6)
Decided 2026-10-27.
- **The queue is the `Run` table.** A run in `queued` is waiting; a worker takes it by moving it to `preparing` with the same compare-and-set as every other state change, so any number of workers can run and exactly one wins each run. No new infrastructure. Events are polled (`GET …/events?after=N`); a stream can be added later without changing the queue.
- **The worker is its own process**, `pnpm worker` (`src/worker-main.ts`, no HTTP server), in the `worker` context. It asks the execution context for the queue, the stores and the state machine and never reads their tables. A pass recovers stalled runs, then prepares up to 5 queued ones, oldest first; with nothing to do it waits 2 s. On a stop signal it finishes the pass it is in.
- **What it does today, "preparing":** moves the run to `preparing`; reads the commit the task's base branch points at; stores it (`RunResolution`, once, with source `user_selected` because a person picked the repository); writes each step as an event. The commit is read from the git "smart HTTP" ref advertisement every https git server gives (`info/refs?service=git-upload-pack`), through the safe client of D21: public addresses only, no redirects, 20 s, 8 MB. No credential is sent, so only repositories readable without signing in work; ssh addresses are not supported yet.
- **Outcomes.** Branch or repository not found (a private repository looks the same as a missing one) or an ssh address: `blocked`, with a reason a person can act on (D14). The host unreachable, too slow, too large, a forbidden address or not a git server: `failed`, one plain reason. A run in `preparing` with no new event for 5 minutes is taken to have lost its worker and is failed so the task can run again. A cancel during preparing wins: the worker's next change is refused and it leaves the run alone.
- **No stage exists after preparing.** A prepared run therefore ends `failed` with the reason that analysis, planning and implementation are not implemented, instead of waiting for a stage nobody runs. The next slice replaces that last step with the move to `analyzing`.
- **Nothing a remote server says, and no exception text, is stored or logged**: failures are one fixed sentence in the run, and the worker log names the kind of error and the run and correlation ids only.
- `baseBranch` of a task must now be a concrete branch name (`BranchName`); a pattern such as `release/*` is refused. The `RunView` of a single run carries `baseCommit`.
- Not built yet: private repositories (a credential per project, kept in the vault), ssh and CodeCommit, system retries, a heartbeat longer than the 5-minute rule, and the stages after preparing.

## D24 The frontend (first slice; implements the screens of D7 to D9)
Decided 2026-10-28.
- **Stack.** Next.js 16 (App Router) with React 19, TypeScript and Tailwind 4. Own small components (button, field, dialog, badge, states) instead of a component kit: the screens need a dozen of them, and each extra dependency is one more thing to review (D4). `lucide-react` for icons and `clsx` are the only other runtime packages. Tests are vitest with Testing Library.
- **The browser never talks to the backend.** It calls `/api/...` on the app and a route handler forwards the call (`src/lib/proxy.ts`). This keeps the backend address out of the browser, avoids cross-origin rules, and gives one place that decides what passes: only `projects` and `health`, the five usual methods, four request headers (`content-type`, `accept`, `idempotency-key`, `x-correlation-id`), a 1 MB body, 30 s, no redirects. Cookies and authorization headers are never forwarded. The backend stays the authority on who may do what (D12); the page only decides what to enable.
- **Authentication** is still the dev user (D18); the proxy adds nothing. When real sign-in lands, the proxy is where the session becomes a credential for the backend.
- **Screens.** Projects (list, create); inside a project: Execution (tasks and runs with counts by status, search and filters, a live log per run, start and cancel) and Setup (repositories and allowed branches, policy, MCP servers, members). The Execution screen follows the reference design given by the user (light theme, orange accent, status cards, expandable task rows).
- **Honest status.** A task has no stored status: it is derived from its newest run (`taskStatus`). Today a prepared run ends `failed` (D23), so the cards show Ready, In progress, Blocked and Failed, and there is no "Completed" card until a stage after preparing exists.
- **Live data is polled**, as the backend offers (D23): runs every 2 s while any is in progress, a run's events every 1.5 s while it is. The log shows Connected, Reconnecting or Finished from the result of the last call.
- **Policy screen.** The baseline is shown as text with no control. The editable part is saved with the version the editor loaded; a refusal because someone saved first (409) tells the user to load the newer version instead of overwriting it. A DEV sees everything read-only.
- **MCP tokens** are typed into a password field, sent once and cleared; the backend never returns one, so the page has none to show.
- Types in `src/lib/api/types.ts` are copied by hand from the backend views (the backend is the authority). Generating them from the backend is possible later if they drift.
- Checked: lint, typecheck, 41 tests, production build, and the screens in a browser against a stand-in server because Docker was not running. Not yet checked against the real backend.
- Not built yet: sign-in, a screen for approvals (needs a stage that asks for one), run artifacts, Jira as a task source, editing a task, deleting a project, the MCP tool picker for the policy (tools are typed as `connection:tool`).

## Boundary
`harness-engineering` guides the AI coding agents that build this product. It is not a runtime and is not shipped. Product runtime (UI, API, queue, workers, provider adapters, integrations, approvals) lives only here. Do not copy harness rules into this repo; reference them.

## Planned phases
0 governance and layout · 1 domain contracts and skeleton · 2 persistence, API, auth, audit · 3 task UI on a fake executor · 4 orchestrator, queue, event stream · 5 sandbox, repo adapters, policy tool layer · 6 provider abstraction and agent loop · 7 approvals and publish · 8 Jira intake · 9 hardening.

The numbering above is this repository's. The implementation plan (`docs/` of the outer `ai-agent-platform` repository, phases 0 to 7) uses its own numbering. Per D13 this repository's numbering is the one followed; the two map as follows:

| Implementation plan | This repository |
|---|---|
| 0 audit | 0 governance and layout (audit done) |
| – | 1 domain contracts (foundation the plan assumes; implemented in `backend/src/execution`, `backend/src/integrations`, `backend/src/policy`, `backend/src/shared-kernel`) |
| 1 frontend on mock data | 3 task UI on a fake executor |
| 2 backend, database, provider registry | 2 persistence, API, auth, audit |
| 3 execution engine | 4 orchestrator, queue, event stream |
| 4 input and integrations | 5 repo adapters and 8 Jira intake |
| 5 AI agent runtime (read-only) | 6 provider abstraction and agent loop |
| 6 sandbox and code execution | 5 sandbox and policy tool layer |
| 7 output, approval, production | 7 approvals and publish and 9 hardening |

Two ordering differences matter: the plan builds the UI before the backend, and it builds the read-only agent before the sandbox. This repository does the opposite in both cases.

Where D7 to D9 land: project, policy and MCP connection records and their API in phase 2; the screens to add a project, edit policy and connect MCP in phase 3 (on a fake data source first); evaluating the stored policy and MCP tool calls in phases 5 and 6, when the tool layer exists.

## Reconciliation with the implementation plan
Recorded from the Phase 0 audit. Facts are checked against the domain and policy code, now in `backend/src/execution`, `backend/src/integrations` and `backend/src/policy` (D19).

- **Run states.** Code: `queued, preparing, analyzing, planning, implementing, verifying, awaiting_approval, publishing, succeeded, rejected, failed, cancelled`. Plan: adds `RESOLVING_INPUT`, `RESOLVING_REPOSITORY`, `REVIEWING_OUTPUT` and `BLOCKED`, and has no `rejected`. An ambiguous repository target ends in `blocked` (D14); input and repository resolution stay inside `preparing`.
- **Approval.** Code asks once, after verification and before publishing, bound to run, diff hash and target branch (D3, D5). The plan has `WAITING_APPROVAL` after planning and also binds approval to the diff hash in its output phase. D15 keeps the single publish approval.
- **Stack.** D4 fixes a TypeScript monorepo with zod. The plan proposes NestJS, Prisma, PostgreSQL and a Python AI runtime. The first three are now chosen (D17); the AI runtime language is still open (O4).
- **Tenancy.** D2 uses one organization with a `tenantId` column. The plan names `Workspace` and `WorkspaceMember` (O7).
- **Domain gaps.** Added in phase 1 (2026-10-27): provider descriptor with a declarative config schema, input snapshot with content hash, repository resolution with base commit SHA, idempotency key, correlation id, `projectId` on `Task` and `Run`, and the `blocked` status. Added in phase 2: the `Project` aggregate with members (D19) and repository mappings with allowed branches (a repository's address must be https or ssh and never carry credentials; a pattern that matches every branch is refused; the default branch must be an allowed one). Still missing: the validation of a configuration against a descriptor, and wiring `isBranchAllowed` into repository resolution (phase 4). `RepoProvider` is the fixed enum `github | codecommit` and `OutputKind` is `report | diff | test_report | pull_request`; the plan also lists a JSON artifact and a Jira comment. D7 to D9 add more: a `Project` entity, a stored policy with versions, an MCP connection, and a policy action for an MCP tool call (`Action` has no such kind today; an MCP write would currently fit only `external_write`).
- **Policy package.** It restates harness git and secret rules in code (`GIT_BLOCKED`, `isSecretPath`). The boundary says to reference harness rules, not copy them, so the two can drift. Before Phase 5, review three points: whether an allowed executable such as `node` or `pnpm` is allowed whatever its arguments, whether `git fetch` should count as touching the remote, and whether git's `-c` option can inject configuration. These are unverified suspicions, not confirmed defects.

## Open decisions
Proposed, not decided. Each needs a person to choose, then this section is replaced by numbered decisions (D25 onward) in a reviewed change.

- **O4 AI runtime language.** TypeScript as a backend module (the current layout, two source folders) or a separate Python service, which would add a third folder (`ai/`). Proposal: stay with the module; decide at Phase 6 with a minimal agent loop, nothing before it needs Python.
- **O7 Tenant and workspace.** Proposal: keep `tenantId` (D2) and treat a workspace as a later grouping under it only if a use case appears.
- **O8 Where the plan documents live.** Resolved by the layout: in `docs/` of this repository, next to this file.## Actions for a human
Items 1 and 2 touch harness files that only a human may edit.

1. Decide how the harness should see this repository (its `projects.yml` expects `<workspace>/<dir>/<repo>`), register it there and run `node tools/projects.mjs sync`.
2. Check that `permissions.additionalDirectories` in the harness `.claude/settings.json` covers the folders the agent edits (not verified).
3. Delete the leftover empty folder `platform/` (it only holds old `node_modules`).