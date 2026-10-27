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
The code is split into two source folders: `frontend/` (Next.js UI) and `backend/` (API, worker and AI agent runtime in one codebase). The AI runtime is a backend module, not a third folder, unless O4 later chooses a separate service. Inside `backend/src/`, `domain` depends on nothing, `policy` depends only on `domain`, and later modules (`api`, `worker`, `agent`, `integrations`) may depend on both. A module folder is created only when its phase starts. `frontend/` exists so far only as a README; no framework is installed until O4 to O6 are decided.

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

## Boundary
`harness-engineering` guides the AI coding agents that build this product. It is not a runtime and is not shipped. Product runtime (UI, API, queue, workers, provider adapters, integrations, approvals) lives only here. Do not copy harness rules into this repo; reference them.

## Planned phases
0 governance and layout · 1 domain contracts and skeleton · 2 persistence, API, auth, audit · 3 task UI on a fake executor · 4 orchestrator, queue, event stream · 5 sandbox, repo adapters, policy tool layer · 6 provider abstraction and agent loop · 7 approvals and publish · 8 Jira intake · 9 hardening.

The numbering above is this repository's. The implementation plan (`docs/` of the outer `ai-agent-platform` repository, phases 0 to 7) uses its own numbering. Per D13 this repository's numbering is the one followed; the two map as follows:

| Implementation plan | This repository |
|---|---|
| 0 audit | 0 governance and layout (audit done) |
| – | 1 domain contracts (foundation the plan assumes; implemented in `backend/src/domain`, `backend/src/policy`) |
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
Recorded from the Phase 0 audit. Facts are checked against the domain and policy code, now `backend/src/domain` and `backend/src/policy`.

- **Run states.** Code: `queued, preparing, analyzing, planning, implementing, verifying, awaiting_approval, publishing, succeeded, rejected, failed, cancelled`. Plan: adds `RESOLVING_INPUT`, `RESOLVING_REPOSITORY`, `REVIEWING_OUTPUT` and `BLOCKED`, and has no `rejected`. An ambiguous repository target ends in `blocked` (D14); input and repository resolution stay inside `preparing`.
- **Approval.** Code asks once, after verification and before publishing, bound to run, diff hash and target branch (D3, D5). The plan has `WAITING_APPROVAL` after planning and also binds approval to the diff hash in its output phase. D15 keeps the single publish approval.
- **Stack.** D4 fixes a TypeScript monorepo with zod. The plan proposes NestJS, Prisma, PostgreSQL and a Python AI runtime. None of these exist yet (O4, O5).
- **Tenancy.** D2 uses one organization with a `tenantId` column. The plan names `Workspace` and `WorkspaceMember` (O7).
- **Domain gaps.** Added in phase 1 (2026-10-27): provider descriptor with a declarative config schema, input snapshot with content hash, repository resolution with base commit SHA, idempotency key, correlation id, `projectId` on `Task` and `Run`, and the `blocked` status. Still missing: repository mapping, a `Project` entity, and the validation of a configuration against a descriptor (phase 2). `RepoProvider` is the fixed enum `github | codecommit` and `OutputKind` is `report | diff | test_report | pull_request`; the plan also lists a JSON artifact and a Jira comment. D7 to D9 add more: a `Project` entity, a stored policy with versions, an MCP connection, and a policy action for an MCP tool call (`Action` has no such kind today; an MCP write would currently fit only `external_write`).
- **Policy package.** It restates harness git and secret rules in code (`GIT_BLOCKED`, `isSecretPath`). The boundary says to reference harness rules, not copy them, so the two can drift. Before Phase 5, review three points: whether an allowed executable such as `node` or `pnpm` is allowed whatever its arguments, whether `git fetch` should count as touching the remote, and whether git's `-c` option can inject configuration. These are unverified suspicions, not confirmed defects.

## Open decisions
Proposed, not decided. Each needs a person to choose, then this section is replaced by numbered decisions (D17 onward) in a reviewed change.

- **O4 AI runtime language.** TypeScript as a backend module (the current layout, two source folders) or a separate Python service, which would add a third folder (`ai/`). Proposal: stay with the module; decide at Phase 6 with a minimal agent loop, nothing before it needs Python.
- **O5 Backend framework, ORM, database.** NestJS, Prisma and PostgreSQL as the plan suggests, or another choice that fits D4. Must be decided before Phase 2. Record the reason here per the product rules.
- **O6 Queue and event transport.** Unchosen. Decide before Phase 4 from the real hosting environment; polling first, server-sent events later.
- **O7 Tenant and workspace.** Proposal: keep `tenantId` (D2) and treat a workspace as a later grouping under it only if a use case appears.
- **O8 Where the plan documents live.** Resolved by the layout: in `docs/` of this repository, next to this file.## Actions for a human
Items 1 and 2 touch harness files that only a human may edit.

1. Decide how the harness should see this repository (its `projects.yml` expects `<workspace>/<dir>/<repo>`), register it there and run `node tools/projects.mjs sync`.
2. Check that `permissions.additionalDirectories` in the harness `.claude/settings.json` covers the folders the agent edits (not verified).
3. Delete the leftover empty folder `platform/` (it only holds old `node_modules`).