# Decisions

Recorded 2026-10-27. Change a decision by editing this file in a reviewed change.

## D1 Repository layout
Amended 2026-10-27: the product is one git repository, `ai-agent-platform`, with no nested `platform/agent-platform/` folder. Its root holds `frontend/`, `backend/` and `docs/`. `harness-engineering/` sits next to them inside the workspace but is git-ignored, so it stays out of the repository for now.

The harness expects a project at `<workspace>/<dir>/<repo>`, which this flat layout no longer matches. How to register the product in the harness `projects.yml` is therefore open and not verified; see "Actions for a human" below. The `projects.yml` and `permissions.additionalDirectories` of the harness are human-only files and did not list this product at audit time.

## D2 Tenancy
Single organization. Authentication and roles are required, but there is one tenant. The data model carries a tenant id column from the start so multi-tenancy is an extension, not a rewrite.

## D3 Publishing authority
The worker may push a branch or open a change only after a persisted approval by a user who is PM or PL for that repository, covering the exact diff and target branch that was shown. No approval, no push. Never to a protected branch. This mirrors `core/policies/permissions.md` of the harness.

## D4 Toolchain (Phase 1)
pnpm workspace (`frontend`, `backend`), strict TypeScript, Vitest, ESLint with typescript-eslint, Prettier, zod 4 for schemas. The backend is one package whose modules live in `src/<module>/`; there are no per-module packages and no build step yet. TypeScript is pinned to 6.x because typescript-eslint does not support 7.0 yet; lift the pin when it does. Dependencies were installed with `--ignore-scripts`.

## D5 Domain rules enforced in code
- A run can enter `publishing` only through `transition()` with an approval that is `approved`, from a PM or PL, for the same run, the same diff hash and the same target branch, and the target is not protected.
- A run whose task requests no `pull_request` output never passes through approval; a publishing run cannot succeed without passing `publishing`.
- The policy evaluator returns `allow`, `ask` or `deny`. `ask` means a persisted approval is required first. Unlike the harness, a secret file read is `deny`, not `ask`, because there is no human present mid-run.

## D6 Two source folders and the remote
The code is split into two source folders: `frontend/` (Next.js UI) and `backend/` (API, worker and AI agent runtime in one codebase). The AI runtime is a backend module, not a third folder, unless O4 later chooses a separate service. Inside `backend/src/`, `domain` depends on nothing, `policy` depends only on `domain`, and later modules (`api`, `worker`, `agent`, `integrations`) may depend on both. A module folder is created only when its phase starts. `frontend/` exists so far only as a README; no framework is installed until O1 and O4 to O6 are decided.

The git remote `origin` is `https://github.com/vanthan04/ai-agent-platform.git`. `harness-engineering/` is git-ignored until O9 is decided. The earlier inner repository of `platform/agent-platform` had no commits and was merged into the outer one.

## Boundary
`harness-engineering` guides the AI coding agents that build this product. It is not a runtime and is not shipped. Product runtime (UI, API, queue, workers, provider adapters, integrations, approvals) lives only here. Do not copy harness rules into this repo; reference them.

## Planned phases
0 governance and layout · 1 domain contracts and skeleton · 2 persistence, API, auth, audit · 3 task UI on a fake executor · 4 orchestrator, queue, event stream · 5 sandbox, repo adapters, policy tool layer · 6 provider abstraction and agent loop · 7 approvals and publish · 8 Jira intake · 9 hardening.

The numbering above is this repository's. The implementation plan (`docs/` of the outer `ai-agent-platform` repository, phases 0 to 7) uses its own numbering. Until O1 is decided, both are valid and map as follows:

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

## Reconciliation with the implementation plan
Recorded from the Phase 0 audit. Facts are checked against the domain and policy code, now `backend/src/domain` and `backend/src/policy`.

- **Run states.** Code: `queued, preparing, analyzing, planning, implementing, verifying, awaiting_approval, publishing, succeeded, rejected, failed, cancelled`. Plan: adds `RESOLVING_INPUT`, `RESOLVING_REPOSITORY`, `REVIEWING_OUTPUT` and `BLOCKED`, and has no `rejected`. The code has no `blocked`, so an ambiguous repository target has no state to end in (O2).
- **Approval.** Code asks once, after verification and before publishing, bound to run, diff hash and target branch (D3, D5). The plan has `WAITING_APPROVAL` after planning and also binds approval to the diff hash in its output phase (O3).
- **Stack.** D4 fixes a TypeScript monorepo with zod. The plan proposes NestJS, Prisma, PostgreSQL and a Python AI runtime. None of these exist yet (O4, O5).
- **Tenancy.** D2 uses one organization with a `tenantId` column. The plan names `Workspace` and `WorkspaceMember` (O7).
- **Missing from the domain.** Provider descriptor, input snapshot with content hash, repository mapping and resolution with base commit SHA, idempotency key, correlation id. `RepoProvider` is the fixed enum `github | codecommit` and `OutputKind` is `report | diff | test_report | pull_request`; the plan also lists a JSON artifact and a Jira comment.
- **Policy package.** It restates harness git and secret rules in code (`GIT_BLOCKED`, `isSecretPath`). The boundary says to reference harness rules, not copy them, so the two can drift. Before Phase 5, review three points: whether an allowed executable such as `node` or `pnpm` is allowed whatever its arguments, whether `git fetch` should count as touching the remote, and whether git's `-c` option can inject configuration. These are unverified suspicions, not confirmed defects.

## Open decisions
Proposed, not decided. Each needs a person to choose, then this section is replaced by numbered decisions (D7 onward) in a reviewed change.

- **O1 Phase order.** UI first on mock data (plan) or API first (this file). Proposal: keep this file's order; the UI phase still starts from a fake executor and a repository layer so the data source can be swapped.
- **O2 `blocked` and resolve steps.** Add a `blocked` status. Proposal: add `blocked`, reachable from `preparing`, with an explicit reason (ambiguous repository, missing permission); keep input and repository resolution inside `preparing` rather than adding two statuses.
- **O3 Approval points.** Proposal: one approval, as implemented. An optional plan approval can be added later without changing the publish approval.
- **O4 AI runtime language.** TypeScript as a backend module (the current layout, two source folders) or a separate Python service, which would add a third folder (`ai/`). Proposal: stay with the module; decide at Phase 6 with a minimal agent loop, nothing before it needs Python.
- **O5 Backend framework, ORM, database.** NestJS, Prisma and PostgreSQL as the plan suggests, or another choice that fits D4. Must be decided before Phase 2. Record the reason here per the product rules.
- **O6 Queue and event transport.** Unchosen. Decide before Phase 4 from the real hosting environment; polling first, server-sent events later.
- **O7 Tenant and workspace.** Proposal: keep `tenantId` (D2) and treat a workspace as a later grouping under it only if a use case appears.
- **O8 Where the plan documents live.** Resolved by the layout: in `docs/` of this repository, next to this file.
- **O9 Whether `harness-engineering/` belongs in this repository.** It is git-ignored for now. It looks like internal company material (project names, remotes), so putting it on a personal GitHub repository needs your decision. Options: keep it ignored, track it, or keep it in its own repository next to this one.

## Actions for a human
Items 1 and 2 touch harness files that only a human may edit.

1. Decide how the harness should see this repository (its `projects.yml` expects `<workspace>/<dir>/<repo>`), register it there and run `node tools/projects.mjs sync`.
2. Check that `permissions.additionalDirectories` in the harness `.claude/settings.json` covers the folders the agent edits (not verified).
3. Delete the leftover empty folder `platform/` (it only holds old `node_modules`).